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
import { handle } from "./handler.ts";

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
              : true));
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
        delete() { q.deleted = true; q._delete = true; return chain; },
        maybeSingle() { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); },
        single() {
          if (opts.denied?.includes(table)) return Promise.resolve({ data: null, error: { code: "42501", message: `permission denied for table ${table}` } });
          if (opts.fail?.[table]) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: q._single ?? run().data?.[0] ?? null, error: null });
        },
        then(res, rej) {
          if (q._delete) {
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
const SERVICE_ROLE_DENIED = ["profiles", "entities", "assets", "policies", "enhancement_requests"];

function deps(over = {}) {
  const tables = over.tables ?? seed();
  // ONE backing store, TWO clients with different privileges — exactly the live
  // split. `admin` may touch help_queries only; everything else is 42501.
  const admin = over.db ?? fakeDb(tables, { ...(over.dbOpts ?? {}), denied: SERVICE_ROLE_DENIED });
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
  assert.equal(body.retryAfter, 3600);
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

test("a billed non-answer keeps the reservation", async () => {
  for (const res of [{ stop_reason: "max_tokens", content: [{ type: "text", text: "half an ans" }] },
                     { stop_reason: "end_turn", content: [] }]) {
    const t = deps({ anthropic: { messages: { create: async () => res } } });
    assert.equal((await (await ask(t.d)).json()).reason, "incomplete");
    assert.equal(t.rows('help_queries').length, 1, "output was generated and billed, but the slot was refunded");
  }
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
                   "SENT-line", "SENT-carrier", "SENT-number", "SENT-cov-label", "SENT-cov-limit"];

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
  for (const [label, v] of [["asset value", "4242"], ["premium", "2400"], ["renewal date", "2027-03-12"]]) {
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

test("a client with hundreds of assets still gets their records — no 16KB URL cliff", async () => {
  // PostgREST puts an `.in()` list in the query STRING, ~39 chars per uuid, so a
  // single list crossed 16KB at roughly 410 ids and Cloudflare answered 520. That
  // was a PERMANENT records_error for that client — not a transient one — and
  // deliberately reachable by anyone holding an account. A fake has no URL, so
  // this asserts the BOUND rather than the symptom: no `in` list may exceed the
  // chunk size, whatever the client owns.
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
