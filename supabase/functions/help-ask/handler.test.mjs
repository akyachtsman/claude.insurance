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
  const api = {
    log, tables,
    from(table) {
      const q = { table, filters: [], _count: null, _head: false };
      log.push(q);
      const run = () => {
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
        select(_cols, o = {}) { q._head = Boolean(o.head); q._count = o.count ?? null; return chain; },
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
