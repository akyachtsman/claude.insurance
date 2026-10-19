// handler.test.mjs — EXECUTES the Help desk handler against in-memory fakes.
//
// Everything about this feature's security was previously asserted by reading
// index.ts as text. An independent review mutation-tested that: seven of eight
// behaviour-breaking edits left all 262 tests green, including dropping
// `.eq("owner", owner)` from the entity read — a cross-client read, and the exact
// IDOR this feature's headline claim is about. `test.md`: "Assert the outcome,
// not the mechanism. Stub the collaborators, never the subject."
//
// So: the subject is handler.ts, run for real. The collaborators (PostgREST,
// Supabase Auth, Anthropic, the corpus fetch) are fakes. Every assertion below is
// on the RESPONSE or on what the fake database was actually asked for.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handle, resolveModel, HELP_MODELS, DEFAULT_HELP_MODEL,
  resolveSupabaseKey, DEFAULT_API_KEY_NAME,
} from "./handler.ts";

// ── A PostgREST-shaped fake. It records every query it is asked to run, so a
//    test can assert what was NOT scoped as easily as what came back.
// `denied` models a PRIVILEGE boundary, which is the thing the first version of
// this fake left out — and leaving it out is why a review, not a test, found
// that `service_role` has NO select on profiles/entities/assets/policies in this
// project (measured: has_table_privilege -> false on all four; BYPASSRLS skips
// policies, not privileges). The handler read every client record through the
// service-role client and would have returned 42501 to every caller on the first
// query after deploy, forever. A fake with no privileges cannot fail that way,
// so the claim under test was exactly the thing being faked.
function fakeDb(tables = {}, opts = {}) {
  const log = [];
  const counts = {};
  const dels = {};
  const api = {
    log, tables,
    from(table) {
      const q = { table, filters: [], _count: null, _head: false };
      log.push(q);
      const run = () => {
        if (q._selectFails) return { data: null, error: { message: `count failed: ${table}` }, count: null };
        if (opts.denied?.includes(table)) {
          return { data: null, error: { code: "42501", message: `permission denied for table ${table}` }, count: null };
        }
        if (opts.fail?.[table]) return { data: null, error: { message: `boom:${table}` }, count: null };
        let rows = (tables[table] ?? []).filter((r) =>
          q.filters.every(([op, col, val]) =>
            op === "eq" ? r[col] === val
              : op === "in" ? val.includes(r[col])
              : op === "gte" ? String(r[col]) >= String(val)
              : op === "lt" ? String(r[col]) < String(val)
              : op === "neq" ? r[col] !== val
              // ⚠️ THROW, do not pass. This used to be `: true`, so a filter the
              // fake did not implement was SILENTLY IGNORED — and a test written
              // for a fix that depends on that filter would pass against code
              // that never applied it. Found while adding `lt`.
              : (() => { throw new Error(`fakeDb: unimplemented filter op ${op} on ${table}.${col}`); })()));
        if (q._order) rows = [...rows].sort((a, b) => String(a[q._order]).localeCompare(String(b[q._order])));
        if (q._range) rows = rows.slice(q._range[0], q._range[1] + 1);
        return { data: rows, error: null, count: rows.length };
      };
      const chain = {
        select(_cols, o = {}) {
          q._head = Boolean(o.head); q._count = o.count ?? null;
          // `failSelect: { help_queries: n }` errors the Nth select on that
          // table, which is how a count failure is reachable while the insert
          // that precedes it still works.
          const n = (counts[table] = (counts[table] ?? 0) + 1);
          if (opts.failSelect?.[table] === n) q._selectFails = true;
          return chain;
        },
        eq(c, v) { q.filters.push(["eq", c, v]); return chain; },
        in(c, v) { q.filters.push(["in", c, v]); return chain; },
        gte(c, v) { q.filters.push(["gte", c, v]); return chain; },
        lt(c, v) { q.filters.push(["lt", c, v]); return chain; },
        neq(c, v) { q.filters.push(["neq", c, v]); return chain; },
        order(c) { q._order = c; return chain; },
        range(a, b) { q._range = [a, b]; return chain; },
        insert(row) {
          q.inserted = row;
          if (opts.denied?.includes(table) || opts.fail?.[table]) return chain;
          const id = `row-${(tables[table] ??= []).length + 1}`;
          tables[table].push({ id, ...row, asked_at: opts.now ?? new Date().toISOString() });
          q._single = { id };
          return chain;
        },
        delete() {
          q.deleted = true; q._delete = true;
          // `failDelete: { help_queries: n }` errors the Nth delete on that
          // table. Added for the release-retry path: the fake used to resolve
          // EVERY delete as `{ error: null }`, so a test could not tell a failed
          // release from a successful one — which is precisely the bug the
          // handler had. A fake that cannot fail cannot test a failure.
          const n = (dels[table] = (dels[table] ?? 0) + 1);
          const want = opts.failDelete?.[table];
          if (want === n || want === "all") q._deleteFails = true;
          return chain;
        },
        maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
        single() {
          if (opts.denied?.includes(table)) return Promise.resolve({ data: null, error: { code: "42501", message: `permission denied for table ${table}` } });
          if (opts.fail?.[table]) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: q._single ?? run().data?.[0] ?? null, error: null });
        },
        then(res, rej) {
          if (q._delete) {
            if (q._deleteFails) {
              return Promise.resolve({ data: null, error: { message: `delete failed: ${table}` } }).then(res, rej);
            }
            const doomed = new Set(run().data.map((r) => r.id));
            tables[table] = (tables[table] ?? []).filter((r) => !doomed.has(r.id));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
          return Promise.resolve(run()).then(res, rej);
        },
      };
      return chain;
    },
  };
  return api;
}

const TOPIC = { id: "insurance", title: "All your policies", route: "#/keep/insurance", nav: "Policies", body: "Every policy.", ask: "Where are my policies?" };
const OWNER = "owner-1";
const OTHER = "owner-2";

function seed(extra = {}) {
  return {
    profiles: [{ id: OWNER }],
    help_queries: [],
    // Empty by default ON PURPOSE, so every pre-existing test keeps exercising
    // the `HELP_MODEL`-or-default path. The stored-tier tests seed a row.
    help_settings: [],
    entities: [
      { id: "e1", owner: OWNER, name: "Me", kind: "personal" },
      { id: "e9", owner: OTHER, name: "Someone Else", kind: "personal" },
    ],
    assets: [
      { id: "a1", entity_id: "e1", name: "Harbour House", type: "home", value: 900000 },
      { id: "a9", entity_id: "e9", name: "SECRET BOAT", type: "boat", value: 1 },
    ],
    policies: [
      { asset_id: "a1", line: "Home", carrier: "Acme", number: "HO-1", renewal_date: "2027-03-12", premium_amount: 2400, premium_period: "yr", coverages: [{ label: "Dwelling", limit: "$400,000" }] },
      { asset_id: "a9", line: "SECRET MARINE", carrier: "X", number: "B-9", renewal_date: null, premium_amount: null, coverages: [] },
    ],
    ...extra,
  };
}

// The live ACL, encoded. `service_role` holds no SELECT/INSERT on any of these.
// ⚠️ `help_queries` and `help_settings` are DELIBERATELY ABSENT: those two are
// the only tables whose migrations grant `service_role` explicitly, which is the
// whole reason the function may touch them with `admin`. Measured end state for
// help_settings, 2026-10-14: anon nothing, service_role SELECT, authenticated
// SELECT + UPDATE(model).
const SERVICE_ROLE_DENIED = ["profiles", "entities", "assets", "policies", "enhancement_requests"];

function deps(over = {}) {
  const tables = over.tables ?? seed();
  // ONE backing store, TWO clients with different privileges — exactly the live
  // split. `admin` may touch help_queries only; everything else is 42501.
  // ⚠️ `denied` SITS AFTER THE SPREAD, so `dbOpts: { denied: [...] }` is silently
  // DISCARDED here — a trap this file's first stored-tier test fell into, where
  // the denial never engaged and the test read as a wrong fallback rather than
  // as a harness error. `adminDenied` is the composable door, and it is
  // admin-only on purpose: the two clients have different ACLs, and widening the
  // CALLER's denials would break the invite read and fail the ask for an
  // unrelated reason.
  const admin = over.db ?? fakeDb(tables, {
    ...(over.dbOpts ?? {}),
    denied: [...SERVICE_ROLE_DENIED, ...(over.adminDenied ?? [])],
  });
  const caller = fakeDb(tables, { ...(over.dbOpts ?? {}), denied: ["help_queries"] });
  return {
    // `rows(t)` rather than a captured array: the fake replaces the array on a
    // delete, so a captured reference would report the pre-delete length and
    // every "was it given back?" assertion would pass without measuring.
    rows: (t) => admin.tables[t] ?? [], tables, db: admin, caller,
    d: {
      admin,
      userDb: () => caller,
      userClient: over.userClient ?? (async () => ({ data: { user: { id: OWNER } } })),
      anthropic: over.anthropic ?? { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Your policies are on the Policies screen.\n[[SOURCES]] insurance\n[[RECORDS]] r1" }] }) } },
      loadGuide: over.loadGuide ?? (async () => [TOPIC]),
      appUrl: "https://example.test",
      hasKeys: over.hasKeys ?? true,
      ...over.d,
    },
  };
}

const ask = (d, body = { question: "Where are my policies?" }, headers = { Authorization: "Bearer t" }) =>
  handle(new Request("https://fn.test/help-ask", { method: "POST", headers, body: JSON.stringify(body) }), d);

// ─────────────────────────────────────────────────────────────────────────────
// FR-14 — the records in the prompt are the CALLER'S, and nobody else's.
// ─────────────────────────────────────────────────────────────────────────────
test("another client's entities, assets and policies never reach the prompt", async () => {
  let sent = "";
  const { d } = deps({ anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  const res = await ask(d);
  assert.equal(res.status, 200);
  assert.ok(sent.includes("Harbour House"), "the caller's own asset did not reach the prompt");
  assert.ok(!sent.includes("SECRET BOAT"), "ANOTHER CLIENT'S ASSET reached the prompt");
  assert.ok(!sent.includes("SECRET MARINE"), "ANOTHER CLIENT'S POLICY reached the prompt");
  assert.ok(!sent.includes("Someone Else"), "ANOTHER CLIENT'S ENTITY reached the prompt");
});

test("the entity read is scoped to the caller, by owner", async () => {
  // The mutation that survived the old suite: dropping this filter.
  const { d, caller } = deps();
  await ask(d);
  const ent = caller.log.find((q) => q.table === "entities");
  assert.ok(ent, "no entity query was made");
  assert.deepEqual(ent.filters.filter(([op]) => op === "eq"), [["eq", "owner", OWNER]],
    "the entity read is not scoped to the caller — a service-role client bypasses RLS, so this filter IS the fence");
});

test("owner comes from the JWT, never from the request body", async () => {
  let sent = "";
  const { d } = deps({ anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  await ask(d, { question: "hi", owner: OTHER, ownerId: OTHER, user_id: OTHER });
  assert.ok(!sent.includes("SECRET BOAT"), "a body-supplied owner redirected the record read");
});

test("no Authorization header is rejected before any database work", async () => {
  const { d, db } = deps();
  const res = await ask(d, { question: "hi" }, {});
  assert.equal(res.status, 401);
  assert.deepEqual(db.log, [], "a database query ran for an unauthenticated caller");
});

test("a caller with no profiles row is refused — sign-up is public, invitation is not", async () => {
  const { d, db } = deps({ tables: seed({ profiles: [] }) });
  const res = await ask(d);
  assert.equal((await res.json()).answer, null);
  assert.ok(!db.log.some((q) => q.table === "help_queries" && q.inserted),
    "an uninvited caller reserved a throttle slot");
});

// ─────────────────────────────────────────────────────────────────────────────
// The throttle. Every one of these boundaries survived the old suite.
// ─────────────────────────────────────────────────────────────────────────────
test("the hourly cap admits the 20th ask and refuses the 21st", async () => {
  const hour = new Date().toISOString();
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: hour }));

  const under = deps({ tables: seed({ help_queries: rows(19) }) });
  assert.equal((await (await ask(under.d)).json()).reason, "answered", "the 20th ask was refused");

  const over = deps({ tables: seed({ help_queries: rows(20) }) });
  const body = await (await ask(over.d)).json();
  assert.equal(body.reason, "rate_limited", "the 21st ask was allowed");
  assert.equal(body.scope, "client");
  // ⚠️ NO NUMBER, AND THE WINDOW INSTEAD — and this assertion has now been
  // rewritten twice, which is the history worth keeping. It first required 3600
  // (a flat hour, which overstates for a client 59 minutes in), then 5 (the
  // grace, which UNDERSTATES by up to an hour for exactly this seed: these
  // twenty rows are real asks that will be billed and will hold the cap for the
  // full window, and nothing distinguishes them from a peer about to release).
  // Codex found that in round 22 against the seed this very test had pinned.
  // The function no longer answers it: `window` is true whichever reading holds,
  // and `rateLimitNotice` has wording for a bounded-but-unknown wait.
  assert.equal(body.retryAfter, undefined,
    "the function invented a wait it cannot derive — 20 real asks inside the grace hold the cap for the hour");
  assert.equal(body.window, 3600, "a refusal with no derivable wait must still carry its window");
});

test("the hourly retry time is when the oldest SETTLED ask actually ages out", async () => {
  // The case the grace window does not cover, and the one a real client hits: a
  // person who asked twenty questions earlier in the hour. Those rows are
  // settled, so they count — the cap holds until the oldest leaves the rolling
  // window, which is 10 minutes away here, NOT the 60 the old code promised.
  const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: minsAgo(50) }));
  const { d } = deps({ tables: seed({ help_queries: rows }) });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "rate_limited");
  assert.equal(body.scope, "client");
  assert.ok(body.retryAfter > 560 && body.retryAfter <= 610,
    `expected ~600s until the oldest ask ages out, got ${body.retryAfter}`);
});

test("the hourly retry time counts only the CALLER's rows", async () => {
  // `retryAfterFor` takes the branch's filter as an argument, so the hourly call
  // could pass `(q) => q` and read the whole table. The wait would then come off
  // a row belonging to someone else.
  //
  // ⚠️ THE SEED IS THE TEST, and the first version of it caught nothing. With
  // the other client's rows seeded OLDER than the caller's, the offset landed on
  // the caller's oldest row either way and both answers were 1800 — a passing
  // test against the unscoped code. Mutation-tested after the rewrite: 300 rows
  // 5 minutes old, NEWER than the caller's, so the unscoped offset (320-20=300)
  // lands on one of THOSE and quotes 3300s instead of the caller's own 600s.
  const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  const { d } = deps({ tables: seed({ help_queries: [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: minsAgo(50) })),
    ...Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, owner: OTHER, asked_at: minsAgo(5) })),
  ] }) });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "rate_limited");
  assert.equal(body.scope, "client");
  assert.ok(body.retryAfter > 560 && body.retryAfter <= 610,
    `expected ~600s from the caller's own oldest row, got ${body.retryAfter}`);
});

test("the hourly count is scoped to the caller — another client's asks do not count", async () => {
  // 300, not 500: above 400 the DAILY cap fires instead, which is correct and is
  // the next test. The first draft used 500 and read the daily refusal as an
  // hourly-scoping failure.
  const hour = new Date().toISOString();
  const theirs = Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, owner: OTHER, asked_at: hour }));
  const { d } = deps({ tables: seed({ help_queries: theirs }) });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "answered", "another client's asks consumed this caller's hourly allowance");
});

test("the daily cap DOES count every client — the stated trade-off, asserted", async () => {
  // CLAUDE.md and the function both say this plainly: one abuser can take the
  // desk down for everyone, and that is the accepted cost of bounding spend.
  // Asserted so it is a decision on the record rather than a surprise.
  const hour = new Date().toISOString();
  const theirs = Array.from({ length: 400 }, (_, i) => ({ id: `o${i}`, owner: OTHER, asked_at: hour }));
  const { d } = deps({ tables: seed({ help_queries: theirs }) });
  assert.equal((await (await ask(d)).json()).reason, "rate_limited");
});

test("the shared-cap retry time is read from rows that will SURVIVE the rejection", async () => {
  // Two cases in one test because the pair is the point: the same cap, the same
  // refusal, a retry time present in one and absent in the other.
  //
  // ⚠️ `asked_at` here is HOURS old, not `new Date()`. The other daily-cap tests
  // seed "now", which the 5s grace window excludes — so they would report no
  // retry time whatever the arithmetic did, and could not tell these cases apart.
  const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

  // 400 SETTLED rows: one really must expire, so there is a real number.
  const settled = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, owner: OTHER, asked_at: hoursAgo(6) }));
  const a = await (await ask(deps({ tables: seed({ help_queries: settled }) }).d)).json();
  assert.equal(a.reason, "rate_limited");
  assert.equal(a.scope, "shared");
  assert.ok(Number.isFinite(a.retryAfter) && a.retryAfter > 0,
    `a real shared-cap wait reported no retry time: ${JSON.stringify(a)}`);
  // The oldest row is 6h old, so it expires in ~18h. Generous bounds: the claim
  // under test is "derived from that row", not the clock.
  assert.ok(a.retryAfter > 17 * 3600 && a.retryAfter < 19 * 3600,
    `retryAfter is not the oldest row's expiry: ${a.retryAfter}s`);

  // 399 SETTLED rows plus ONE CONCURRENT PEER, which is about to delete its own
  // reservation — so the table falls straight back to 399 and the next ask fits
  // immediately. Promising a ~24h wait here is the defect.
  const racing = [
    ...Array.from({ length: 399 }, (_, i) => ({ id: `s${i}`, owner: OTHER, asked_at: hoursAgo(6) })),
    { id: "peer", owner: OTHER, asked_at: new Date().toISOString() },
  ];
  const b = await (await ask(deps({ tables: seed({ help_queries: racing }) }).d)).json();
  assert.equal(b.reason, "rate_limited", "the cap did not fire at all — the setup is wrong, not the fix");
  assert.equal(b.scope, "shared");
  // ⚠️ NO NUMBER, AND THE WINDOW — rewritten from "a SHORT number, not no
  // number", which was right about its own round and wrong about the next. That
  // version justified itself on the view rendering a numberless shared refusal as
  // "try again TOMORROW"; the view now has a third wording for exactly this
  // state, so the justification expired. The ambiguity is real and the function
  // says so instead of guessing: the peer may release and let the next ask
  // straight through, or it may be a billable call that holds the cap for hours.
  assert.equal(b.retryAfter, undefined,
    `a concurrent reservation produced ${JSON.stringify(b.retryAfter)} — the wait is not derivable here`);
  assert.equal(b.window, 86_400, "a shared refusal with no derivable wait must still carry its window");
});

test("a refused ask gives its reservation back; an answered one keeps it", async () => {
  const hour = new Date().toISOString();
  const over = deps({ tables: seed({ help_queries: Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: hour })) }) });
  await ask(over.d);
  assert.equal(over.rows('help_queries').length, 20, "the over-cap reservation was not released");

  const ok = deps();
  await ask(ok.d);
  assert.equal(ok.rows('help_queries').length, 1, "an answered ask did not keep its reservation");
});

test("a provider HTTP error refunds the reservation; a connection error does not", async () => {
  const http = deps({ anthropic: { messages: { create: async () => { const e = new Error("overloaded"); e.status = 529; throw e; } } } });
  assert.equal((await (await ask(http.d)).json()).reason, "unavailable");
  assert.equal(http.rows('help_queries').length, 0, "a rejected (unbilled) request kept the caller's slot");

  const conn = deps({ anthropic: { messages: { create: async () => { throw new Error("socket hang up"); } } } });
  await ask(conn.d);
  assert.equal(conn.rows('help_queries').length, 1, "a timeout released the slot, but billing was unknown");
});

// ─────────────────────────────────────────────────────────────────────────────
// A BILLED NON-ANSWER MUST BE FINDABLE, not just correct.
//
// ⚠️ These three exits were COMPLETELY SILENT until 2026-10-14. `unavailable()`
// carries no `console.error`, so unlike the provider-error path (`where:
// "provider"`) they left no log line anywhere — and they return HTTP 200 with
// the reservation kept, exactly like a success. So in `edge_logs` /
// `function_edge_logs` a billed call that produced no answer was
// INDISTINGUISHABLE from one that did: same 201 reservation, same absent
// DELETE, same fast 200. S10 does not separate them either; it accepts an
// answer or the notice by design.
//
// That is how a quietly degrading desk would have stayed invisible: every ask
// billed, nobody answered, and no signal anywhere to find it by. Found while
// correcting a CLAUDE.md claim that read a kept reservation as proof of an
// answer (Codex #264).
// ─────────────────────────────────────────────────────────────────────────────

// The three billed non-answers, their provider response, and what each must say.
// ⚠️ `trailer_only` is the one the old test did not cover at all.
const BILLED_NON_ANSWERS = [
  {
    name: "a max_tokens cut",
    res: { stop_reason: "max_tokens", content: [{ type: "text", text: "half an ans" }], usage: { output_tokens: 8192 } },
    stage: "stop_reason",
    expect: { stopReason: "max_tokens", outputTokens: 8192, maxTokens: 8192 },
  },
  {
    name: "a refusal",
    res: { stop_reason: "refusal", content: [], usage: { output_tokens: 12 } },
    stage: "stop_reason",
    expect: { stopReason: "refusal", outputTokens: 12, maxTokens: 8192 },
  },
  {
    name: "no text blocks (thinking only)",
    // ⚠️ THE THINKING BLOCK CARRIES THE SENTINELS ON PURPOSE, and an earlier
    // version read "mulling it over" — which made a whole class of mutation
    // INERT. A thinking block's content lives in `.thinking`, not `.text`, so
    // `blocks.map((b) => b.text ?? b.type)` silently fell through to the type
    // name and the privacy test passed against code that was trying to log block
    // content. Model reasoning is the realistic leak here: it restates the
    // client's question and quotes their records back. CLAUDE.md, "four ways a
    // mutation test lies" #4 — a mutation can apply cleanly and still encode a
    // state the fixture cannot reach.
    res: { stop_reason: "end_turn", content: [
      { type: "thinking", thinking: "The client asked: Where are my policies? Their Harbour House home policy HO-1 with Acme renews 2027-03-12, Dwelling $400,000, value 900000." },
      // A text block whose text is EMPTY — so `answer` is still falsy and this
      // path is still the one under test, while `b.text` is "" rather than
      // undefined. That is what stops `b.text ?? b.type` looking harmless.
      { type: "text", text: "   " },
    ] },
    stage: "no_text",
    expect: { stopReason: "end_turn", blockTypes: ["thinking", "text"] },
  },
  {
    name: "a trailer and nothing else",
    res: { stop_reason: "end_turn", content: [{ type: "text", text: "[[SOURCES]] insurance" }] },
    stage: "trailer_only",
    expect: { rawLength: "[[SOURCES]] insurance".length },
  },
];

const answerLogs = (lines) => lines
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((o) => o && o.where === "answer");

test("a billed non-answer keeps the reservation AND names its stage in the log", async () => {
  for (const c of BILLED_NON_ANSWERS) {
    const t = deps({ anthropic: { messages: { create: async () => c.res } } });
    const [res, lines] = await capturingConsoleError(() => ask(t.d));
    assert.equal((await res.json()).reason, "incomplete", c.name);
    assert.equal(t.rows("help_queries").length, 1,
      `${c.name}: output was generated and billed, but the slot was refunded`);

    const hit = answerLogs(lines);
    assert.equal(hit.length, 1, `${c.name}: expected exactly one where:answer line, got ${hit.length}`);
    assert.equal(hit[0].stage, c.stage, `${c.name}: wrong stage`);
    for (const [k, v] of Object.entries(c.expect)) {
      assert.deepEqual(hit[0][k], v, `${c.name}: ${k} should be ${JSON.stringify(v)}`);
    }
  }
});

// ⚠️ THE PRIVACY HALF, and it is the reason this is a structural check rather
// than a needle hunt. These lines are emitted from inside the safety boundary,
// so a future field added "to help debug" is a disclosure: the function's own
// log is the one place a question or a record value could leak without any
// client ever seeing it. So the assertion is an ALLOW-LIST of keys plus a type
// check on every value — a new field fails this test by construction, which is
// what a needle list for today's fixture could never do.
const ANSWER_LOG_KEYS = {
  stop_reason: { where: "s", stage: "s", stopReason: "s?", outputTokens: "n?", maxTokens: "n" },
  no_text: { where: "s", stage: "s", stopReason: "s?", blockTypes: "a" },
  trailer_only: { where: "s", stage: "s", rawLength: "n" },
};

test("a billed non-answer logs a CAUSE, never content", async () => {
  // Sentinels from the seeded fixture: the question the caller typed, and record
  // values that DO legitimately reach the prompt — so finding one here would be
  // a leak out of the boundary rather than a harmless echo.
  const QUESTION = "Where are my policies?";
  const RECORD_SENTINELS = ["Harbour House", "900000", "HO-1", "$400,000", "Acme", "2027-03-12"];

  for (const c of BILLED_NON_ANSWERS) {
    const t = deps({ anthropic: { messages: { create: async () => c.res } } });
    const [, lines] = await capturingConsoleError(() => ask(t.d, { question: QUESTION }));

    for (const line of lines) {
      assert.ok(!line.includes(QUESTION), `${c.name}: the question text reached a log line`);
      for (const needle of RECORD_SENTINELS) {
        assert.ok(!line.includes(needle), `${c.name}: record value ${JSON.stringify(needle)} reached a log line`);
      }
    }

    const o = answerLogs(lines)[0];
    const allowed = ANSWER_LOG_KEYS[c.stage];
    assert.deepEqual(Object.keys(o).sort(), Object.keys(allowed).sort(),
      `${c.name}: the where:answer line's keys are not exactly the allow-list — a new field here is a disclosure`);
    for (const [k, kind] of Object.entries(allowed)) {
      const v = o[k];
      if (kind === "s") assert.equal(typeof v, "string", `${c.name}: ${k} should be a string`);
      if (kind === "s?") assert.ok(v === null || typeof v === "string", `${c.name}: ${k} should be a string or null`);
      if (kind === "n") assert.equal(typeof v, "number", `${c.name}: ${k} should be a number`);
      if (kind === "n?") assert.ok(v === null || typeof v === "number", `${c.name}: ${k} should be a number or null`);
      if (kind === "a") {
        assert.ok(Array.isArray(v) && v.every((x) => typeof x === "string"),
          `${c.name}: ${k} should be an array of strings — block TYPE names, never block text`);
      }
    }
  }
});

// ⚠️ ONE SOURCE for the ceiling. The log reports a cut against `maxTokens`, so a
// literal at the call site could drift from the number the log claims and send a
// reader hunting a cliff that is not there.
test("max_tokens at the call site is MAX_TOKENS, not a literal", async () => {
  let args = null;
  const { d } = deps({ anthropic: { messages: { create: async (a) => { args = a; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  await ask(d);
  assert.equal(args.max_tokens, 8192, "the provider call no longer sends 8192");

  const src = readFileSync(new URL("./handler.ts", import.meta.url), "utf8");
  assert.ok(/max_tokens:\s*MAX_TOKENS\b/.test(src),
    "the call site passes a literal — the where:answer log's maxTokens can then disagree with it");
  assert.ok(/maxTokens:\s*MAX_TOKENS\b/.test(src),
    "the log reports a literal ceiling rather than the one actually sent");
});

test("a failure before the provider call always refunds", async () => {
  const guide = deps({ loadGuide: async () => null });
  assert.equal((await (await ask(guide.d)).json()).answer, null);
  assert.equal(guide.rows('help_queries').length, 0, "a corpus failure cost the caller a slot");

  const records = deps({ dbOpts: { fail: { entities: true } } });
  assert.equal((await (await ask(records.d)).json()).reason, "records_error");
  assert.equal(records.rows('help_queries').length, 0, "a record-read failure cost the caller a slot");
});

test("a record READ failure is never reported as 'you have no records'", async () => {
  // FR-12. The distinction the old code stated in a comment and broke in code.
  const { d } = deps({ dbOpts: { fail: { assets: true } } });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "records_error");
  assert.equal(body.answer, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// The wire contract, end to end.
// ─────────────────────────────────────────────────────────────────────────────
test("a blank or oversized question is refused without reserving or calling", async () => {
  for (const q of ["", "   ", "x".repeat(501)]) {
    const t = deps({ anthropic: { messages: { create: async () => assert.fail("the provider was called for an invalid question") } } });
    assert.equal((await (await ask(t.d, { question: q })).json()).reason, "invalid");
    assert.equal(t.rows('help_queries').length, 0);
  }
});

test("the answer carries only the topics and records the model named", async () => {
  const { d } = deps();
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "answered");
  assert.equal(body.answer, "Your policies are on the Policies screen.");
  assert.deepEqual(body.usedTopics, ["insurance"], "credited topics are not what the trailer named");
  assert.equal(body.usedRecords.length, 1, "every record was credited, not the one named");
});

test("a credited record that FACT_LIMITS dropped is not credited to the client", async () => {
  // ⚠️ THIS IS NOT THE out-of-range CASE BELOW, and that distinction is the bug.
  // `r999` fails because facts[998] is undefined — it would fail even against
  // the broken code. This tag is IN RANGE of the facts array and was dropped
  // from the PROMPT by FACT_LIMITS.count (400), so resolving credits against
  // `facts` rather than against what was sent produced a client-visible "Based
  // on" line for a record the model never received. Found by Codex.
  //
  // 420 assets: one fact per asset (name/type/value gives several, so the digest
  // runs well past 400 lines) — enough that the tail is dropped.
  const many = Array.from({ length: 420 }, (_, i) => (
    { id: `x${i}`, entity_id: "e1", name: `Asset ${i}`, type: "home", value: 1000 + i }));
  const tables = seed({ assets: many, policies: [] });
  const { d } = deps({
    tables,
    anthropic: { messages: { create: async () => ({ stop_reason: "end_turn",
      // COMMA-separated: splitTrailer treats "r1 r419" as ONE tag, so a
      // space-separated list credits nothing and this test would have passed
      // against the broken code for the wrong reason. It did, first time.
      content: [{ type: "text", text: "ok\n[[SOURCES]] insurance\n[[RECORDS]] r1, r419" }] }) } },
  });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "answered");
  // r1 was sent, so it is credited; r419 was dropped from the prompt, so it is not.
  assert.equal(body.usedRecords.length, 1,
    `a record dropped by FACT_LIMITS was credited anyway: ${JSON.stringify(body.usedRecords)}`);
  // r1 is the ENTITY fact — entities lead the digest, before assets. Asserted on
  // the actual shape rather than on what I assumed it was.
  assert.match(body.usedRecords[0], /^Me — /,
    `the credited line is not the record that was actually sent: ${body.usedRecords[0]}`);
});

test("a hallucinated topic id or record tag credits nothing", async () => {
  const { d } = deps({ anthropic: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "ok\n[[SOURCES]] not-a-topic\n[[RECORDS]] r999" }] }) } } });
  const body = await (await ask(d)).json();
  assert.deepEqual(body.usedTopics, []);
  assert.deepEqual(body.usedRecords, []);
});

test("a declined coverage question comes back as `refused`", async () => {
  const { d } = deps({ anthropic: { messages: { create: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Your broker owns that.\n[[REFUSED]] yes" }] }) } } });
  assert.equal((await (await ask(d)).json()).reason, "refused");
});

test("a client with no records gets `no_records`, not a failure", async () => {
  const { d } = deps({ tables: seed({ entities: [], assets: [], policies: [] }) });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "no_records");
  assert.ok(body.answer);
});

test("OPTIONS is answered for the CORS preflight, and GET is not", async () => {
  const { d } = deps();
  assert.equal((await handle(new Request("https://fn.test/x", { method: "OPTIONS" }), d)).status, 200);
  assert.equal((await handle(new Request("https://fn.test/x", { method: "GET" }), d)).status, 405);
});

test("a missing secret never reaches the database or the provider", async () => {
  const { d, db } = deps({ hasKeys: false, anthropic: { messages: { create: async () => assert.fail("called with no key") } } });
  assert.equal((await (await ask(d)).json()).answer, null);
  assert.deepEqual(db.log, []);
});

test("coverage limits reach the prompt — the boundary table's own example", async () => {
  let sent = "";
  const { d } = deps({ anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  await ask(d);
  assert.ok(sent.includes("Dwelling limit"), "coverage limits are not grounded, so the allowed example cannot be answered");
  assert.ok(sent.includes("$400,000"));
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DISCLOSURE BOUNDARY, pinned.
//
// CLAUDE.md states exactly which columns cross to Anthropic and that no contact
// details go with them. Nothing enforced it: a review widened the digest to also
// send `named_insured`, `agent_contact` and `claims` and all 70 help-ask tests
// stayed green. A security constraint no test can fail is a sentence, not a
// boundary.
//
// Every column of every table is seeded with a distinct sentinel, so this fails
// on a widened `select` AND on a dropped one.
// ─────────────────────────────────────────────────────────────────────────────
const SENTINEL_TABLES = {
  profiles: [{ id: OWNER, full_name: "SENT-profile-name", role: "SENT-role" }],
  help_queries: [],
  entities: [{ id: "e1", owner: OWNER, name: "SENT-entity-name", kind: "SENT-kind",
               label: "SENT-ent-label", subtype: "SENT-subtype", meta: "SENT-ent-meta", industry: "SENT-industry" }],
  assets: [{ id: "a1", entity_id: "e1", name: "SENT-asset-name", type: "SENT-type", value: 4242,
             meta: "SENT-asset-meta", facts: ["SENT-facts"], attrs: { k: "SENT-attrs" }, held: ["SENT-held"] }],
  policies: [{ asset_id: "a1", line: "SENT-line", carrier: "SENT-carrier", number: "SENT-number",
               renewal_date: "2027-03-12", premium_amount: 2400, premium_period: "yr",
               coverages: [{ label: "SENT-cov-label", limit: "SENT-cov-limit" }],
               naic: "SENT-naic", form: "SENT-form", status: "SENT-status",
               named_insured: "SENT-named-insured", agent: "SENT-agent", agent_contact: "SENT-agent-contact",
               claims: "SENT-claims", payment_plan: "SENT-payment-plan", billing_status: "SENT-billing",
               effective_date: "2026-03-12", auto_renew: true,
               endorsements: ["SENT-endorsements"], deductibles: ["SENT-deductibles"],
               discounts: ["SENT-discounts"], interests: ["SENT-interests"],
               documents: ["SENT-documents"], details: ["SENT-details"] }],
};

// Exactly what CLAUDE.md's "Anthropic is a sub-processor" paragraph lists.
const MAY_CROSS = ["SENT-entity-name", "SENT-kind", "SENT-asset-name", "SENT-type",
                   "SENT-line", "SENT-carrier", "SENT-number", "SENT-cov-label", "SENT-cov-limit",
                   // Added 2026-10-09 with `effective_date` (asserted by value
                   // below, being a date): without them the prompt's own
                   // invitation to judge "still active" had nothing but
                   // `renewal_date` to work from, so a cancelled policy read as
                   // active. A correctness fix that widens the constraint, which
                   // is why it is listed here rather than filtered out.
                   "SENT-status"];

test("exactly the documented columns cross to the provider — no more, no less", async () => {
  let sent = "";
  const { d } = deps({
    tables: structuredClone(SENTINEL_TABLES),
    anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
  });
  await ask(d);
  assert.ok(sent, "the provider was never called");

  const leaked = [...sent.matchAll(/SENT-[a-z-]+/g)].map((m) => m[0]);
  const unexpected = [...new Set(leaked)].filter((x) => !MAY_CROSS.includes(x));
  assert.deepEqual(unexpected, [],
    `these columns crossed to the provider but are NOT in CLAUDE.md's disclosed list: ${unexpected.join(", ")} — ` +
    `widening the digest is a change to that security constraint, not an implementation detail`);

  const missing = MAY_CROSS.filter((x) => !leaked.includes(x));
  assert.deepEqual(missing, [],
    `documented columns did NOT reach the provider: ${missing.join(", ")} — the constraint over-states what is sent`);

  // The numeric fields have no sentinel, so assert them by value.
  for (const [label, v] of [["asset value", "4242"], ["premium", "2400"], ["renewal date", "2027-03-12"],
                            ["effective date", "2026-03-12"]]) {
    assert.ok(sent.includes(v), `${label} did not reach the prompt`);
  }
});

test("row ids never cross the boundary", async () => {
  // CLAUDE.md: "the row ids never cross the boundary — the join keys stay inside
  // the function". Nothing checked it.
  let sent = "";
  const { d } = deps({
    tables: structuredClone(SENTINEL_TABLES),
    anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
  });
  await ask(d);
  for (const id of ["e1", "a1"]) {
    assert.ok(!new RegExp(`"${id}"`).test(sent), `the row id ${id} reached the provider`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The paths a second mutation sweep found unguarded. Each of these edits left
// all 131 help-desk tests green before this block existed: the suite proved the
// eight mutations it was written from, which is not the same as proving the
// behaviour.
// ─────────────────────────────────────────────────────────────────────────────

test("a throttle that cannot reserve FAILS CLOSED — the model is never called", async () => {
  // The likeliest first-deploy state is the migration not applied. "Cannot
  // reserve" must never read as "go ahead" on a paid endpoint.
  let called = false;
  const { d } = deps({
    dbOpts: { fail: { help_queries: true } },
    anthropic: { messages: { create: async () => { called = true; return { stop_reason: "end_turn", content: [] }; } } },
  });
  assert.equal((await (await ask(d)).json()).answer, null);
  assert.equal(called, false, "the provider was called with no throttle slot reserved");
});

test("counting failures fail closed and refund the reservation", async () => {
  // Neither count had a test, so dropping either fail-closed branch changed
  // nothing. The insert is select #1 (`.select("id").single()` after it), so the
  // hourly count is #2 and the daily one #3.
  for (const [mode, nth] of [["hourly", 2], ["daily", 3]]) {
    let called = false;
    const tables = seed();
    const admin = fakeDb(tables, { denied: SERVICE_ROLE_DENIED, failSelect: { help_queries: nth } });
    const { d, rows } = deps({
      db: admin, tables,
      anthropic: { messages: { create: async () => { called = true; return { stop_reason: "end_turn", content: [] }; } } },
    });
    assert.equal((await (await ask(d)).json()).answer, null, `${mode}: a failed count produced an answer`);
    assert.equal(called, false, `${mode}: the provider was called after a count that could not run`);
    assert.equal(rows("help_queries").length, 0, `${mode}: a failed count cost the caller a slot`);
  }
});

test("rows outside the window do not count toward either cap", async () => {
  // Nothing seeded a stale row, so widening the hourly window to 10h or the
  // daily one to 10 days changed no test.
  const old = (mins) => new Date(Date.now() - mins * 60_000).toISOString();
  const stale = [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: old(61) })),   // just outside the hour
    ...Array.from({ length: 900 }, (_, i) => ({ id: `d${i}`, owner: OTHER, asked_at: old(25 * 60) })), // just outside the day
  ];
  const { d } = deps({ tables: seed({ help_queries: stale }) });
  assert.equal((await (await ask(d)).json()).reason, "answered",
    "rows outside the window were counted, so the caps are wider than they claim");
});

test("the daily cap boundary is exact: 399 others plus the caller is allowed, 400 is not", async () => {
  const now = new Date().toISOString();
  const others = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, owner: OTHER, asked_at: now }));
  assert.equal((await (await ask(deps({ tables: seed({ help_queries: others(399) }) }).d)).json()).reason, "answered",
    "the 400th ask of the day was refused");
  assert.equal((await (await ask(deps({ tables: seed({ help_queries: others(400) }) }).d)).json()).reason, "rate_limited",
    "the 401st ask of the day was allowed");
});

test("the CORS preflight carries the headers supabase-js actually sends", async () => {
  // The PR's most-argued risk had no assertion at all: the OPTIONS test checked
  // only the status. The vendored client sends Authorization, apikey,
  // Content-Type and X-Client-Info; a preflight that omits any of them from
  // Allow-Headers is blocked by the browser.
  const { d } = deps();
  const res = await handle(new Request("https://fn.test/x", { method: "OPTIONS" }), d);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("Access-Control-Allow-Origin"), "no Access-Control-Allow-Origin on the preflight");
  const allow = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
  for (const h of ["authorization", "apikey", "content-type", "x-client-info"]) {
    assert.ok(allow.includes(h), `Allow-Headers omits ${h}, which supabase-js sends — the browser blocks the POST`);
  }
  assert.ok((res.headers.get("Access-Control-Allow-Methods") ?? "").toUpperCase().includes("POST"));
});

test("a token that resolves to no user is refused before any database work", async () => {
  const { d, db } = deps({ userClient: async () => ({ data: { user: null } }) });
  assert.equal((await ask(d)).status, 401);
  assert.deepEqual(db.log, [], "a database query ran for a token that resolved to nobody");
});

test("a non-string question is invalid, and reserves nothing", async () => {
  // `{"question":{"a":1}}` was coerced to "[object Object]", stored, and sent.
  for (const q of [{ a: 1 }, 42, ["x"], true]) {
    const t = deps({ anthropic: { messages: { create: async () => assert.fail("the provider was called for a non-string question") } } });
    assert.equal((await (await ask(t.d, { question: q })).json()).reason, "invalid", `accepted ${JSON.stringify(q)}`);
    assert.equal(t.rows("help_queries").length, 0);
  }
});

test("the provider request carries the intended model, budget and boundary rule", async () => {
  // A model-id typo fails every ask with a provider 404 — refunded, and shown as
  // the same "not available" notice as everything else. Nothing caught it.
  let args = null;
  const { d } = deps({ anthropic: { messages: { create: async (a) => { args = a; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  await ask(d);
  assert.equal(args.model, "claude-opus-5-5");
  assert.ok(args.max_tokens >= 4096, `max_tokens ${args.max_tokens} shares its budget with thinking that cannot be disabled`);
  assert.match(args.system, /may NOT make a COVERAGE DETERMINATION/,
    "the system prompt no longer carries the rule the whole feature turns on");
});

test("the grounding never labels a relation with a coverage verb", async () => {
  // "covers" primes the determination the boundary refuses, and the client sees
  // the label too, under "Based on". The first version of this test built a
  // regex against the JSON-escaped payload and matched nothing, so it passed on
  // the defect it was written for — assert on the PROMPT TEXT instead.
  let sent = "";
  const { d } = deps({ anthropic: { messages: { create: async (a) => { sent = a.messages[0].content; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  await ask(d);
  assert.ok(sent.includes("- [r"), "no record lines in the prompt — this test would pass vacuously");
  for (const bad of ['"covers"', '"covered"', '"coverage"']) {
    assert.ok(!sent.includes(`${bad}:`),
      `a record label reads ${bad}, which states the determination the boundary refuses:\n` +
      sent.split("\n").filter((l) => l.includes(bad)).join("\n"));
  }
});

test("today's date is grounded, so 'still active' is answerable", async () => {
  let sent = "";
  const { d } = deps({ anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } } });
  await ask(d);
  assert.ok(sent.includes(new Date().toISOString().slice(0, 10)),
    "no current date reached the model, so it answers renewal questions from its own guess at today");
});

test("a client with hundreds of assets still gets their records — no in() URL cliff", async () => {
  // PostgREST puts an `.in()` list in the query STRING, ~37 chars per uuid, so a
  // long enough list is refused outright and the read fails PERMANENTLY for that
  // client — not transiently — and it is deliberately reachable by anyone holding
  // an account. Measured live 2026-10-07: accepted at 640 ids / 23,760 bytes,
  // refused with HTTP 400 at 700 / 25,980. (An earlier comment here said 16KB at
  // 410 ids with a 520; that was Supabase's documented Cloudflare limit quoted as
  // a measurement. See handler.ts for the full table.)
  // A fake has no URL, so this asserts the BOUND rather than the symptom: no `in`
  // list may exceed the chunk size, whatever the client owns.
  //
  // ⚠️ Both phases stay under FACT_LIMITS.count (400) ON PURPOSE. The first draft
  // seeded 520 assets, which produces ~1040 facts, and the digest cap dropped the
  // last one — so the test failed reporting "chunking dropped rows" when chunking
  // was fine and the cap was simply doing its job. Exceeding 200 ids and
  // exceeding 400 facts cannot be done at once, which is why this is two phases.
  const sends = [];
  const spy = () => ({ messages: { create: async (a) => { sends.push(JSON.stringify(a)); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } });
  // PER TABLE, not across all of them: a flat list mixes the entity_id list into
  // the asset_id ones, and the first draft's "at least two lists > 1" assertion
  // then failed on a correct 200 + 1 split, because a remainder chunk of one id
  // is still a chunk.
  const inLists = (c, table) => c.log.filter((q) => q.table === table)
    .flatMap((q) => q.filters.filter(([op]) => op === "in").map(([, , v]) => v.length));

  // Phase 1 — 211 entities chunks the ASSET read's entity_id list (200 + 11).
  // An asset hanging off the LAST entity only arrives if chunk 2 is queried.
  const entities = [{ id: "e1", owner: OWNER, name: "Me", kind: "personal" }];
  for (let i = 0; i < 210; i++) entities.push({ id: `E${i}`, owner: OWNER, name: `Entity ${i}`, kind: "business" });
  const p1 = deps({
    tables: seed({ entities, assets: [
      { id: "AF", entity_id: "E0", name: "First Chunk Asset", type: "home", value: 100 },
      { id: "AL", entity_id: "E209", name: "Last Chunk Asset", type: "auto", value: 200 },
    ], policies: [] }),
    anthropic: spy(),
  });
  assert.equal((await ask(p1.d)).status, 200);
  const l1 = inLists(p1.caller, "assets");
  assert.ok(l1.length >= 2, `211 entity ids should have chunked the asset read, saw ${JSON.stringify(l1)}`);
  for (const n of l1) assert.ok(n <= 200, `an in() list carried ${n} ids — the URL cliff is back`);
  assert.equal(l1.reduce((a, b) => a + b, 0), 211, "the chunks do not cover every entity id");
  assert.ok(sends[0].includes("First Chunk Asset"), "a first-chunk asset is missing");
  assert.ok(sends[0].includes("Last Chunk Asset"), "a last-chunk asset is missing — chunking dropped rows");

  // Phase 2 — 201 assets chunks the POLICY read's asset_id list. `value: null`
  // keeps each asset to ONE fact so 202 facts stays under the 400 cap.
  const assets = [];
  for (let i = 0; i < 201; i++) assets.push({ id: `A${i}`, entity_id: "e1", name: `Asset ${i}`, type: "auto", value: null });
  const p2 = deps({
    tables: seed({
      entities: [{ id: "e1", owner: OWNER, name: "Me", kind: "personal" }],
      assets,
      policies: [{ asset_id: "A200", line: "Auto", carrier: "Beta", number: "AU-9", renewal_date: "2027-04-01", premium_amount: 900, premium_period: "yr", coverages: [] }],
    }),
    anthropic: spy(),
  });
  assert.equal((await ask(p2.d)).status, 200);
  const l2 = inLists(p2.caller, "policies");
  assert.ok(l2.length >= 2, `201 asset ids should have chunked the policy read, saw ${JSON.stringify(l2)}`);
  for (const n of l2) assert.ok(n <= 200, `an in() list carried ${n} ids — the URL cliff is back`);
  assert.equal(l2.reduce((a, b) => a + b, 0), 201, "the chunks do not cover every asset id");
  // The ONLY policy hangs off the 201st asset, i.e. the second chunk.
  assert.ok(sends[1].includes("AU-9"), "a policy in the second asset_id chunk is missing");
});

test("the two caps are distinguishable on the wire, not guessed from the wait", async () => {
  // The view cannot word a throttle notice correctly without knowing WHICH cap
  // refused, and inferring it from retryAfter blamed innocent clients (see
  // js/keep/logic/help.test.mjs). These are the only two emitters.
  const mine = await (await ask(deps({ tables: seed({ help_queries: Array.from({ length: 21 }, (_, i) => ({ id: `q${i}`, owner: OWNER, asked_at: new Date().toISOString() })) }) }).d)).json();
  assert.equal(mine.reason, "rate_limited");
  assert.equal(mine.scope, "client", "the per-client cap did not identify itself");

  const now = new Date().toISOString();
  const others = Array.from({ length: 400 }, (_, i) => ({ id: `o${i}`, owner: OTHER, asked_at: now }));
  const shared = await (await ask(deps({ tables: seed({ help_queries: others }) }).d)).json();
  assert.equal(shared.reason, "rate_limited");
  assert.equal(shared.scope, "shared", "the aggregate cap did not identify itself");
});

test("the throttle row carries ONLY the owner — the question text is never stored", async () => {
  // The help_queries migration deliberately has no `question` column: the
  // throttle counts rows, nothing reads the text, so storing it was indefinite
  // retention of client free text with no reader. Nothing pinned that, and
  // review round 5 proved it: changing the insert back to `{ owner, question }`
  // passed all 305 tests, because the fake accepts any column and the schema
  // scraper only reads `.select()` lists. On the real table that edit fails every
  // insert; against an older table it silently resumes storing the text.
  const { d, db } = deps();
  const res = await ask(d, { question: "My neighbour Jane Smith at 14 Harbour Rd is suing me" });
  assert.equal(res.status, 200);

  const ins = db.log.find((q) => q.table === "help_queries" && q.inserted);
  assert.ok(ins, "no help_queries insert was made");
  assert.deepEqual(Object.keys(ins.inserted).sort(), ["owner"],
    `the throttle insert carries more than the owner: ${JSON.stringify(ins.inserted)}`);

  // And the text itself must appear nowhere in what was written.
  const written = JSON.stringify(db.tables.help_queries ?? []);
  assert.ok(!/Jane Smith|Harbour Rd|suing/.test(written),
    `the question text reached the throttle table: ${written}`);
});

test("coverages are capped per policy — the column is unbounded and re-sent every ask", async () => {
  // CLAUDE.md's disclosure paragraph says "capped at 20 lines per policy".
  // Dropping the .slice() survived the suite at 7a35387, so the cap was
  // documented and unenforced. `coverages` is broker-written jsonb with no bound,
  // and it crosses to the provider on EVERY question.
  let sent = "";
  const many = Array.from({ length: 60 }, (_, i) => ({ label: `Cover ${i}`, limit: `$${i}000` }));
  const { d } = deps({
    tables: seed({ policies: [
      { asset_id: "a1", line: "Home", carrier: "Acme", number: "HO-1", renewal_date: "2027-03-12", premium_amount: 2400, premium_period: "yr", coverages: many },
    ] }),
    anthropic: { messages: { create: async (a) => { sent = JSON.stringify(a); return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
  });
  assert.equal((await ask(d)).status, 200);

  const seenLabels = many.filter((c) => sent.includes(`${c.label} limit`)).length;
  assert.ok(seenLabels > 0, "no coverage lines reached the prompt at all — the test is vacuous");
  assert.ok(seenLabels <= 20, `${seenLabels} coverage lines crossed the boundary; CLAUDE.md documents a cap of 20`);
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RETRY-TIME ERROR PATHS. Added after an independent silent-failure review
// of the round-20 commit found that `retryAfterFor` returned a bare `null` on a
// query error with nothing logged — and that for the CLIENT scope a missing
// number renders as "Please try again in a few minutes" (rateLimitNotice), i.e.
// a transient PostgREST failure told a caller 5 minutes into a 60-minute block
// to come back shortly. The flat 3600 it replaced overstated, which is the safe
// direction. No test reached these paths, which is why the refactor could make
// that trade without anything going red.
//
// Select order on help_queries for an hourly refusal: #1 the reservation's
// `.select("id")`, #2 the hourly count, #3 survivors, #4 the oldest row.
// ─────────────────────────────────────────────────────────────────────────────
function capturingConsoleError(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...a) => { lines.push(a.join(" ")); };
  return fn().finally(() => { console.error = real; }).then((v) => [v, lines]);
}

// ⚠️ THE TWO CASES NEED DIFFERENT SEEDS, and the first version used one for
// both. With every row inside the 5s grace, survivors is 0, the offset is
// negative and the helper returns the grace without ever reading the oldest row
// — so select #4 never happened and the "oldest-row read" case tested nothing.
// Settled rows are what make that query reachable.
for (const [label, failAt, stage, ageMins] of [
  ["the survivors count", 3, "survivors", 0],
  ["the oldest-row read", 4, "oldest", 50],
]) {
  test(`when ${label} fails, the hourly refusal falls back to the WINDOW and says so in the log`, async () => {
    const hour = new Date(Date.now() - ageMins * 60_000).toISOString();
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: hour }));
    const { d, rows: rowsOf } = deps({ tables: seed({ help_queries: rows }), dbOpts: { failSelect: { help_queries: failAt } } });
    const [res, logged] = await capturingConsoleError(() => ask(d));
    const body = await res.json();
    assert.equal(body.reason, "rate_limited");
    assert.equal(body.scope, "client");
    // ⚠️ THE WINDOW, NOT A NUMBER — and this started as `retryAfter: 3600`,
    // which was a fallback invented to dodge the view's "in a few minutes"
    // wording for a numberless client refusal. The redesign removed the need:
    // `window` is sent whenever the wait is not derivable, for a failure exactly
    // as for an ambiguous count, and the view has honest wording for both.
    assert.equal(body.retryAfter, undefined, "a failed query produced a number it could not know");
    assert.equal(body.window, 3600, "a failed retry-time query dropped the window too, leaving nothing true to say");
    const line = logged.find((l) => l.includes("retry_after"));
    assert.ok(line, `nothing was logged; an operator reading the \`where\` field sees no cause. Got: ${JSON.stringify(logged)}`);
    assert.ok(line.includes(`"stage":"${stage}"`), `the log does not name the stage: ${line}`);
    // And the reservation still goes back — this is the reserved side of the line.
    assert.equal(rowsOf("help_queries").length, 20, "the refused ask kept its reservation");
  });
}

test("when the SHARED-cap retry time fails, the number is omitted — 'tomorrow' overstates, which is the safe direction", async () => {
  // Selects here: #1 reserve, #2 hourly count (the caller is under it), #3 the
  // daily total, #4 survivors. So 4 fails the shared branch's own first query.
  const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
  const theirs = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, owner: OTHER, asked_at: hoursAgo(6) }));
  const { d, rows: rowsOf } = deps({ tables: seed({ help_queries: theirs }), dbOpts: { failSelect: { help_queries: 4 } } });
  const [res, logged] = await capturingConsoleError(() => ask(d));
  const body = await res.json();
  assert.equal(body.reason, "rate_limited");
  assert.equal(body.scope, "shared");
  assert.equal(body.retryAfter, undefined,
    "a shared-cap failure sent a number it could not know; omitting lands on 'tomorrow', which overstates a rolling window");
  assert.ok(logged.some((l) => l.includes("retry_after")), "the shared-cap failure was silent");
  assert.equal(rowsOf("help_queries").length, 400, "the refused ask kept its reservation");
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RELEASE PATH. `releaseAnd` discarded its DELETE's result, so a failed
// release was indistinguishable from a successful one: an UNBILLED attempt left
// counted against the caller's hourly cap and the shared daily one. Found by
// Codex, round 21. The fake could not fail a delete at all until this was
// written, which is why nothing covered it.
// ─────────────────────────────────────────────────────────────────────────────
test("a release that fails is RETRIED, and logged if it still does not take", async () => {
  const { d, db, rows } = deps({
    tables: seed(), loadGuide: async () => [],         // forces releaseAnd("unavailable")
    dbOpts: { failDelete: { help_queries: "all" } },
  });
  const [res, logged] = await capturingConsoleError(() => ask(d));
  assert.equal((await res.json()).answer, null, "the caller should still get the notice");
  const deletes = db.log.filter((q) => q.table === "help_queries" && q.deleted);
  assert.equal(deletes.length, 2, `an idempotent release should be retried once; saw ${deletes.length} attempt(s)`);
  const line = logged.find((l) => l.includes('"where":"release"'));
  assert.ok(line, `a stuck release was silent; an operator has no way to see the leaked reservation. Got: ${JSON.stringify(logged)}`);
  assert.ok(line.includes('"reason":"unavailable"'), `the log does not say which refusal leaked its slot: ${line}`);
  assert.equal(rows("help_queries").length, 1, "the fake was supposed to refuse the delete, so the row should still be there");
});

test("a release that succeeds on the RETRY gives the reservation back and logs nothing", async () => {
  const { d, db, rows } = deps({
    tables: seed(), loadGuide: async () => [],
    dbOpts: { failDelete: { help_queries: 1 } },       // first attempt only
  });
  const [res, logged] = await capturingConsoleError(() => ask(d));
  assert.equal((await res.json()).answer, null);
  const deletes = db.log.filter((q) => q.table === "help_queries" && q.deleted);
  assert.equal(deletes.length, 2);
  assert.equal(rows("help_queries").length, 0, "the retry did not actually release the reservation");
  assert.ok(!logged.some((l) => l.includes('"where":"release"')), "a recovered release should not be reported as stuck");
});

test("the caller's OWN reservation is excluded by id, not left to the grace window", async () => {
  // Codex, round 23: the grace is for rows that MIGHT be peers about to release.
  // Our own row is one we KNOW will be released, by `releaseAnd`, moments later —
  // so if the insert and the count are more than GRACE_MS apart (a slow count, a
  // cold function, a retried query) it ages past the grace, counts as settled,
  // and the offset comes out one too high: the answer becomes the SECOND-oldest
  // row's expiry when only the oldest has to go.
  //
  // `dbOpts.now` backdates what the fake stamps on the inserted row, which is
  // the only way to reach this: 6 seconds is past the 5s grace.
  // The twenty retained rows are STAGGERED a minute apart so the oldest and the
  // second-oldest give different answers — seeded at one timestamp they would be
  // indistinguishable and this test would pass either way.
  const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: minsAgo(50 - i) }));
  const { d } = deps({
    tables: seed({ help_queries: rows }),
    dbOpts: { now: new Date(Date.now() - 6_000).toISOString() },
  });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "rate_limited");
  assert.equal(body.scope, "client");
  // The oldest retained row is 50 minutes old, so it leaves the window in ~600s.
  // Counting our own aged reservation would point at the 49-minute row instead,
  // i.e. ~660s — the off-by-one this asserts against.
  assert.ok(body.retryAfter > 580 && body.retryAfter < 625,
    `expected ~600s (the OLDEST retained row). Got ${body.retryAfter}; ~660 means the caller's own ` +
    `reservation was counted as settled and the offset came out one too high`);
});

test("the own-slot exclusion applies to the OLDEST-row read too", async () => {
  // The second `.neq("id", slot.id)` only changes the answer when our own
  // reservation is the OLDEST row in the window — otherwise it sorts after the
  // retained rows and the index never reaches it. Mutation-tested: without this
  // case, deleting that exclusion passed.
  // Reaching it needs a reservation that sat for most of the window before the
  // count ran, which is extreme; the guard is kept because it is exact and free,
  // and this is the case that makes it load-bearing rather than decorative.
  const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, owner: OWNER, asked_at: minsAgo(50 - i) }));
  const { d } = deps({
    tables: seed({ help_queries: rows }),
    dbOpts: { now: minsAgo(56) },          // our own row, older than every retained one
  });
  const body = await (await ask(d)).json();
  assert.equal(body.reason, "rate_limited");
  assert.ok(body.retryAfter > 580 && body.retryAfter < 625,
    `expected ~600s (the oldest RETAINED row, 50 min old). Got ${body.retryAfter}; ~240 means the index ` +
    `landed on the caller's own reservation, which is about to be deleted`);
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MODEL TOGGLE (`HELP_MODEL`)
//
// Two separate claims, and only the second one catches a hardcoded literal left
// behind at the call site. "Classifying a value is not the same as feeding it to
// the thing that uses it" is a lesson this repo has already paid for twice.
// ─────────────────────────────────────────────────────────────────────────────
test("resolveModel: unset, blank and whitespace all mean the default", () => {
  for (const raw of [undefined, null, "", "   ", "\t\n"]) {
    assert.deepEqual(resolveModel(raw), { model: DEFAULT_HELP_MODEL, rejected: null }, `raw=${JSON.stringify(raw)}`);
  }
});

test("resolveModel: every allow-listed model is accepted as itself", () => {
  assert.equal(HELP_MODELS.length, 3, "the toggle is meant to offer three tiers");
  for (const m of HELP_MODELS) {
    assert.deepEqual(resolveModel(m), { model: m, rejected: null }, m);
  }
  // The default must itself be on the list, or the fallback is unreachable.
  assert.ok(HELP_MODELS.includes(DEFAULT_HELP_MODEL), "the default is not on the allow-list");
});

test("resolveModel: case and surrounding space are forgiven", () => {
  assert.deepEqual(resolveModel("  Claude-Opus-5-5 "), { model: "claude-opus-5-5", rejected: null });
  assert.deepEqual(resolveModel("CLAUDE-HAIKU-5-5"), { model: "claude-haiku-5-5", rejected: null });
});

test("resolveModel: an unknown id falls back to the default AND reports itself", () => {
  // Falling back rather than refusing is the deliberate direction — FR-17 renders
  // a refusal as the same quiet notice as an outage, so a typo would read as one.
  // `rejected` is what stops the fallback being silent.
  for (const bad of ["claude-opus-5-5-20260401", "gpt-4", "opus", "claude-opus-9", "claude-sonnet-5-5 "  + "\u200b"]) {
    const got = resolveModel(bad);
    assert.equal(got.model, DEFAULT_HELP_MODEL, bad);
    assert.equal(got.rejected, bad.trim(), bad);
  }
});

test("resolveModel: a date-suffixed id is NOT silently accepted", () => {
  // Guarded explicitly because a date suffix is the single most likely wrong
  // value a human will type, and it is wrong in a way that looks right.
  assert.equal(resolveModel("claude-haiku-5-5-20260301").model, DEFAULT_HELP_MODEL);
});

test("the configured model is what actually reaches the provider", async () => {
  // THE WIRING CLAIM. With `model` at the call site reverted to a literal, every
  // assertion above still passes and this one fails.
  for (const m of HELP_MODELS) {
    let sent = null;
    const { d } = deps({
      anthropic: { messages: { create: async (a) => { sent = a; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
      d: { helpModel: m },
    });
    const res = await ask(d);
    assert.equal(res.status, 200, m);
    assert.equal(sent?.model, m, `HELP_MODEL=${m} did not reach messages.create`);
  }
});

test("an unset HELP_MODEL sends the default, and a bad one sends the default too", async () => {
  for (const raw of [undefined, "", "not-a-model"]) {
    let sent = null;
    const { d } = deps({
      anthropic: { messages: { create: async (a) => { sent = a; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
      d: { helpModel: raw },
    });
    await ask(d);
    assert.equal(sent?.model, DEFAULT_HELP_MODEL, `raw=${JSON.stringify(raw)}`);
  }
});

test("a rejected HELP_MODEL is logged as where:model, naming what was ignored", async () => {
  const lines = [];
  const real = console.error;
  console.error = (x) => lines.push(String(x));
  try {
    const { d } = deps({ d: { helpModel: "claude-opus-6" } });
    await ask(d);
  } finally {
    console.error = real;
  }
  const hit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
                   .find((o) => o && o.where === "model");
  assert.ok(hit, "no where:model log line for a rejected secret");
  assert.equal(hit.rejected, "claude-opus-6");
  assert.equal(hit.using, DEFAULT_HELP_MODEL);
});

test("the model is never taken from the request body", async () => {
  // Same rule as `owner`: a body-chosen model is a client choosing how much of
  // the owner's money an ask costs, and both caps count asks, not dollars.
  let sent = null;
  const { d } = deps({
    anthropic: { messages: { create: async (a) => { sent = a; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
    d: { helpModel: "claude-haiku-5-5" },
  });
  await ask(d, { question: "hi", model: "claude-opus-5-5", helpModel: "claude-opus-5-5" });
  assert.equal(sent?.model, "claude-haiku-5-5", "the request body chose the model");
});

// ─────────────────────────────────────────────────────────────────────────────
// THE STORED TIER (`help_settings`) — the broker's switch, and its precedence.
//
// ⚠️ EVERY ONE OF THESE ASSERTS WHAT REACHED `messages.create`, not what
// `resolveModel` returned. A resolver nobody calls is a resolver nobody checked:
// CLAUDE.md records that reverting the call site to a literal left every
// resolver test green, which is why the wiring is pinned separately — and this
// adds a second hop (row -> resolver -> call site) that the same mutation class
// can break without touching either end.
// ─────────────────────────────────────────────────────────────────────────────
const sentModel = async (over) => {
  let sent = null;
  const { d } = deps({
    ...over,
    anthropic: { messages: { create: async (a) => { sent = a; return { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }; } } },
  });
  const res = await ask(d);
  return { model: sent?.model ?? null, status: res.status, body: await res.json() };
};

test("the STORED tier reaches the provider, for every tier a broker can pick", async () => {
  for (const m of HELP_MODELS) {
    const got = await sentModel({ tables: seed({ help_settings: [{ id: true, model: m }] }) });
    assert.equal(got.status, 200, m);
    assert.equal(got.model, m, `help_settings.model=${m} did not reach messages.create`);
  }
});

test("the STORED tier WINS over the HELP_MODEL secret, and the ignored one is named", async () => {
  // ⚠️ THE OTHER PRECEDENCE IS THE TEMPTING ONE AND IT IS WRONG: a secret that
  // overrode the row would let a broker move the switch, watch it save, and
  // change nothing — which FR-17 renders as indistinguishable from working.
  const [got, lines] = await capturingConsoleError(() => sentModel({
    tables: seed({ help_settings: [{ id: true, model: "claude-haiku-5-5" }] }),
    d: { helpModel: "claude-opus-5-5" },
  }));
  assert.equal(got.model, "claude-haiku-5-5", "the secret overrode the stored tier");

  const hit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
                   .find((o) => o && o.where === "model" && o.ignoredSecret);
  assert.ok(hit, "a secret that is not taking effect was not logged");
  assert.equal(hit.ignoredSecret, "claude-opus-5-5");
  assert.equal(hit.using, "claude-haiku-5-5");
});

test("no stored row falls through to the secret, then to the default", async () => {
  const withSecret = await sentModel({ tables: seed({ help_settings: [] }), d: { helpModel: "claude-sonnet-5-5" } });
  assert.equal(withSecret.model, "claude-sonnet-5-5", "an empty settings table did not fall through to the secret");

  const bare = await sentModel({ tables: seed({ help_settings: [] }) });
  assert.equal(bare.model, DEFAULT_HELP_MODEL, "no row and no secret did not reach the default");
});

test("a DENIED settings read is not fatal — it logs and falls back to the secret", async () => {
  // This is the shape that would be live if the migration's explicit
  // `grant select … to service_role` were ever lost: 42501 on every ask. The
  // desk must keep answering, because a missing tier has a correct answer.
  const [got, lines] = await capturingConsoleError(() => sentModel({
    adminDenied: ["help_settings"],
    tables: seed({ help_settings: [{ id: true, model: "claude-haiku-5-5" }] }),
    d: { helpModel: "claude-sonnet-5-5" },
  }));
  assert.equal(got.status, 200, "a settings read failure took the desk down");
  assert.equal(got.model, "claude-sonnet-5-5", "a denied settings read did not fall back to the secret");

  const hit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
                   .find((o) => o && o.where === "settings");
  assert.ok(hit, "a denied settings read was not logged as where:settings");
  assert.equal(hit.code, "42501");
});

test("a stored value outside the allow-list falls back to the default and says so", async () => {
  // The CHECK constraint makes this unreachable through PostgREST — but the
  // function must not assume a constraint it does not own, and a row written as
  // `postgres` bypasses nothing else either.
  const [got, lines] = await capturingConsoleError(() => sentModel({
    tables: seed({ help_settings: [{ id: true, model: "claude-opus-4-1" }] }),
  }));
  assert.equal(got.model, DEFAULT_HELP_MODEL, "an unlisted stored tier reached the provider");

  const hit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
                   .find((o) => o && o.where === "model" && o.rejected);
  assert.ok(hit, "an unlisted stored tier was not logged");
  assert.equal(hit.rejected, "claude-opus-4-1");
  assert.equal(hit.source, "settings", "the log does not say where the bad value came from");
});

test("the answer names the model to EVERY caller, whatever their role", async () => {
  // ⚠️ THIS TEST IS INVERTED FROM ITS FIRST VERSION, and the inversion is the
  // point. It used to assert "for a BROKER and withholds it from a client", on
  // the reasoning that the tier is the broker's spend decision and not a fact
  // about the client's cover. The owner reversed it on 2026-10-14, and the old
  // reasoning does not survive the product's own copy: the Security page calls
  // Haiku "weakest on nuance", so a broker could move every client to a cheaper
  // tier and the client had no way to know the answers got worse.
  //
  // The field is still the end-to-end proof the tier switch took effect — FR-17
  // makes every failure look identical, so without it an unread setting and a
  // working one are the same screen. What changed is who gets that proof.
  //
  // The role is varied deliberately rather than tested once: `undefined` is the
  // case that would have slipped through a gate keyed on equality with a string,
  // and it is a real row shape (a `profiles` row predating the role column'''s
  // default would read that way).
  for (const role of ["broker", "client", "underwriter", undefined]) {
    const r = await sentModel({
      tables: seed({ profiles: [{ id: OWNER, role }], help_settings: [{ id: true, model: "claude-haiku-5-5" }] }),
    });
    assert.equal(r.body.model, "claude-haiku-5-5", `role=${String(role)} was NOT told which tier answered`);
    // …and it still answered. Naming the tier must not cost anyone the answer.
    assert.ok(r.body.answer, `role=${String(role)} got no answer`);
  }
});

test("the invite read selects `id` ONLY — `role` went with the gate that used it", () => {
  // Narrowing a read when its last consumer disappears. `role` was selected from
  // 2026-10-14 for exactly one purpose, deciding whether the payload named the
  // model; that gate is gone, so the column is too. Pinned here because a column
  // that stays selected "in case" is one the next person has to reason about,
  // and because schema.test.mjs's DOCUMENTED table models what is SELECTED — the
  // two must not drift.
  const src = readFileSync(new URL("./handler.ts", import.meta.url), "utf8");
  const m = src.match(/\.from\("profiles"\)\.select\((["'\`])([^"'\`]*)\1\)/);
  assert.ok(m, "could not find the profiles select — the scan, not the code, may be wrong");
  assert.equal(m[2].replace(/\s+/g, ""), "id", "the invite read selects more than `id`");
});

test("the stored tier is read FRESH on every ask, never cached in the isolate", async () => {
  // A cached tier would take effect whenever the isolate happened to recycle, so
  // a broker who moved the switch and then asked would get the old one with
  // nothing saying so. One backing store, mutated between two asks.
  const tables = seed({ help_settings: [{ id: true, model: "claude-opus-5-5" }] });
  const first = await sentModel({ tables });
  assert.equal(first.model, "claude-opus-5-5");

  tables.help_settings[0].model = "claude-haiku-5-5";
  const second = await sentModel({ tables });
  assert.equal(second.model, "claude-haiku-5-5", "the tier was cached across asks");
});

// ─────────────────────────────────────────────────────────────────────────────
// THE API KEY RESOLVER (new key set -> legacy variable)
//
// EXECUTED, which is the point of it living in handler.ts rather than index.ts.
// The legacy keys stop being accepted at the end of 2026; index.ts folds both
// keys into HAS_KEYS, so the failure mode is the desk going quiet on a date
// with nothing going red. These assertions are what stand behind the claim that
// the fallback works, since no session can invoke the deployed function.
// ─────────────────────────────────────────────────────────────────────────────

test("the new key set wins over a present legacy variable", () => {
  // ⚠️ THE ORDERING IS THE WHOLE FINDING (Codex #286 P1). Legacy keys are
  // DEACTIVATED, not deleted, so the legacy variable probably keeps its now
  // rejected value -- under legacy-first the fallback would never fire and this
  // change would be inert. Keyset-first is correct whether the variable vanishes
  // or persists; legacy-first only in the first case.
  const r = resolveSupabaseKey('{"default":"sb_secret_new"}', "legacy-jwt-value");
  assert.equal(r.key, "sb_secret_new");
  assert.equal(r.source, "keyset");
  assert.equal(r.keySetProblem, null);
});

test("the legacy variable answers while no key set exists", () => {
  // Today's state for any key kind that has not been created yet: nothing
  // changes, and the boot log says which one is still on the deprecated path.
  const r = resolveSupabaseKey(undefined, "legacy-jwt-value");
  assert.equal(r.key, "legacy-jwt-value");
  assert.equal(r.source, "legacy");
  assert.equal(r.keySetProblem, "absent");
});

test("a MALFORMED key set falls back rather than taking the desk down", () => {
  // The safety property of this direction: preferring the key set must not mean
  // a typo in it is fatal while a working legacy key sits right there.
  for (const raw of ['{not json', '"sb_secret_abc"', '["sb_secret_abc"]', "null", "7",
                     '{"billing":"sb_secret_abc"}', '{"default":"   "}',
                     '{"default":{"k":"v"}}', '{"default":12345}']) {
    const r = resolveSupabaseKey(raw, "legacy-jwt-value");
    assert.equal(r.key, "legacy-jwt-value", `${raw}: must fall back to legacy`);
    assert.equal(r.source, "legacy", `${raw}: source must say legacy`);
    assert.equal(r.keySetProblem, "unreadable",
      `${raw}: must be distinguishable from an absent key set`);
  }
});

test("`absent` and `unreadable` stay distinguishable with no legacy either", () => {
  // "no secret key created yet" needs a different action from "the dictionary is
  // malformed", and FR-17 renders both as the same notice -- so the log line is
  // the only place the difference can live.
  const none = resolveSupabaseKey(undefined, undefined);
  assert.deepEqual(none, { key: "", source: "none", keySetProblem: "absent" });
  const bad = resolveSupabaseKey("{not json", "");
  assert.deepEqual(bad, { key: "", source: "none", keySetProblem: "unreadable" });
});

test("a non-string `default` never reaches the caller as a key", () => {
  // The specific harm: index.ts hands this straight to createClient at module
  // scope, which throws before handle() can reach its hasKeys check -- the bare
  // 500 with no CORS headers and no log line that HAS_KEYS exists to prevent.
  const r = resolveSupabaseKey('{"default":{"nested":"x"}}', "");
  assert.equal(typeof r.key, "string");
  assert.equal(r.key, "");
});

test("surrounding whitespace is trimmed off both generations", () => {
  assert.equal(resolveSupabaseKey('{"default":"  sb_secret_abc  "}', "").key, "sb_secret_abc");
  assert.equal(resolveSupabaseKey("", "  legacy  ").key, "legacy");
  // A whitespace-only key set is `absent`, not `unreadable` -- there is nothing
  // malformed about it, and the action it calls for is "create one".
  assert.equal(resolveSupabaseKey("   ", "legacy").keySetProblem, "absent");
});

test("a non-default key name can be read, and names the documented default", () => {
  // Supabase's guide: every key lives in the same dictionary under its own name,
  // and the first one is called `default`. Pinned so the constant cannot drift
  // from the name the platform actually ships.
  assert.equal(DEFAULT_API_KEY_NAME, "default");
  const raw = '{"default":"sb_secret_d","billing":"sb_secret_b"}';
  assert.equal(resolveSupabaseKey(raw, "", "billing").key, "sb_secret_b");
  assert.equal(resolveSupabaseKey(raw, "").key, "sb_secret_d");
  // A missing NAMED key falls back like any other unusable key set.
  assert.equal(resolveSupabaseKey(raw, "legacy", "nope").source, "legacy");
});
