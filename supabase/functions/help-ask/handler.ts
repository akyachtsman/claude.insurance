// handler.ts — the Help desk request handler, with its collaborators INJECTED.
//
// WHY THIS FILE EXISTS, and it is the sharpest review finding this feature got.
// All of this logic lived in index.ts, which imports `jsr:` and `npm:`
// specifiers Node cannot resolve — so nothing executed it, and the tests that
// claimed to cover it only regex-scraped its source. An independent review
// mutation-tested that suite: SEVEN of eight behaviour-breaking edits left all
// 262 tests green, including
//   · inverting the hourly cap comparison,
//   · raising HOURLY_CAP to 2000,
//   · dropping `.eq("owner", owner)` from the hourly count,
//   · dropping `.eq("owner", owner)` from the ENTITY read — a cross-client read,
//     which is the IDOR this feature's headline security claim is about,
//   · taking `owner` from the request body instead of the JWT.
// A guard nothing can execute is a guard nobody has checked.
//
// So the logic lives here, importing only ./prompt.ts and types, and index.ts
// supplies the real Supabase clients, the real Anthropic client and the real
// guide loader. handler.test.mjs drives this with in-memory fakes — the same
// trick prompt.node.test.mjs already proved for the prompt builder.
//
// `test.md`: "Stub the collaborators, never the subject."
import { buildPrompt, splitTrailer, recordIndex, clipField, type HelpTopic, type RecordFact } from "./prompt.ts";

/** The slice of PostgREST this handler uses. Structural, not the SDK's type, so
 *  a fake satisfies it without pulling in `jsr:`. */
// deno-lint-ignore no-explicit-any
export type Db = any;

export interface Deps {
  /** Service-role client. Bypasses RLS: every read it makes must scope itself. */
  admin: Db;
  /** Resolves the caller from their Authorization header, and nothing else. */
  userClient: (authz: string) => Promise<{ data: { user?: { id?: string } | null } | null }>;
  /** Anthropic client, or any object with the same `messages.create`. */
  // deno-lint-ignore no-explicit-any
  anthropic: { messages: { create: (args: any) => Promise<any> } };
  /** The help corpus, or null when it cannot be read. */
  loadGuide: () => Promise<HelpTopic[] | null>;
  appUrl: string;
  /** False when any required secret is missing — checked before anything else. */
  hasKeys: boolean;
}

// help-ask — the Help desk endpoint (feature 003).
// A NEW function slug, deliberately not the retired `desk-ask` stub this feature
// was first drafted over. Deploying on top of that stub would have shipped 003
// and removed the dead endpoint in one owner action, which is tempting — but it
// also silently changes what a deployed name means, and this repo has been bitten
// repeatedly by a record that still reads as current. `desk-ask` stays
// unambiguously retired and its deletion stays a separate, closable item;
// "help-ask" also matches what the feature is now called everywhere else.
// ⚠️ DEPLOY WITH `--no-verify-jwt`. That reads backwards for an endpoint that
// spends money per call, so here is the reasoning in full.
// The gateway flag adds NOTHING this function does not already do: the handler
// resolves the caller from their JWT and returns 401 before the first database
// write and long before the model call, so with the flag off an unauthenticated
// request still costs exactly one 401 and zero dollars.
// What the flag can do is break the feature in a way nobody can see.
// `supabase.functions.invoke` sends `Authorization` and `Content-Type:
// application/json`, neither CORS-safelisted, so the browser MUST send a
// preflight OPTIONS — and a preflight never carries `Authorization`. If the
// gateway enforces the flag on that preflight, the POST never leaves the
// browser. NOT VERIFIED HERE (the function is undeployed and the sandbox browser
// has no egress), which is exactly why it is not worth risking: FR-17 renders
// every failure as the same quiet notice, and S10 passes on the notice branch by
// design, so "deployed and permanently unreachable" is indistinguishable from
// "not deployed yet" from the client, the suite and the UI alike.
// A flag that adds no protection and can silently disable the feature is not a
// trade-off. `notify-enhancement` is deployed the same way, for its own reasons.
// THE RULE THIS FILE EXISTS TO HOLD: records are read SERVER-SIDE, scoped to the
// caller's own owner id resolved from their JWT. The browser already holds those
// rows under RLS, so accepting them in the request body would be simpler — and
// is the one shape that cannot be made safe, because the body is client
// controlled. Feature 002's review found exactly that as an IDOR; this applies
// the lesson before the bug rather than after.
// Pinned, not floating: the esm.sh incident recorded in CLAUDE.md is about the
// browser, but a server-side dependency that self-updates is the same class of
// surprise. Version VERIFIED against the npm registry on 2026-10-06 (latest
// 0.131.0) rather than recalled — an earlier draft of this line pinned 0.69.0
// from memory, which would have been found at deploy time, not here.
// Per-client hourly cap. The repo is public and CLAUDE.md publishes the demo
// credential, so the JWT gate AUTHENTICATES and does nothing about spend. An
// Anthropic Console workspace limit is the backstop if this has a bug.
const HOURLY_CAP = 20;
// AGGREGATE cap, and it is not redundant with the per-client one. HOURLY_CAP is
// keyed on `owner`, so it bounds spend per ACCOUNT — and this project publishes
// three demo credentials sharing one password (60 paid calls/hour from published
// secrets alone), while Supabase Auth self-signup, if enabled, makes the number
// of accounts unbounded and the per-client cap with it. A new account holds no
// records, which is a valid state here (FR-12), so the call still proceeds.
// The trade-off, stated rather than hidden: one abuser can exhaust this and take
// the help desk down for every real client. That is the same trade the Anthropic
// Console spend limit makes as the backstop — this one just makes it earlier,
// cheaper, and visible as "unavailable" rather than as a bill.
const DAILY_TOTAL_CAP = 400;
// Per-policy coverage lines sent to the model. Bounded because `coverages` is
// broker-written jsonb with no length limit and it is re-sent on every question.
const COVERAGES_PER_POLICY = 20;
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
// THE WIRE CONTRACT, and it is a contract: js/keep/logic/help.js consumes these
// exact keys and these exact reason strings, and contract.test.mjs pins both
// halves together. Each side was separately correct and separately tested in an
// earlier draft while disagreeing about `retryAfter` (seconds vs minutes),
// `usedRecords` (list vs count) and every reason name — which is how nav.js and
// its stamper stayed broken through three correct-looking fixes on PR #251.
//
// Reasons the consumer knows: unavailable · rate_limited · incomplete ·
// records_error · invalid · malformed. Anything else falls through to its
// generic notice, so a new failure gets a NAME here and a line there, together.
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

/** The client's own rows, read with the service key and filtered by the owner id
 *  resolved from their JWT — never by anything in the request body. Flattened to
 *  label/value pairs so the model receives VALUES, not a coverage summary it is
 *  invited to interpret (plan, Key decision 3, layer 2). */
// ⚠️ COLUMN NAMES COME FROM THE TABLES, NOT FROM THE VIEWS' NESTED SHAPE.
// This shipped selecting `assets.kind` and `policies.policy_number`; neither
// exists (they are `type` and `number` — js/supabase.js renames them on the way
// through, which is where the wrong names came from). PostgREST answers a
// missing column with `{ data: null, error }`, the error was dropped on the
// floor by `?? []`, and the function returned early before it ever read
// policies — so EVERY client's records read as "nothing on file yet", on a
// feature whose premise is answering from their records. schema.test.mjs is now
// a gate on exactly this, and reproduced it before the fix.
//
// Errors are propagated rather than coerced to an empty list. A throw here lands
// in the caller's try/catch and becomes `records_error`, which the client has its
// own notice for — because "your SELECT failed" and "you hold no policies" are
// different answers, and saying the second when the first is true is the invented
// answer FR-12 forbids. The old code stated that rule in a comment one screen
// down while doing the opposite here.
async function ownRecords(admin: Db, owner: string): Promise<RecordFact[]> {
  const facts: RecordFact[] = [];
  const read = <T>(res: { data: T[] | null; error: { message: string } | null }, what: string): T[] => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data ?? [];
  };

  const entities = read(
    await admin.from("entities").select("id, name, kind").eq("owner", owner), "entities");
  for (const e of entities) {
    facts.push({ kind: "entity", name: e.name, label: "type", value: String(e.kind) });
  }
  const ids = entities.map((e: { id: string }) => e.id);
  if (!ids.length) return facts;

  const assets = read(
    await admin.from("assets").select("id, name, type, value, entity_id").in("entity_id", ids), "assets");
  for (const a of assets) {
    facts.push({ kind: "asset", name: a.name, label: "type", value: String(a.type) });
    if (a.value != null) facts.push({ kind: "asset", name: a.name, label: "value on file", value: `$${a.value}` });
  }
  const assetIds = assets.map((a: { id: string }) => a.id);
  if (!assetIds.length) return facts;

  const policies = read(await admin.from("policies")
    .select("line, carrier, number, renewal_date, premium_amount, premium_period, coverages, asset_id")
    .in("asset_id", assetIds), "policies");
  const assetName = new Map(assets.map((a: { id: string; name: string }) => [a.id, a.name]));
  for (const p of policies) {
    const on = assetName.get(p.asset_id) ?? "an asset";
    facts.push({ kind: "policy", name: p.line, label: "covers", value: String(on) });
    if (p.carrier) facts.push({ kind: "policy", name: p.line, label: "carrier", value: p.carrier });
    // Selected since the first draft and never surfaced, so "what is my policy
    // number?" answered "your records don't say" while CLAUDE.md's Anthropic
    // data-scope paragraph listed it as disclosed. Reading a number back is the
    // plainest FR-8 fact there is, so the fix is to surface it, not to stop
    // selecting it — and the documented scope is now accurate either way.
    if (p.number) facts.push({ kind: "policy", name: p.line, label: "policy number", value: String(p.number) });
    // Absent is stated as absent. `null` renewal is a real state in this schema
    // and the repo's rule is that it is never rendered as a confident value.
    facts.push({
      kind: "policy", name: p.line, label: "renews",
      value: p.renewal_date ? String(p.renewal_date) : "no renewal date on file",
    });
    if (p.premium_amount != null) {
      // The period is carried because "$2,400" alone is ambiguous between a year
      // and a month, and a client reading a premium back needs to know which.
      const per = p.premium_period ? ` / ${p.premium_period}` : "";
      facts.push({ kind: "policy", name: p.line, label: "premium", value: `$${p.premium_amount}${per}` });
    }
    // COVERAGE LIMITS. `policies.coverages` is the system of record the policy
    // view renders from, and without it the feature could not answer its own
    // advertised example — the prompt lists "Your flood policy's dwelling limit
    // is $400,000" as an ALLOWED fact (spec FR-8's table), while nothing loaded
    // the column it lives in. The model would have had to say the records don't
    // say, or invent it. Reading a limit back is a FACT; whether that limit is
    // enough is the determination the boundary refuses, and that distinction is
    // in the prompt, not here.
    //
    // Capped per policy: this is broker-written jsonb of unbounded length, and
    // every entry costs prompt tokens on every question the client asks.
    for (const c of (Array.isArray(p.coverages) ? p.coverages : []).slice(0, COVERAGES_PER_POLICY)) {
      if (c && c.label && c.limit != null) {
        facts.push({ kind: "policy", name: p.line, label: `${c.label} limit`, value: String(c.limit) });
      }
    }
  }
  return facts;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const { admin, userClient, anthropic, loadGuide, appUrl, hasKeys } = deps;
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!hasKeys) return unavailable("unavailable");  // FR-17: the client needs a notice, not a cause

  // These return the SHAPED payload at 200, not `{error}` at 400. A non-2xx makes
  // supabase-js surface an error with no body, so the client fell through to its
  // generic "unavailable" and `FAILURE_NOTICE.invalid` — a line written for
  // exactly this, "That question couldn't be read" — was unreachable code.
  let payload: { question?: string };
  try { payload = await req.json(); } catch { return unavailable("invalid"); }
  const question = String(payload?.question ?? "").trim();
  if (!question) return unavailable("invalid");
  if (question.length > QUESTION_MAX) return unavailable("invalid");

  // Caller identity comes from the JWT and nowhere else.
  const authz = req.headers.get("Authorization") ?? "";
  if (!authz) return json({ error: "unauthorized" }, 401);
  const { data: userData } = await userClient(authz);
  const owner = userData?.user?.id;
  if (!owner) return json({ error: "unauthorized" }, 401);


  // INVITE CHECK, before anything billable and before the throttle row.
  //
  // HOURLY_CAP is keyed on `owner`, so it is a per-ACCOUNT cap — and it is only a
  // per-PERSON cap if accounts cannot be freely created. On 2026-10-06 the live
  // project answered `disable_signup: false`: public sign-up is ON, so an
  // outsider can confirm a plus-addressed mailbox, sign in, and collect their own
  // 20 paid asks an hour. About twenty such accounts exhaust DAILY_TOTAL_CAP and
  // the desk is refused to every real client for a day.
  //
  // `profiles` rows are service-role provisioned (the broker invites), so
  // requiring one makes this invite-only in fact and not only in the marketing
  // copy. Turning sign-up off in the dashboard is the other half and is the
  // owner's to do; this half holds even if it is ever turned back on.
  //
  // Returns the generic notice rather than a new reason: a stranger is owed
  // nothing more specific, and FR-17 means the client never sees a cause anyway.
  const { data: invited, error: inviteErr } = await admin
    .from("profiles").select("id").eq("id", owner).maybeSingle();
  if (inviteErr || !invited) return unavailable("unavailable");

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

  // EVERY exit from here until the provider call goes through `releaseAnd`, and
  // nothing after it does. Nothing has been billed yet on this side of the line,
  // so holding the row would let a transient failure eat the caller's hourly
  // allowance and the shared daily one — leaving the feature rate-limited after
  // its dependency recovered. Making it one helper rather than four open-coded
  // deletes is what lets a test assert the rule instead of trusting it: see
  // contract.test.mjs, which fails on a bare `unavailable(` in this region. Two
  // of the four paths did not release before that test existed.
  const releaseAnd = async (reason: string, extra: Record<string, unknown> = {}) => {
    await admin.from("help_queries").delete().eq("id", slot.id);
    return unavailable(reason, extra);
  };

  const { count, error: countErr } = await admin.from("help_queries")
    .select("id", { count: "exact", head: true }).eq("owner", owner).gte("asked_at", since);
  // A count that could not run has billed nothing — it must not cost the caller
  // an hour. (21 transient PostgREST errors used to lock them out having made
  // zero model calls.)
  if (countErr) return await releaseAnd("unavailable");
  // Over the cap, likewise: keeping the row would make a user who hammers the
  // endpoint extend their own lockout with every refused attempt.
  // SECONDS — the consumer builds its wait line from retryAfter.
  if ((count ?? 0) > HOURLY_CAP) return await releaseAnd("rate_limited", { retryAfter: 3600 });

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count: total, error: totalErr } = await admin.from("help_queries")
    .select("id", { count: "exact", head: true }).gte("asked_at", dayAgo);
  // Counts EVERY row in the window, which is only safe because `authenticated`
  // holds no INSERT on this table — the migration revoked it for exactly this
  // reason. With a client insert grant, one PostgREST call writing
  // DAILY_TOTAL_CAP+1 rows would turn the desk off for every client for a day at
  // no provider cost, which is a far better attack than the per-owner cap's
  // "lock yourself out". If that grant ever comes back, this count has to filter
  // on something the client cannot write.
  //
  // Fails CLOSED, like the reservation: a cap that cannot be counted must never
  // read as "under the cap".
  if (totalErr) return await releaseAnd("unavailable");
  if ((total ?? 0) > DAILY_TOTAL_CAP) {
    // NOT 3600. For the HOURLY cap an hour is an upper bound — the window can
    // only be shorter — so it is conservative and never a false promise. For
    // this ROLLING 24-HOUR window it is the opposite: 400 calls in the last hour
    // means the cap holds for nearly another 23, and "try again in an hour"
    // would be a promise the endpoint cannot keep.
    //
    // The cap clears when enough rows age out of the window. We hold `total`
    // rows including the reservation about to be released, so `total - CAP` of
    // the oldest must expire before the next ask fits; that row's `asked_at`
    // plus 24h is the answer. If it cannot be read, send NO retryAfter — the
    // client then says "in a few minutes" instead of a number that is wrong.
    const offset = Math.max(0, (total ?? 0) - DAILY_TOTAL_CAP - 1);
    const { data: oldest } = await admin.from("help_queries")
      .select("asked_at").gte("asked_at", dayAgo)
      .order("asked_at", { ascending: true }).range(offset, offset);
    const at = oldest?.[0]?.asked_at ? Date.parse(oldest[0].asked_at) : NaN;
    const secs = Number.isFinite(at) ? Math.ceil((at + 86_400_000 - Date.now()) / 1000) : NaN;
    const retryAfter = Number.isFinite(secs) && secs > 0 ? secs : null;
    return await releaseAnd("rate_limited", retryAfter ? { retryAfter } : {});
  }

  const topics = await loadGuide();
  if (!topics?.length) return await releaseAnd("unavailable");   // `[]` is truthy; see loadGuide

  // A read ERROR and an empty result must stay distinguishable: telling a client
  // they hold no policies because a SELECT failed is the invented answer FR-12
  // forbids, and the consumer has a separate notice for exactly this. ownRecords
  // throws on a query error rather than returning [] for precisely this reason.
  let facts: RecordFact[];
  try {
    facts = await ownRecords(admin, owner);
  } catch {
    return await releaseAnd("records_error");
  }
  const { system, messages } = buildPrompt({ question, topics, facts });

  // ─── THE BILLING LINE. Past here the reservation STAYS, whatever comes back,
  // because the call has been paid for. No `releaseAnd` below this point. ───

  let answer: string | null = null;
  try {
    const res = await anthropic.messages.create({
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
    if (res.stop_reason !== "end_turn") return unavailable("incomplete");
    // Extract by BLOCK TYPE, never content[0]: with thinking on, the first block
    // is a thinking block and content[0].text is undefined.
    answer = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || null;
  } catch (err) {
    // ⚠️ THE ONE RELEASE PAST THE BILLING LINE, and it is deliberate.
    //
    // An HTTP-status error means the provider REJECTED the request — a bad key,
    // an unknown model, exhausted credit, a 429 or a 529 overload. No tokens were
    // generated and nothing was billed, so holding the reservation charges the
    // caller for the provider's refusal. Measured against a stubbed SDK throwing
    // 529: twenty asks return "unavailable", the twenty-first returns
    // rate_limited, and the caller is still locked out an hour after the provider
    // recovers. On the shared daily cap, 400 such failures take the desk down for
    // everyone for a day — the exact failure releaseAnd exists to prevent.
    //
    // A connection error or timeout has NO status and keeps the row: the request
    // may well have been served and the response lost, and "billing unknown" must
    // resolve the same way as "billed".
    const status = (err as { status?: number } | null)?.status;
    if (typeof status === "number") return await releaseAnd("unavailable");
    return unavailable("unavailable");
  }
  if (!answer) return unavailable("incomplete");

  // The trailer carries the two things this function cannot know by itself:
  // WHICH help topics the answer drew on, and whether it declined a coverage
  // determination. Both were previously supplied wrongly — `usedTopics` credited
  // ALL topics on every answer, and `refused` was never emitted at all, so FR-8's
  // broker hand-off in the view was unreachable. Found by rendering the page.
  const split = splitTrailer(answer);
  // Stripping the trailer can leave nothing — a reply that is only protocol is
  // not an answer, and must not render as an empty bubble.
  if (!split.answer) return unavailable("incomplete");

  // Intersected with the ids actually SENT, here and not in prompt.ts, because
  // this is the only place that holds the corpus. A hallucinated id is dropped
  // rather than trusted; the browser drops unknown ids again in creditedTopics(),
  // which is belt-and-braces on purpose — a dead credit link is a client-visible
  // defect, and this one already shipped once as `#/keep/asset/:id`.
  const sent = new Set(topics.map((t) => t.id));
  const usedTopics = split.sourceIds.filter((id) => sent.has(id));
  // The SAME fix as usedTopics, applied to the half that was left behind.
  // `facts.map(...)` credited EVERY record on every answer: ask "where do I add a
  // business entity?" — answered from the corpus, touching no records — and the
  // client was told their renewal dates and premiums were the basis for an answer
  // about a button, on the refusal path too. Resolved through the same trailer,
  // and an unresolvable tag credits nothing rather than crediting record 0.
  const usedRecords = split.recordIds
    .map((tag) => facts[recordIndex(tag)])
    .filter((f): f is RecordFact => Boolean(f))
    // Clipped, like the prompt copy: these are the same client-written names,
    // and an unbounded one would be shipped to the browser and rendered.
    .map((f) => `${clipField(f.name)} — ${clipField(f.label)}: ${clipField(f.value)}`);

  return json({
    answer: split.answer,
    usedTopics,
    // Display LINES, not a count: FR-11 is "name what you drew on" so the client
    // can check it, and "3 records" is not checkable.
    usedRecords,
    // `refused` drives FR-8's hand-off, so it wins over the records distinction:
    // a declined coverage question is a refusal whether or not records were read.
    reason: split.refused ? "refused" : facts.length ? "answered" : "no_records",
  });
}
