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
  /** Service-role client. ⚠️ USE IT FOR `help_queries` AND NOTHING ELSE.
   *
   *  Measured on this project 2026-10-06:
   *    has_table_privilege('service_role','public.profiles','SELECT') -> FALSE
   *  and the same for entities, assets, policies and enhancement_requests.
   *  `service_role` holds only REFERENCES/TRIGGER/TRUNCATE there, is a member of
   *  no other role, and BYPASSRLS skips POLICIES, not PRIVILEGES. So a
   *  service-role read of a client record returns 42501 — every time, for every
   *  caller. `help_queries` works only because this feature's own migration
   *  grants it explicitly.
   *
   *  An earlier version of this file read every client record through `admin`,
   *  and would have failed on its first query the moment it was deployed, for
   *  everyone, permanently — rendered by FR-17 as the same quiet notice as "not
   *  deployed yet". The comment in that migration asserting Supabase grants
   *  service_role the public schema "by default" was simply false here. */
  admin: Db;
  /** A PostgREST client bound to THIS caller's bearer token, used for every
   *  client-record read. `authenticated` does hold SELECT on those tables, and
   *  RLS scopes each row to `owner = auth.uid()` — so the database enforces the
   *  boundary rather than a hand-written filter, which is strictly stronger than
   *  what it replaces: the IDOR mutation that survived the old suite was a
   *  DELETED `.eq("owner", owner)`, and RLS cannot be deleted from here at all.
   *  The explicit filters stay as defence in depth. */
  userDb: (authz: string) => Db;
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
// DEPLOY WITH THE DEFAULT — `verify_jwt` ON. An earlier version of this header
// argued at length for `--no-verify-jwt`, on two claims that were both false and
// both testable from here the whole time. The retired `desk-ask` stub is deployed
// with verify_jwt = true, which makes it a live control. Probed 2026-10-07:
//
//   OPTIONS with browser preflight headers and no Authorization returns the
//   STUB'S OWN body, with x-deno-execution-id set — the preflight REACHES the
//   function, so the flag does not block CORS;
//   POST with no Authorization, and POST with a malformed bearer, are both
//   refused by the gateway with no execution id — the function never runs.
//
// So the flag adds exactly what the old header said it did not: unauthenticated
// traffic stops before it is a billable invocation, rather than being parsed here
// and (with any bearer present) costing an Auth round trip. The handler's own 401
// stays — it is what resolves the caller — but it is no longer the only thing
// between an open endpoint and provider spend.
//
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

/** The client's own rows, read with THE CALLER'S OWN CLIENT — not the service key,
 *  which has no SELECT on any of these tables in this project (measured; see
 *  Deps.admin). This line said "the service key" for the whole life of that bug
 *  and outlived the fix. Filtered by the owner id
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
// Reads through the CALLER'S client, not the service-role one — see Deps.admin
// for the measurement that forced this. The `.eq`/`.in` filters are kept as
// defence in depth; RLS is what actually fences the rows.
// ⚠️ EXPLICIT ROW TYPES, and they are not decoration. `read<T>`/`inChunks<T>`
// cannot infer T from the PostgREST builder, so every call defaulted to
// `unknown` and `deno check help-ask/index.ts` reported 31 errors — 26 TS18046
// ("'e' is of type 'unknown'"), 3 TS2345, 2 TS7006 — in THIS file alone, while
// the deployed notify-enhancement checks clean. CI never runs Deno, so nothing
// here caught it and the PR claimed the Deno twin was "in step". If Supabase's
// deploy bundler type-checks, that is owner-gate step 6 failing.
//
// The names are the TABLE's, not the nested shape the views consume — the same
// trap that shipped `assets.kind`/`policies.policy_number` and made every
// client's records read as empty. Verified against supabase/migrations/.
interface EntityRow { id: string; name: string; kind: string }
interface AssetRow { id: string; name: string; type: string; value: number | null; entity_id: string }
interface PolicyRow {
  line: string;
  carrier: string | null;
  number: string | null;
  status: string | null;
  effective_date: string | null;
  renewal_date: string | null;
  premium_amount: number | null;
  premium_period: string | null;
  coverages: unknown;
  asset_id: string;
}

async function ownRecords(db: Db, owner: string): Promise<RecordFact[]> {
  const facts: RecordFact[] = [];
  const read = <T>(res: { data: T[] | null; error: { message: string } | null }, what: string): T[] => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data ?? [];
  };

  // ⚠️ CHUNKED, because PostgREST puts an `.in()` list in the query STRING — a
  // uuid costs ~37 chars there, so a long list eventually exceeds what the edge
  // will accept and the read fails PERMANENTLY for that client: self-inflicted by
  // owning enough assets, unreachable by any retry, and reachable deliberately by
  // anyone holding an account, the shared demo among them.
  //
  // ⚠️ THE THRESHOLD HERE WAS WRONG AND IS NOW MEASURED. It said "crossed 16KB at
  // roughly 410 ids and Cloudflare answered 520" — that was Supabase's documented
  // Cloudflare limit quoted as though it had been observed. Measured against this
  // project's live REST endpoint on 2026-10-07 (anon key, so 401 = the URL was
  // ACCEPTED and auth rejected it, 400 = the URL itself was refused):
  //     n=200  7,480 B -> 401      n=600  22,280 B -> 401
  //     n=410 15,250 B -> 401      n=640  23,760 B -> 401
  //     n=520 19,320 B -> 401      n=700  25,980 B -> 400  <- first refusal
  // So the real cliff is between 640 and 700 ids (~24-26KB) with a 400, not 410
  // ids at 16KB with a 520. Review round 5 measured the same thing authenticated.
  // The defect is real; only the numbers were borrowed. 200 ids is ~7.5KB, which
  // leaves roughly 3x margin.
  //
  // The filter is NOT dropped, though RLS makes it redundant today (`assets` has
  // no `owner` column; its policy is `exists (select 1 from entities e where
  // e.id = assets.entity_id and e.owner = auth.uid())`, exactly the set `ids`
  // describes). Two reasons to keep it: the header above commits to these filters
  // as defence in depth, so an `assets` table that later gains its own `owner`
  // column or loses a policy still has a fence here; and handler.test.mjs proves
  // cross-client isolation against a fake with no RLS, so removing the filter
  // would mean weakening the test that guards the property. Chunking fixes the
  // defect without touching either.
  //
  // 200 ids ≈ 7.5KB against a measured ~24.5-25.5KB cliff, so roughly 3x margin
  // (this line said "half the limit", which was arithmetic against the retracted
  // 16KB figure). A second round-trip only starts past 200 ids — well beyond any
  // real client.
  const CHUNK = 200;
  const inChunks = async <T>(
    values: string[],
    query: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    what: string,
  ): Promise<T[]> => {
    const out: T[] = [];
    for (let i = 0; i < values.length; i += CHUNK) {
      out.push(...read(await query(values.slice(i, i + CHUNK)), what));
    }
    return out;
  };

  const entities = read<EntityRow>(
    await db.from("entities").select("id, name, kind").eq("owner", owner), "entities");
  for (const e of entities) {
    facts.push({ kind: "entity", name: e.name, label: "type", value: String(e.kind) });
  }
  const ids = entities.map((e) => e.id);
  if (!ids.length) return facts;

  const assets = await inChunks<AssetRow>(ids, (chunk) =>
    db.from("assets").select("id, name, type, value, entity_id").in("entity_id", chunk), "assets");
  for (const a of assets) {
    facts.push({ kind: "asset", name: a.name, label: "type", value: String(a.type) });
    if (a.value != null) facts.push({ kind: "asset", name: a.name, label: "value on file", value: `$${a.value}` });
  }
  const assetIds = assets.map((a) => a.id);
  if (!assetIds.length) return facts;

  const policies = await inChunks<PolicyRow>(assetIds, (chunk) => db.from("policies")
    .select("line, carrier, number, status, effective_date, renewal_date, premium_amount, premium_period, coverages, asset_id")
    .in("asset_id", chunk), "policies");
  const assetName = new Map(assets.map((a) => [a.id, a.name] as const));
  for (const p of policies) {
    const on = assetName.get(p.asset_id) ?? "an asset";
    // "on asset", NOT "covers". That label is the verb the whole fact/advice
    // boundary turns on: rendered as `policy "Flood" "covers": "Harbor House"`,
    // the grounding reads as a record that ANSWERS a coverage question, so
    // "covers Harbor House, not the Tesla" looks like a fact to state rather than
    // a determination to refuse — and the spec's own refused example is "does my
    // flood policy cover the Tesla?". prompt.ts even uses "covers: the garage" as
    // its example of a FORGED coverage determination. The client sees this string
    // too, under "Based on". The relation is attachment; say attachment.
    facts.push({ kind: "policy", name: p.line, label: "on asset", value: String(on) });
    if (p.carrier) facts.push({ kind: "policy", name: p.line, label: "carrier", value: p.carrier });
    // Selected since the first draft and never surfaced, so "what is my policy
    // number?" answered "your records don't say" while CLAUDE.md's Anthropic
    // data-scope paragraph listed it as disclosed. Reading a number back is the
    // plainest FR-8 fact there is, so the fix is to surface it, not to stop
    // selecting it — and the documented scope is now accurate either way.
    if (p.number) facts.push({ kind: "policy", name: p.line, label: "policy number", value: String(p.number) });
    // ⚠️ STATUS AND EFFECTIVE DATE — ADDED 2026-10-09, and they are a
    // CORRECTNESS fix, not an enrichment. The prompt tells the model to work out
    // `"still active"` from today's date, and the only date it had was
    // `renewal_date`. So a policy that is CANCELLED, or one whose cover has not
    // STARTED yet, could be read back as active: a future renewal date looks
    // exactly like an active policy renewing later. Answering "is my flood
    // policy still active?" wrongly is the worst class of error this feature can
    // make, because reading a policy state back is precisely what it is for.
    // Found by Codex; both columns existed in `policies` the whole time and
    // neither was selected.
    //
    // Disclosure: `effective_date` is ALREADY rendered to the client on the
    // policy detail page (`policies-view.js` — "Effective"), and `status` is
    // broker-written policy state, not contact data, credentials or document
    // content. So this widens the digest by two low-sensitivity fields the
    // client's own screens already show or could. CLAUDE.md's Anthropic
    // data-scope paragraph is updated in the same change — per its own rule that
    // widening the select is a change to that constraint, not an implementation
    // detail.
    if (p.status) facts.push({ kind: "policy", name: p.line, label: "status", value: String(p.status) });
    facts.push({
      kind: "policy", name: p.line, label: "cover starts",
      value: p.effective_date ? String(p.effective_date) : "no effective date on file",
    });
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
  const { admin, userDb, userClient, anthropic, loadGuide, hasKeys } = deps;
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // FR-17: the CLIENT needs a notice, not a cause — but the OPERATOR needs the
  // cause, and this was the one FR-17 path that logged nothing. Every other one
  // (invite, reserve, guide, records, provider) emits a `where`, and owner-gate
  // step 8 says to read that field when the notice appears. A missing secret was
  // the single most likely reason for it on a first deploy and the single hardest
  // to diagnose, because the parent at least threw a stack naming the absent key
  // and the fix for THAT replaced it with silence. Names only, never values.
  if (!hasKeys) {
    console.error(JSON.stringify({ where: "config", message: "a required secret is unset" }));
    return unavailable("unavailable");
  }

  // These return the SHAPED payload at 200, not `{error}` at 400. A non-2xx makes
  // supabase-js surface an error with no body, so the client fell through to its
  // generic "unavailable" and `FAILURE_NOTICE.invalid` — a line written for
  // exactly this, "That question couldn't be read" — was unreachable code.
  let payload: { question?: string };
  try { payload = await req.json(); } catch { return unavailable("invalid"); }
  // typeof, not String(): `{"question":{"a":1}}` coerced to "[object Object]",
  // which passed validation, was stored, and was sent to the model as a question.
  const question = typeof payload?.question === "string" ? payload.question.trim() : "";
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
  // ⚠️ THIS CHECK ONLY HOLDS ONCE `supabase/proposed/20261006_profiles_no_client_insert.sql`
  // IS APPLIED, and the first version of this comment claimed otherwise.
  // `authenticated` currently holds INSERT on `public.profiles` with a
  // `with check (id = auth.uid())` policy, so a self-signed-up caller can create
  // the very row this reads — gating on a row the client can write is not a gate.
  // Measured on the live project; found by a security review of the commit that
  // added the check. That migration revokes the grant and drops the policy, which
  // is safe because nothing in `js/` inserts a profile and no trigger creates one
  // (verified both). Until it is applied this is defence in depth and not a
  // boundary, which is why the migration is part of the same owner gate.
  //
  // Turning sign-up off in the dashboard is the other half and is the owner's to
  // do; this half then holds even if it is ever turned back on.
  //
  // Returns the generic notice rather than a new reason: a stranger is owed
  // nothing more specific, and FR-17 means the client never sees a cause anyway.
  //
  // Read through the CALLER'S client: `service_role` has no SELECT on `profiles`
  // in this project (measured — see Deps.admin), so doing this with `admin`
  // returned 42501 for every caller and refused the whole feature permanently.
  const caller = userDb(authz);
  const { data: invited, error: inviteErr } = await caller
    .from("profiles").select("id").eq("id", owner).maybeSingle();
  if (inviteErr || !invited) {
    console.error(JSON.stringify({ where: "invite", code: inviteErr?.code ?? null, message: inviteErr?.message ?? "no profile row" }));
    return unavailable("unavailable");
  }

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
    // `{ owner }` only — the question TEXT is deliberately not stored. See the
    // help_queries migration: the throttle counts rows, and nothing reads the
    // text, so keeping it was indefinite retention of client free text with no
    // reader. The question still reaches the prompt; it just does not reach a table.
    .insert({ owner }).select("id").single();
  // Fails CLOSED. A missing table means the migration is not applied, and an
  // unthrottled paid endpoint is exactly what this exists to prevent — so
  // "cannot reserve" must never read as "go ahead".
  // `owner` is passed explicitly and is never taken from the request body: the
  // column's `default auth.uid()` is NULL under the service key, so an implicit
  // insert would fail the NOT NULL rather than silently mis-attribute.
  if (slotErr || !slot) {
    console.error(JSON.stringify({ where: "reserve", code: (slotErr as { code?: string })?.code ?? null, message: slotErr?.message ?? "no row returned" }));
    return unavailable("unavailable");
  }

  // EVERY exit from here until the provider call goes through `releaseAnd`, and
  // nothing after it does. Nothing has been billed yet on this side of the line,
  // so holding the row would let a transient failure eat the caller's hourly
  // allowance and the shared daily one — leaving the feature rate-limited after
  // its dependency recovered. Making it one helper rather than four open-coded
  // deletes is what lets a test assert the rule instead of trusting it: see
  // contract.test.mjs, which fails on a bare `unavailable(` in this region. Two
  // of the four paths did not release before that test existed.
  // ⚠️ THE DELETE'S RESULT IS CHECKED, and discarding it was a real hole: a
  // failed release reads exactly like a successful one. PostgREST resolves a
  // failed DELETE with `{ error }` rather than throwing, so a transient 5xx, a
  // network blip or a privilege regression left the reservation in place while
  // this returned the notice as though it had been given back — an UNBILLED
  // attempt counted against the caller's 20/hour and the shared 400/day. Repeat
  // that and the desk is locked out for the caller, or for everyone, after the
  // dependency it was failing on has recovered. Found by Codex, round 21.
  // Retried once because the statement is idempotent (`eq("id", slot.id)` on a
  // row only this request knows about), and logged with the same `where` shape as
  // every other failure here if it still does not take — an operator reading the
  // logs is the only way this is ever noticed.
  const releaseAnd = async (reason: string, extra: Record<string, unknown> = {}) => {
    let relErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await admin.from("help_queries").delete().eq("id", slot.id);
      relErr = error ?? null;
      if (!relErr) break;
    }
    if (relErr) {
      console.error(JSON.stringify({
        where: "release", reason,
        code: (relErr as { code?: string })?.code ?? null,
        message: (relErr as { message?: string })?.message ?? "unknown",
      }));
    }
    return unavailable(reason, extra);
  };

  // ── HOW LONG UNTIL AN ASK FITS AGAIN, in seconds, or null if it cannot be
  // worked out. ONE piece of arithmetic for BOTH caps, because the hourly branch
  // sent a flat 3600 until round 20 while the shared branch had already been
  // fixed twice — two copies of a wait calculation is how one of them stays
  // wrong. `scoped` carries the branch's own filter (per-owner, or none), so the
  // only difference between the callers is the window and the cap.
  //
  // COUNTED FROM SURVIVORS, NOT FROM THE REJECTING COUNT. The count that
  // rejected includes every CONCURRENT reservation, and each rejected one
  // deletes its own row on the way out. At the hourly cap that means two
  // simultaneous asks with 19 retained rows both see 21, both refuse, and both
  // would have said "wait an hour" — when the table drops straight back to 19
  // and the next ask is admissible immediately.
  //
  // A row younger than GRACE_MS might be such a peer, and nothing here can tell
  // a peer's row from a real one, so they are all excluded: the count is what
  // will still be present once this rejection has released itself. Deliberately
  // the conservative direction — it can say "retry sooner than strictly
  // possible" (another refusal, which is cheap and honest) and will not promise a
  // wait that is not real. Symmetric in the race, unlike filtering on this
  // request's own timestamp: a peer that reserved microseconds EARLIER is
  // excluded too.
  //
  // ⚠️ A NEGATIVE OFFSET MEANS NOTHING HAS TO EXPIRE, AND THAT SENDS A SHORT
  // NUMBER — not nothing. Omitting it was an earlier version of the shared fix,
  // on the strength of a comment claiming the consumer would then say "in a few
  // minutes". IT DOES NOT: `rateLimitNotice` reads a capped refusal with no
  // number as "try again tomorrow" (js/keep/logic/help.js), which reproduces the
  // ~24-hour overstatement this exists to remove — it just moves it from the
  // function to the view.
  //
  // ⚠️ The exact answer needs the reserve and the count to be ONE atomic
  // statement — a Postgres function, so a migration and an owner decision.
  // Recorded in CLAUDE.md rather than approximated further.
  const GRACE_MS = 5_000;
  // The PostgREST builder, structurally. `scoped` only ever chains one filter
  // onto it, so naming the real generic type here would buy nothing and pin this
  // helper to a supabase-js version.
  // deno-lint-ignore no-explicit-any
  type Builder = any;
  // ⚠️ `failed` IS NOT COSMETIC, and conflating it with `seconds: null` was a
  // real regression. Both outcomes used to be a bare `null`, and the two mean
  // opposite things to the consumer: "nothing has to expire, I just cannot name
  // a number" versus "a query failed and I know nothing". `rateLimitNotice`
  // renders a CLIENT-scope refusal with no number as **"Please try again in a
  // few minutes"** (js/keep/logic/help.js), so a transient PostgREST error on a
  // caller who is 5 minutes into a 60-minute window told them to come back in a
  // few minutes — for a block with 55 minutes left, over and over, with nothing
  // logged. The flat 3600 this replaced OVERSTATED, which is the safe direction;
  // the refactor swapped it for an understatement. Found by an independent
  // silent-failure review of the round-20 commit.
  // So the two are distinguished, each failure is LOGGED with the `where` field
  // owner-gate step 8 tells an operator to read, and the hourly caller falls back
  // to the window itself — the old upper bound — when `failed`.
  const retryAfterFor = async (
    windowStart: string, windowMs: number, cap: number, scoped: (q: Builder) => Builder,
  ): Promise<{ seconds: number | null; failed: boolean }> => {
    const fail = (stage: string, err: unknown) => {
      console.error(JSON.stringify({
        where: "retry_after", stage,
        code: (err as { code?: string })?.code ?? null,
        message: (err as { message?: string })?.message ?? "unknown",
      }));
      return { seconds: null, failed: true };
    };
    // ⚠️ THE WHOLE BODY IS WRAPPED, because everything past here is on the
    // reserved side of the line and `releaseAnd` has not run yet. postgrest-js
    // returns errors rather than throwing, so a rejection needs a rejecting
    // fetch underneath it — but if one happens, the throw escapes `handle()`,
    // `index.ts` wraps it in no try/catch, and the caller gets a bare 500 with
    // no CORS headers **and the reservation is never deleted**: a refused ask
    // would eat one of the caller's 20 hourly slots and one of the 400 daily
    // ones having billed nothing. That is the exact failure `releaseAnd` exists
    // to prevent. Same review.
    try {
      const settled = new Date(Date.now() - GRACE_MS).toISOString();
      // ⚠️ OUR OWN RESERVATION IS EXCLUDED BY ID, NOT BY AGE, and leaving it to
      // the grace was a real error. The grace exists for rows that MIGHT be
      // peers about to release; this row is one we KNOW will be released, two
      // lines further down, by `releaseAnd`. If the insert and the count are
      // more than GRACE_MS apart — a slow count, a cold function, a retried
      // query — our own row ages past the grace and is counted as settled, so
      // with 20 retained hourly rows the offset comes out 1 and the answer is
      // the SECOND-oldest row's expiry when only the oldest has to go. Found by
      // Codex, round 23, against the redesign that was supposed to have removed
      // this class.
      // Exact where it can be exact: the id is known, so no approximation is
      // needed for it. The grace still covers OTHER requests' reservations,
      // which is the residual the billing-line marker would close.
      const { count: survivors, error: survErr } = await scoped(
        admin.from("help_queries").select("id", { count: "exact", head: true }),
      ).neq("id", slot.id).gte("asked_at", windowStart).lt("asked_at", settled);
      if (survErr) return fail("survivors", survErr);
      // An ask fits when the retained count is at most cap-1, so `survivors - cap`
      // is the 0-based index of the last row that has to expire.
      const offset = (survivors ?? 0) - cap;
      // ⚠️ AMBIGUOUS — AND IT NO LONGER INVENTS A NUMBER FOR IT. A negative
      // offset means the refusal is explained only by rows younger than the
      // grace, and nothing here can tell which of those will be DELETED (a peer
      // about to release) from which will STAY for the whole window (a real ask
      // already past the billing line). The two readings are "retry in seconds"
      // and "retry in up to an hour", and no age-based rule gets both right:
      // counting survivors understates (20 real asks inside five seconds get
      // told "about a minute" for an hour-long block — Codex, round 22, and an
      // independent review before it), counting every row but our own overstates
      // in the concurrent case this grace was added for (Codex, round 20).
      // So the function stops answering a question it cannot answer: no
      // `retryAfter`, and the caller sends the WINDOW instead, which is true
      // whichever reading holds. See the note on the callers.
      if (offset < 0) return { seconds: null, failed: false };
      // Excluded here too, or the index can land ON our own row and report the
      // expiry of a reservation that is about to be deleted.
      const { data: oldest, error: oldErr } = await scoped(
        admin.from("help_queries").select("asked_at"),
      ).neq("id", slot.id).gte("asked_at", windowStart).order("asked_at", { ascending: true }).range(offset, offset);
      // ⚠️ THIS ERROR WAS DESTRUCTURED AWAY. `{ data: oldest }` alone turned a
      // failed select into `at = NaN` → `secs = NaN` → a silent `null`, which is
      // the understatement above with no trace of a cause.
      if (oldErr) return fail("oldest", oldErr);
      const at = oldest?.[0]?.asked_at ? Date.parse(oldest[0].asked_at) : NaN;
      const secs = Number.isFinite(at) ? Math.ceil((at + windowMs - Date.now()) / 1000) : NaN;
      // A legitimate `null`: the rows aged out or were released between the two
      // queries, so nothing has to expire after all. NOT a failure — the caller
      // must not promise the whole window for it.
      return { seconds: Number.isFinite(secs) && secs > 0 ? secs : null, failed: false };
    } catch (e) {
      return fail("threw", e);
    }
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
  // `scope` so the consumer can word this correctly. Without it the view guessed
  // from the WAIT LENGTH, which told a client who had asked nothing all day
  // "You've asked a few questions in a short time" whenever the SHARED cap
  // happened to clear in under 90 minutes — the common case for a rolling window.
  // ⚠️ NOT A FLAT 3600 — that is what this sent for five review rounds. An hour
  // is a true UPPER bound for a one-hour rolling window, which is why it read as
  // safe; but it is an hour's lockout quoted to a client whose oldest ask is 59
  // minutes old, and in the concurrent case above to one who could retry now.
  // The window is rolling, so the honest answer is when the oldest row that has
  // to age out actually does. Found by Codex, round 20, pointing at the fix the
  // shared cap had already had.
  if ((count ?? 0) > HOURLY_CAP) {
    const wait = await retryAfterFor(since, 3600_000, HOURLY_CAP, (q) => q.eq("owner", owner));
    // ⚠️ `window` IS SENT WHENEVER `retryAfter` IS NOT, and that pairing is the
    // whole redesign. Three rounds running, this branch tried to express
    // uncertainty as a DURATION — a flat 3600 (overstated), then an omission
    // (which the view read as "a few minutes", understating), then a five-second
    // grace (understating by up to an hour). A single number cannot carry "I do
    // not know, but it is bounded by this", so the contract now carries the bound
    // separately and the view has wording that is true across the whole of it.
    // `global.md` → Review Rounds Have to Terminate: the third failure of one
    // mechanism is a redesign, not another patch.
    // `retryAfter` is sent ONLY when it is derived from settled rows alone, i.e.
    // when it is actually known.
    const WINDOW_S = 3600;
    return await releaseAnd("rate_limited", {
      scope: "client",
      ...(wait.seconds ? { retryAfter: wait.seconds } : { window: WINDOW_S }),
    });
  }

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
    // NOT 3600, and not a flat anything. This is a ROLLING 24-HOUR window: 400
    // calls in the last hour means the cap holds for nearly another 23, so "try
    // again in an hour" would be a promise the endpoint cannot keep. The cap
    // clears when enough rows age out, and `retryAfterFor` works out which row
    // that is — see its note for why the count comes from survivors rather than
    // from `total`, and why a negative offset still sends a short number.
    // Same pairing as the hourly branch above: a number only when it is known,
    // and the window otherwise. `scope` is what lets the view word the two caps
    // differently — without it the view guessed from the WAIT LENGTH, and told a
    // client who had asked nothing all day "You've asked a few questions in a
    // short time" whenever the shared cap happened to clear in under 90 minutes.
    const wait = await retryAfterFor(dayAgo, 86_400_000, DAILY_TOTAL_CAP, (q) => q);
    const WINDOW_S = 86_400;
    return await releaseAnd("rate_limited", {
      scope: "shared",
      ...(wait.seconds ? { retryAfter: wait.seconds } : { window: WINDOW_S }),
    });
  }

  const topics = await loadGuide();
  if (!topics?.length) { console.error(JSON.stringify({ where: "guide", message: "corpus empty or unreachable" })); return await releaseAnd("unavailable"); }

  // A read ERROR and an empty result must stay distinguishable: telling a client
  // they hold no policies because a SELECT failed is the invented answer FR-12
  // forbids, and the consumer has a separate notice for exactly this. ownRecords
  // throws on a query error rather than returning [] for precisely this reason.
  let facts: RecordFact[];
  try {
    facts = await ownRecords(caller, owner);
  } catch (e) {
    console.error(JSON.stringify({ where: "records", message: (e as Error)?.message ?? "unknown" }));
    return await releaseAnd("records_error");
  }
  // TODAY, as grounding rather than a record: without it the model answered "is
  // my policy still active?" and "what renews soon?" from its own guess at the
  // date, against renewal dates it had been given in full. Passed separately so
  // it does not take a record tag or make a record-less client look stocked.
  const { system, messages, sentRecordIds } = buildPrompt({ question, topics, facts, today: new Date().toISOString().slice(0, 10) });

  // ─── THE BILLING LINE. Past here the reservation STAYS, whatever comes back,
  // because the call has been paid for. No `releaseAnd` below this point. ───

  let answer: string | null = null;
  try {
    const res = await anthropic.messages.create({
      model: "claude-opus-5-5",
      // 8192, not 2048. Thinking cannot be disabled on this model and counts
      // against this budget, and the comment below already calls a max_tokens cut
      // "realistic" — each cut is billed, spends one of the caller's 20 hourly
      // slots, and shows them "didn't come through in full". A help-desk answer
      // is a few short paragraphs, so the ceiling costs nothing when it is not
      // needed and buys the thinking room when it is.
      max_tokens: 8192,
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
    const blocks = (res.content ?? []) as Array<{ type: string; text?: string }>;
    answer = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim() || null;
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
    const e = err as { status?: number; name?: string; message?: string } | null;
    // No question text and no record values — a cause, not content.
    console.error(JSON.stringify({ where: "provider", status: e?.status ?? null, name: e?.name ?? null, message: e?.message ?? null }));
    const status = e?.status;
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
  // ⚠️ INTERSECT WITH WHAT WAS ACTUALLY SENT, exactly as usedTopics does one
  // line above. Resolving against the whole `facts` array credited records the
  // model never received: FACT_LIMITS drops lines past 400 or past the 16k char
  // budget, so a credited `r401` — hallucinated, or induced by a client who put
  // it in a name — produced a client-visible "Based on" line for a fact that was
  // never in the prompt. FR-11's promise is that the client can CHECK what the
  // answer drew on, so a false provenance line is worse than no line.
  const sentRecords = new Set(sentRecordIds);
  const usedRecords = split.recordIds
    .filter((tag) => sentRecords.has(tag))
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
