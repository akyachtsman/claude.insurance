// desk-ask — the Help desk endpoint (feature 003).
//
// This slot previously held a retired 410 stub, deployed by mistake into the
// wrong project and neutralised. CLAUDE.md carried "delete it" as a pending
// owner decision; repurposing it closes that at no cost. The slot already
// verifies JWTs, which this feature needs and `notify-enhancement` deliberately
// does not.
//
// THE RULE THIS FILE EXISTS TO HOLD: records are read SERVER-SIDE, scoped to the
// caller's own owner id resolved from their JWT. The browser already holds those
// rows under RLS, so accepting them in the request body would be simpler — and
// is the one shape that cannot be made safe, because the body is client
// controlled. Feature 002's review found exactly that as an IDOR; this applies
// the lesson before the bug rather than after.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// Pinned, not floating: the esm.sh incident recorded in CLAUDE.md is about the
// browser, but a server-side dependency that self-updates is the same class of
// surprise. Version VERIFIED against the npm registry on 2026-10-06 (latest
// 0.131.0) rather than recalled — an earlier draft of this line pinned 0.69.0
// from memory, which would have been found at deploy time, not here.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { buildPrompt, type HelpTopic, type RecordFact } from "./prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://akyachtsman.github.io/claude.insurance";

// Per-client hourly cap. The repo is public and CLAUDE.md publishes the demo
// credential, so the JWT gate AUTHENTICATES and does nothing about spend. An
// Anthropic Console workspace limit is the backstop if this has a bug.
const HOURLY_CAP = 20;
const QUESTION_MAX = 500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Every failure returns this one shape (FR-17). The page shows a quiet notice
// and the rest of the Keep is unaffected; it never renders a null as an answer.
const unavailable = (reason: string, extra: Record<string, unknown> = {}) =>
  json({ answer: null, reason, ...extra });

// The help guide has ONE home: content/help-guide.json, which also seeds the
// client's suggestion chips. Bundling a copy here would be faster and would
// drift the first time a screen was renamed, with nothing reporting it — so the
// function fetches the served copy and caches it for the life of the isolate.
// Cost of that choice, stated rather than hidden: if the guide is unreachable
// the feature is unavailable. It does NOT fall back to answering from records
// alone, because "where do I add an entity" would then be answered with no
// knowledge of the screens at all.
let guideCache: HelpTopic[] | null = null;
async function loadGuide(): Promise<HelpTopic[] | null> {
  if (guideCache) return guideCache;
  try {
    const res = await fetch(`${APP_URL}/content/help-guide.json`, { headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) return null;
    const data = await res.json();
    const topics = Array.isArray(data?.topics) ? data.topics : [];
    // A topic missing a field would render a blank line in the prompt, so an
    // incomplete corpus is filtered here rather than reaching the model.
    guideCache = topics.filter((t: HelpTopic) =>
      t && t.id && t.title && t.route && t.nav && t.body);
    return guideCache;
  } catch {
    return null;
  }
}

/** The client's own rows, read with the service key and filtered by the owner id
 *  resolved from their JWT — never by anything in the request body. Flattened to
 *  label/value pairs so the model receives VALUES, not a coverage summary it is
 *  invited to interpret (plan, Key decision 3, layer 2). */
async function ownRecords(admin: ReturnType<typeof createClient>, owner: string): Promise<RecordFact[]> {
  const facts: RecordFact[] = [];
  const { data: entities } = await admin.from("entities").select("id, name, kind").eq("owner", owner);
  for (const e of entities ?? []) {
    facts.push({ kind: "entity", name: e.name, label: "type", value: String(e.kind) });
  }
  const ids = (entities ?? []).map((e: { id: string }) => e.id);
  if (!ids.length) return facts;

  const { data: assets } = await admin.from("assets").select("id, name, kind, value, entity_id").in("entity_id", ids);
  for (const a of assets ?? []) {
    facts.push({ kind: "asset", name: a.name, label: "type", value: String(a.kind) });
    if (a.value != null) facts.push({ kind: "asset", name: a.name, label: "value on file", value: `$${a.value}` });
  }
  const assetIds = (assets ?? []).map((a: { id: string }) => a.id);
  if (!assetIds.length) return facts;

  const { data: policies } = await admin.from("policies")
    .select("line, carrier, policy_number, renewal_date, premium_amount, asset_id").in("asset_id", assetIds);
  const assetName = new Map((assets ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
  for (const p of policies ?? []) {
    const on = assetName.get(p.asset_id) ?? "an asset";
    facts.push({ kind: "policy", name: p.line, label: "covers", value: String(on) });
    if (p.carrier) facts.push({ kind: "policy", name: p.line, label: "carrier", value: p.carrier });
    // Absent is stated as absent. `null` renewal is a real state in this schema
    // and the repo's rule is that it is never rendered as a confident value.
    facts.push({
      kind: "policy", name: p.line, label: "renews",
      value: p.renewal_date ? String(p.renewal_date) : "no renewal date on file",
    });
    if (p.premium_amount != null) {
      facts.push({ kind: "policy", name: p.line, label: "premium", value: `$${p.premium_amount}` });
    }
  }
  return facts;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return unavailable("misconfigured");
  if (!ANTHROPIC_API_KEY) return unavailable("no_provider_key");

  let payload: { question?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const question = String(payload?.question ?? "").trim();
  if (!question) return json({ error: "empty_question" }, 400);
  if (question.length > QUESTION_MAX) return json({ error: "question_too_long" }, 400);

  // Caller identity comes from the JWT and nowhere else.
  const authz = req.headers.get("Authorization") ?? "";
  if (!authz) return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authz } }, auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const owner = userData?.user?.id;
  if (!owner) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // THROTTLE: reserve the slot BEFORE the model call, not after.
  //
  // An earlier version of this counted, called, and inserted only on success,
  // with a comment calling that a courtesy: "a failed call does not consume the
  // caller's allowance". That is backwards, and a security review caught it. A
  // failed Claude call is STILL BILLED, so a caller who can reliably provoke a
  // failure — a max_tokens cut, a refusal — pays for every call and consumes no
  // quota. Counting-then-calling also races: two concurrent requests both read
  // a count under the cap before either writes.
  //
  // So: insert first, then count. Every billable attempt is already recorded
  // before it can be billed, and the race now over-counts (safe) instead of
  // under-counting (not).
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: slot, error: slotErr } = await admin.from("help_queries")
    .insert({ owner, question }).select("id").single();
  // Fails CLOSED. A missing table means the migration is not applied, and an
  // unthrottled paid endpoint is exactly what this exists to prevent — so
  // "cannot reserve" must never read as "go ahead".
  // `owner` is passed explicitly and is never taken from the request body: the
  // column's `default auth.uid()` is NULL under the service key, so an implicit
  // insert would fail the NOT NULL rather than silently mis-attribute.
  if (slotErr || !slot) return unavailable("unavailable");

  const { count, error: countErr } = await admin.from("help_queries")
    .select("id", { count: "exact", head: true }).eq("owner", owner).gte("asked_at", since);
  if (countErr) return unavailable("unavailable");
  if ((count ?? 0) > HOURLY_CAP) {
    // Over the cap and nothing has been billed yet, so release the reservation.
    // Keeping it would make a user who hammers the endpoint extend their own
    // lockout with every refused attempt. Past this point the row STAYS,
    // whatever the provider does, because the call has been paid for.
    await admin.from("help_queries").delete().eq("id", slot.id);
    return unavailable("rate_limited", { retryAfterMinutes: 60 });
  }

  const topics = await loadGuide();
  if (!topics) return unavailable("unavailable");

  const facts = await ownRecords(admin, owner);
  const { system, messages } = buildPrompt({ question, topics, facts });

  let answer: string | null = null;
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
    const res = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2048,
      system,
      messages,
    });
    // stop_reason is checked BEFORE content. On a refusal or a max_tokens cut the
    // blocks present read as a complete answer that merely stops — and thinking
    // cannot be disabled on this model and counts against max_tokens, so a cut
    // is a realistic outcome rather than a theoretical one.
    // The reservation is NOT released on any path below: the call was made and
    // therefore billed, whatever came back.
    if (res.stop_reason !== "end_turn") return unavailable(`stopped_${res.stop_reason}`);
    // Extract by BLOCK TYPE, never content[0]: with thinking on, the first block
    // is a thinking block and content[0].text is undefined.
    answer = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || null;
  } catch {
    return unavailable("provider_error");
  }
  if (!answer) return unavailable("empty_answer");

  return json({
    answer,
    usedTopics: topics.map((t) => t.id),
    usedRecords: facts.length,
    reason: null,
  });
});
