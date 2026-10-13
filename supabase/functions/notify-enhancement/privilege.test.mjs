// privilege.test.mjs — asserts notify-enhancement never reaches a TABLE with the
// service-role key, and that the one place it still uses that key is the GoTrue
// admin API.
//
// WHY THIS FILE EXISTS, and it is not hypothetical. The version this replaces
// built a service-role client and used it for the row read, the `profiles` role
// lookup and three updates. `service_role` HOLDS NO TABLE PRIVILEGES IN THIS
// PROJECT — measured 2026-10-13, `has_table_privilege` false for SELECT, INSERT
// and UPDATE on `enhancement_requests` and false for SELECT on `profiles`, while
// `authenticated` has all of them. BYPASSRLS skips POLICIES, not PRIVILEGES. So
// the first DB call of every invocation returned 42501, the error was folded into
// a 404, and the function silently sent no email for its entire deployed life
// while reading ACTIVE in the dashboard.
//
// Nothing caught that, and nothing could have: CI never runs Deno, there is no
// test that executes this file, and the failure mode is a 404 that looks exactly
// like a bad request id. A static gate on WHICH CLIENT touches a table is the
// cheapest check that would have caught it, and it is the one that stops the next
// edit quietly reintroducing it — reaching for `admin.from(...)` is the obvious
// move for anyone who has not read the privilege measurement.
//
// ⚠️ THIS IS A TEXT ASSERTION AND THAT IS ITS LIMIT. It cannot prove the function
// works; only a deploy and a real request can. What it proves is narrower and
// still worth having: no table access is spelled on a service-role client, and
// the RPC the stamp depends on exists in a migration under the name the code
// calls. A property of the source, honestly scoped — not evidence of behaviour.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf8");

// Strip comments before scanning. The file documents the very mistake it must
// not contain — `admin.from("enhancement_requests")` appears in prose above —
// so a scan over raw text would fail on its own explanation.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/([^:])\/\/.*$/gm, "$1");

test("the source still parses the way this gate assumes", () => {
  // A gate whose scrape silently matches nothing passes forever. Anchor on
  // things that must be present, so a rename or a rewrite fails here loudly
  // instead of going quiet.
  assert.ok(/const\s+caller\s*=\s*createClient\(/.test(code), "no `caller` client found — has it been renamed?");
  assert.ok(/const\s+authAdmin\s*=\s*createClient\(/.test(code), "no `authAdmin` client found — has it been renamed?");
  assert.ok(code.includes("SERVICE_KEY"), "SERVICE_KEY is gone; this gate's premise has changed");
  assert.ok(/\.from\(/.test(code), "no table access at all — did the scan lose the code?");
});

// Every `.from(` / `.rpc(` in the handler, as {client, kind, target}. Shared by
// the two tests below and by the deploy-set gate, so there is one scrape rather
// than three that can drift apart.
function tableAccesses() {
  return [...code.matchAll(/([A-Za-z_$][\w$]*)\s*\n?\s*\.\s*(from|rpc)\(\s*["']([^"']+)["']/g)]
    .map((m) => ({ client: m[1], kind: m[2], target: m[3] }));
}

// The server-only dedup log, where `authenticated` holds nothing, and the ONE
// function permitted to write it. Everything about a CLIENT's own records goes
// through `caller` under RLS; these two are the service-role surface and the
// whole of it.
const CLAIM_TABLE = "enhancement_notifications";
const CLAIM_RPC = "claim_notification";
// Signature, because Postgres identifies a function by name AND argument types.
const CLAIM_RPC_ARGS = ["uuid", "text"];

// The CLIENT tables this handler touches — `.from(...)` only, and never the
// claim table. Used by the gates that ask "what must be narrowed for the client",
// which is a different question from "what must the service role reach".
// ── ONE ORDERING, ONE EFFECTIVE-STATE READER, USED BY EVERY GATE BELOW ──────
//
// ⚠️ THIS EXISTS BECAUSE THE SAME DEFECT APPEARED THREE TIMES, each caught by
// Codex, each in a gate I had just written:
//
//   1. the stamp-RPC gate took the FIRST matching definition (`.find()`), so a
//      later CREATE OR REPLACE dropping `owner = auth.uid()` would be ignored;
//   2. the claim-TABLE fence was scoped to the migration that creates the table,
//      so a later grant to `authenticated` would be ignored;
//   3. the claim-FUNCTION gate, written to fix a P1, reintroduced BOTH — first
//      definition, and EXECUTE grants scoped to the defining migration.
//
// global.md -> *Review Rounds Have to Terminate*: the third occurrence of one
// mechanism is a redesign, not a third patch. The mechanism was "each gate does
// its own lookup", so there is now one lookup. Postgres applies migrations in
// order and the LAST statement wins; any gate that reads a single file is
// asserting about a version that may never run.
function orderedMigrations() {
  const root = join(here, "..", "..");
  const read = (dir) => readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: `${dir}/${f}`, version: f, sql: readFileSync(join(root, dir, f), "utf8") }));
  // APPLIED FIRST, in version order; then PROPOSED, in filename order.
  //
  // ⚠️ I CHANGED THIS TO A SINGLE VERSION SORT AND IT WAS WRONG — caught by a
  // real assertion failing, not by reasoning. `migrations/` is what HAS run, in
  // the order it ran. `proposed/` has not run, so whenever it does, it runs
  // after all of those. A single version sort put
  // `proposed/20261013_enhancement_notifications.sql` BEFORE
  // `migrations/20261013005250_...` (punctuation collates before digits), so its
  // `revoke execute` was replayed before the grant it is meant to cancel, and
  // the stamp functions read as still executable by `authenticated`.
  //
  // What misled me was my own mutation: a probe migration in `migrations/` dated
  // 29990101 that grants the claim table to `authenticated`. That state cannot
  // exist — a file in `migrations/` is one that has ALREADY been applied, so it
  // cannot also be waiting to run after something unapplied. The realistic
  // version of that scenario is a second file in `proposed/` sorting after the
  // claim migration, which this ordering does catch. A mutation that encodes an
  // impossible state is worse than no mutation: it argues for a wrong fix.
  return [
    ...read("migrations").sort((a, b) => a.version.localeCompare(b.version)),
    ...read("proposed").sort((a, b) => a.version.localeCompare(b.version)),
  ];
}

// Argument TYPES of a parameter list, lowercased: "p_request uuid, p_event text"
// -> ["uuid","text"], and "uuid, text" -> ["uuid","text"]. Both spellings occur:
// a CREATE names the parameters, a GRANT names only the types.
function argTypes(params) {
  return params.split(",").map((a) => {
    const t = a.trim().replace(/\s+(default|=)[\s\S]*$/i, "").split(/\s+/).pop() || "";
    return t.toLowerCase().replace(/\[\]$/, "[]");
  }).filter(Boolean);
}

// ⚠️ EVERY READER BELOW IS KEYED ON THE FUNCTION'S SIGNATURE, NOT ITS NAME.
// Postgres identifies a function by name AND argument types, so
// `claim_notification(text, text)` is a DIFFERENT function from
// `claim_notification(uuid, text)` and both exist at once. A name-only scan
// treats an overload as a replacement — so an unsafe replacement of the uuid
// overload followed by a safe text overload validates the wrong body, and a
// revoke on one signature masks a grant on the one the handler actually calls.
// Codex, round 16.
function sameSignature(params, want) {
  const got = argTypes(params);
  return got.length === want.length && got.every((t, i) => t === want[i]);
}

// The definition Postgres would actually be running: the LAST create-or-replace
// of THIS SIGNATURE, across every migration in order — and the last one within a
// file, since one file may replace it twice.
function effectiveFunction(name, want) {
  const src = `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([^)]*)\\)([\\s\\S]*?)\\$\\$\\s*;`;
  let found = null;
  for (const m of orderedMigrations()) {
    const sql = m.sql.replace(/^\s*--.*$/gm, "");   // this repo documents what it must not contain
    for (const hit of sql.matchAll(new RegExp(src, "ig"))) {
      if (!sameSignature(hit[1], want)) continue;   // an overload is not a replacement
      found = { file: m.file, body: hit[0], sql };
    }
  }
  return found;
}

// Net EXECUTE state for ONE SIGNATURE, per grantee channel, after replaying every
// migration in order. `null` means nobody holds it; a filename means that
// migration left it OPEN.
//
// ⚠️ IT REPLAYS THREE THINGS, NOT JUST EXPLICIT PER-FUNCTION GRANTS. Codex,
// round 16, naming two ways the explicit-only version stayed green while the
// client could call the RPC:
//   · CREATION gives PUBLIC a default EXECUTE privilege. A later DROP + CREATE
//     that does not repeat the PUBLIC revoke silently restores it. (CREATE OR
//     REPLACE of an EXISTING function preserves the ACL, so it must NOT reset —
//     modelling it as a reset would cry wolf on a legitimate replace.)
//   · `grant execute on all functions in schema public to <role>` hits this
//     function without ever naming it.
function effectiveExecute(name, want) {
  const state = { authenticated: null, anon: null, public: null, service_role: null };
  let exists = false;
  const CH = Object.keys(state);
  const setFrom = (roles, verb, file) => {
    for (const ch of CH) {
      if (!new RegExp(`\\b${ch}\\b`, "i").test(roles)) continue;
      state[ch] = verb === "revoke" ? null : file;
    }
  };
  // ⚠️ `EXECUTE` IS NOT THE ONLY SPELLING. Postgres accepts
  // `ALL [PRIVILEGES]` as an alternative to `EXECUTE` for functions, and the
  // first version of both regexes matched only the literal word — so
  // `grant all privileges on all functions in schema public to authenticated`
  // left this gate green while every client could call the claim RPC. Codex,
  // round 17, with the mutation in hand.
  // ⚠️ It named the SCHEMA-WIDE form; the PER-FUNCTION one had the identical
  // hole (`grant all on function public.claim_notification(uuid, text) to
  // authenticated`), reproduced here before fixing. Fixing only the reported
  // spelling would have left the other half open — the same instance-not-class
  // mistake this PR has already paid for twice.
  const PRIV = "(?:execute|all(?:\\s+privileges)?)";
  const perFn = new RegExp(
    `\\b(grant|revoke)\\s+${PRIV}\\s+on\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)\\s+(?:to|from)\\s+([^;]*)`, "gi",
  );
  const schemaWide = new RegExp(
    `\\b(grant|revoke)\\s+${PRIV}\\s+on\\s+all\\s+(?:functions|routines)\\s+in\\s+schema\\s+public\\s+(?:to|from)\\s+([^;]*)`, "gi",
  );
  const created = new RegExp(`\\bcreate\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([^)]*)\\)`, "gi");
  const dropped = new RegExp(`\\bdrop\\s+function\\s+(?:if\\s+exists\\s+)?public\\.${name}\\s*\\(([^)]*)\\)`, "gi");

  for (const m of orderedMigrations()) {
    const sql = m.sql.replace(/^\s*--.*$/gm, "");
    // Statement order within a file matters as much as file order, so walk every
    // relevant statement by position rather than by category.
    const events = [];
    for (const h of sql.matchAll(created)) {
      if (sameSignature(h[2], want)) events.push({ at: h.index, kind: "create", replace: !!h[1] });
    }
    for (const h of sql.matchAll(dropped)) {
      if (sameSignature(h[1], want)) events.push({ at: h.index, kind: "drop" });
    }
    for (const h of sql.matchAll(perFn)) {
      if (sameSignature(h[2], want)) events.push({ at: h.index, kind: "acl", verb: h[1].toLowerCase(), roles: h[3] });
    }
    for (const h of sql.matchAll(schemaWide)) {
      events.push({ at: h.index, kind: "acl", verb: h[1].toLowerCase(), roles: h[2] });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.kind === "drop") { exists = false; for (const ch of CH) state[ch] = null; continue; }
      if (e.kind === "create") {
        if (!e.replace || !exists) {       // a fresh creation, not a replace of a live function
          for (const ch of CH) state[ch] = null;
          state.public = m.file;           // Postgres grants EXECUTE to PUBLIC by default
        }
        exists = true;
        continue;
      }
      setFrom(e.roles, e.verb, m.file);
    }
  }
  return state;
}

function clientTables() {
  return [...new Set(tableAccesses()
    .filter((a) => a.kind === "from" && a.target !== CLAIM_TABLE)
    .map((a) => a.target))];
}

test("every CLIENT table goes through the caller's client, and the claim table only through `claims`", () => {
  // The invariant, in one place: a service-role client must never reach a table
  // the client owns rows in. `caller` (anon key + the caller's JWT) is the only
  // client permitted on those, so RLS scopes every read and write and cannot be
  // removed by editing a `.eq()` out of this handler.
  //
  // ⚠️ THE CLAIM TABLE IS THE DELIBERATE EXCEPTION, and it is an exception that
  // makes the boundary stronger rather than weaker: `authenticated` holds
  // NOTHING on `enhancement_notifications`, which is the entire point — the
  // client cannot write its own notification claim, which is the root all four
  // bypasses in rounds 3-6 grew from. It is pinned to the `claims` client by
  // name so a service-role client cannot quietly acquire a second table.
  const accesses = tableAccesses();
  assert.ok(accesses.length >= 4, `expected at least 4 table/RPC accesses, found ${accesses.length}`);

  const claimTargets = new Set([CLAIM_TABLE, CLAIM_RPC]);
  const wrong = accesses.filter((a) =>
    claimTargets.has(a.target) ? a.client !== "claims" : a.client !== "caller");
  assert.deepEqual(
    wrong, [],
    `wrong client: ${wrong.map((w) => `${w.client}.${w.kind}("${w.target}")`).join(", ")} ` +
    `(client tables must use \`caller\`; ${CLAIM_TABLE} must use \`claims\`)`,
  );

  // And `claims` must not acquire a second table. Asserted as its own check
  // rather than left implied by the loop above, because "the service-role client
  // touches exactly one table" is the claim a reader needs to be able to trust.
  const claimsTargets = [...new Set(accesses.filter((a) => a.client === "claims").map((a) => a.target))];
  assert.deepEqual(
    claimsTargets, [CLAIM_RPC],
    `the \`claims\` service-role client must call ${CLAIM_RPC} and nothing else — not even ${CLAIM_TABLE} directly, because a direct insert carries no status predicate and that is the P1 this design exists to close; found: ${claimsTargets.join(", ")}`,
  );
});

test("the service-role client is used for the Auth admin API and nothing else", () => {
  const uses = [...code.matchAll(/\bauthAdmin\s*\n?\s*\.\s*([\w.]+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0, "authAdmin is never used — delete it rather than leaving a service-role client lying around");
  // `auth.admin.getUserById` is the whole permitted surface. It is the GoTrue
  // admin API, authorised by the service-role JWT and unaffected by Postgres
  // table grants, which is exactly why it still works where the table reads did
  // not. Anything else on this client — above all `.from` — is the regression.
  const allowed = new Set(["auth.admin.getUserById"]);
  const bad = uses.filter((u) => !allowed.has(u));
  assert.deepEqual(bad, [], `authAdmin must only call auth.admin.getUserById; found: ${bad.join(", ")}`);
});

test("the service-role CALLER path is gone", () => {
  // The old code accepted the service-role key in the Authorization header as an
  // alternative to a signed-in underwriter. Nothing used it, it could not have
  // worked (no table privileges), and removing it is what lets this function
  // deploy with verify_jwt ON. A reintroduction would silently restore an
  // unauthenticated-by-JWT entry point.
  assert.ok(!/isServiceRole/.test(code), "isServiceRole is back — the service-role caller path was removed deliberately");
  assert.ok(
    !/token\s*===\s*SERVICE_KEY/.test(code),
    "the bearer is being compared to the service-role key again",
  );
});

test("the claim goes to the claim table, and the old stamp columns are not written", () => {
  // Both branches must claim through the one helper, which is the only writer of
  // the server-only table.
  assert.ok(
    /async function claimNotification\(/.test(code),
    "claimNotification is gone — the claim has moved somewhere this gate cannot see",
  );
  for (const event of ["requested", "approved"]) {
    assert.ok(
      new RegExp(`claimNotification\\(\\s*requestId\\s*,\\s*["']${event}["']`).test(code),
      `the ${event} branch no longer claims through claimNotification`,
    );
  }

  // ⚠️ AND THE TWO OLD COLUMNS MUST STAY UNWRITTEN. They are vestigial after the
  // redesign, and a future edit that "restores" either one would quietly bring
  // back a second, client-reachable claim — which is the mechanism rounds 3-6
  // kept bypassing. Checked for a direct write and for the retired RPCs alike.
  for (const col of ["requested_notified_at", "approved_notified_at"]) {
    assert.equal(
      new RegExp(`\\.update\\(\\s*\\{[^}]*${col}`, "s").test(code), false,
      `${col} is being written by a direct .update(); the claim lives in the claim table now`,
    );
  }
  for (const fn of ["stamp_requested_notified", "stamp_approved_notified"]) {
    assert.equal(
      new RegExp(`\\.rpc\\(\\s*["']${fn}["']`).test(code), false,
      `${fn} is called again; the migration revokes EXECUTE on it from authenticated, so this would fail closed — and it is the bypass round 6 found`,
    );
  }
});

test("the CLAIM TABLE is defined in source, fenced, and declared blocking while unapplied", () => {
  // Cross-file drift gate, over SOURCE ONLY. The code and the migration are two
  // halves of one contract: this handler writes `enhancement_notifications`, and
  // if that table is not created and granted exactly as below, every claim
  // returns 42501 and the function silently sends nothing.
  //
  // ⚠️ WHAT THIS DOES NOT PROVE: that any migration is APPLIED. This reads
  // directories. A file in supabase/migrations/ whose remote apply was skipped or
  // FAILED is byte-identical to one that is live. Codex round 7 on PR #256; the
  // claim is narrowed rather than the check strengthened, because strengthening
  // it needs production credentials and this repo's Safety Rules forbid those in
  // tests. Directory placement is a CONVENTION this repo declares (CLAUDE.md:
  // "`supabase/migrations/` means live and matching `list_migrations`"), not
  // evidence. The authoritative check is the deploy step in index.ts's header.
  //
  // ⚠️ `proposed/` IS SEARCHED TOO, AND THAT IS NOT A LOOSENING. Unapplied
  // migrations live there precisely so `migrations/` can mean "live". A table
  // defined only there is a REAL state — the code ships before the owner
  // approves the migration — and the honest check is "is it defined, and if it
  // is not applied, is that declared where an operator will see it". So it must
  // be named in proposed/README.md as blocking the deploy.
  const root = join(here, "..", "..");
  const read = (dir) => readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: `${dir}/${f}`, sql: readFileSync(join(root, dir, f), "utf8") }));
  const applied = read("migrations");
  const proposed = read("proposed");
  const readme = readFileSync(join(root, "proposed", "README.md"), "utf8");

  const createRe = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${CLAIM_TABLE}\\b([\\s\\S]*?);`, "i",
  );
  const hit = [...applied, ...proposed].find((m) => createRe.test(m.sql));
  assert.ok(hit, `index.ts writes ${CLAIM_TABLE} but no migration creates public.${CLAIM_TABLE}`);
  const sql = hit.sql.replace(/^\s*--.*$/gm, "");   // comments stripped: this file documents what it must not contain
  const body = sql.match(createRe)[0];

  // ⚠️ SCOPED TO THE CREATE STATEMENT'S OWN BODY, not the whole migration and
  // certainly not the concatenated directory. The same scan, unscoped, passed a
  // mutation that deleted the guard from the object under test — a dozen other
  // migrations carry the same strings. An assertion that cannot fail is not a
  // check.
  assert.ok(
    /primary\s+key\s*\(\s*request_id\s*,\s*event\s*\)/i.test(body),
    `public.${CLAIM_TABLE} must keep its (request_id, event) primary key — that key IS the atomic claim, and without it two concurrent invocations both send`,
  );

  // The fence, asserted on the migration as a whole because these are separate
  // statements from the CREATE.
  assert.ok(
    new RegExp(`alter\\s+table\\s+public\\.${CLAIM_TABLE}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql),
    `public.${CLAIM_TABLE} must enable RLS; with no policies that is what closes it to every role that does not bypass RLS`,
  );
  assert.ok(
    new RegExp(`revoke\\s+all\\s+on\\s+public\\.${CLAIM_TABLE}\\s+from\\s+[^;]*\\bauthenticated\\b`, "i").test(sql),
    `public.${CLAIM_TABLE} must REVOKE ALL from authenticated — the client holding nothing here is the entire fix`,
  );
  assert.ok(
    new RegExp(`grant\\s+select\\s*,\\s*insert\\s+on\\s+public\\.${CLAIM_TABLE}\\s+to\\s+service_role`, "i").test(sql),
    `public.${CLAIM_TABLE} must grant select+insert to service_role — LOAD-BEARING: service_role has no table privileges in this project by default, so without it every claim is 42501`,
  );
  // ⚠️ NO DELETE, DELIBERATELY. A claim is kept once taken, including when the
  // provider errors. An un-claim is exactly the unbounded re-send this table
  // exists to prevent, so granting DELETE here would reopen the class.
  assert.equal(
    new RegExp(`grant\\s+[^;]*\\bdelete\\b[^;]*on\\s+public\\.${CLAIM_TABLE}`, "i").test(sql), false,
    `nothing may be granted DELETE on public.${CLAIM_TABLE}: an un-claim reopens the unbounded re-send`,
  );
  assert.equal(
    new RegExp(`grant\\s+[^;]*on\\s+public\\.${CLAIM_TABLE}\\s+to\\s+[^;]*\\b(authenticated|anon)\\b`, "i").test(sql), false,
    `public.${CLAIM_TABLE} must not be granted to authenticated or anon at all`,
  );

  // AND THE OLD CLAIM PATH MUST BE CLOSED IN THE SAME MIGRATION. Leaving EXECUTE
  // with `authenticated` would leave round 6's bypass open for no reason: the
  // grantee calls the stamp RPC directly, no email is sent, and a reader who
  // still trusts those columns is misled.
  // ⚠️ NET STATE AGAIN, not "a revoke appears in this file". A later migration
  // re-granting either stamp function to `authenticated` reopens round 6, and a
  // scan of the creating migration alone would never see it.
  for (const fn of ["stamp_requested_notified", "stamp_approved_notified"]) {
    const ex = effectiveExecute(fn, ["uuid"]);
    assert.equal(
      ex.authenticated, null,
      `EXECUTE on public.${fn} ends up held by authenticated (granted by ${ex.authenticated}) — that is round 6's direct-RPC bypass, reopened`,
    );
  }

  // ⚠️ AND THE FENCE IS THE NET EFFECT OF EVERY MIGRATION, NOT OF THE ONE THAT
  // CREATES THE TABLE. Everything above is scoped to `hit.sql`, which is correct
  // for the CREATE statement's own shape and WRONG for the grants: a later
  // migration could grant this table to `authenticated` and every assertion
  // above would still pass, because none of them looks outside the creating
  // file. Codex raised exactly this against the previous version of this gate
  // (it used `.find()` over unsorted migrations, so a later CREATE OR REPLACE of
  // a stamp function would have been ignored); that gate is gone with the RPCs,
  // but the class transferred straight into its replacement — which is the
  // interesting part, and the same "migration ORDER decides" lesson round 12
  // taught on the other replay. Applied there, not here, until now.
  //
  // So: replay every migration in order and assert the END STATE, through the
  // one shared ordering — see orderedMigrations() for why that ordering is
  // applied-then-proposed, and for the mutation that argued me into a wrong one.
  const ordered = orderedMigrations();
  const endState = {};   // channel -> priv -> file that last opened it
  for (const m of ordered) {
    for (const stmt of privilegeStatements(m.sql.replace(/^\s*--.*$/gm, ""), CLAIM_TABLE)) {
      for (const ch of stmt.channels) {
        endState[ch] ??= {};
        for (const priv of ["select", "insert", "update", "delete"]) {
          if (!carries(stmt, priv)) continue;
          endState[ch][priv] = stmt.verb === "revoke" ? null : m.file;
        }
      }
    }
  }
  const clientHolds = [];
  for (const ch of ["authenticated", "public"]) {
    for (const [priv, file] of Object.entries(endState[ch] ?? {})) {
      if (file) clientHolds.push(`${ch} holds ${priv.toUpperCase()} (granted by ${file})`);
    }
  }
  assert.deepEqual(
    clientHolds, [],
    `the client must end up holding NOTHING on public.${CLAIM_TABLE} — that is the entire fix, and it is what removes the root all four bypasses grew from: ${clientHolds.join("; ")}`,
  );
  for (const priv of ["select", "insert"]) {
    assert.ok(
      endState.service_role?.[priv],
      `service_role must end up holding ${priv.toUpperCase()} on public.${CLAIM_TABLE}, or every claim returns 42501 and the function silently sends nothing`,
    );
  }
  assert.equal(
    endState.service_role?.delete ?? null, null,
    `nothing may end up holding DELETE on public.${CLAIM_TABLE}: an un-claim reopens the unbounded re-send`,
  );

  if (hit.file.startsWith("proposed/")) {
    const base = hit.file.slice("proposed/".length);
    assert.ok(
      readme.includes(base),
      `${CLAIM_TABLE} is defined only in ${hit.file}, which is NOT applied — so ${base} must be listed in proposed/README.md`,
    );
    assert.ok(
      /BLOCKS THE .*DEPLOY|blocking the deploy|blocks the deploy/i.test(readme),
      `${base} is unapplied and the code writes it; proposed/README.md must say it blocks the deploy`,
    );
  }
});


test("the privilege narrowing that makes the stamp functions a boundary is present", () => {
  // ⚠️ THIS IS THE LOAD-BEARING STATEMENT OF THE WHOLE DESIGN, AND NOTHING
  // ASSERTED IT UNTIL A MUTATION SAID SO. Deleting
  // `revoke update on public.enhancement_requests from authenticated` left every
  // other test in this file green — while making both stamp functions
  // decorative, because the same caller can then write the columns directly.
  // That is the exact failure the functions exist to prevent (staff resetting a
  // stamp to force a re-send, or pre-claiming one to suppress the email), so an
  // assertion suite that misses it is checking the lock and not the door.
  const root = join(here, "..", "..");
  const sql = [...readdirSync(join(root, "migrations")).map((f) => ["migrations", f]),
               ...readdirSync(join(root, "proposed")).map((f) => ["proposed", f])]
    .filter(([, f]) => f.endsWith(".sql"))
    .map(([d, f]) => readFileSync(join(root, d, f), "utf8"))
    .join("\n")
    // ⚠️ STRIP `--` COMMENTS FIRST. These files document the very statements
    // they must not contain — the INVERSE block spells out the table-wide
    // `grant update ... to authenticated` as the documented reversal — so a
    // scan over raw text fails on the file's own explanation. Exactly the trap
    // already handled for the TypeScript scan above, met again on a second
    // surface; found because this assertion failed on a correct migration.
    .replace(/^[ \t]*--.*$/gm, "")
    .replace(/([^-])--.*$/gm, "$1");

  assert.ok(
    /revoke\s+update\s+on\s+public\.enhancement_requests\s+from\s+[^;]*\bauthenticated\b/i.test(sql),
    "no `revoke update on public.enhancement_requests from authenticated` — without it the stamp functions are decorative",
  );
  // And the re-grant must be COLUMN-SCOPED. A bare `grant update ... to
  // authenticated` after the revoke would restore the hole while looking like
  // part of the fix.
  const regrants = [...sql.matchAll(/grant\s+update\s*(\([^)]*\))?\s*on\s+public\.enhancement_requests\s+to\s+([^;]*);/gi)];
  assert.ok(regrants.length > 0, "the lifecycle columns are never granted back — advanceRequest would 42501");
  for (const g of regrants) {
    const cols = g[1];
    if (!/\bauthenticated\b/.test(g[2])) continue;
    assert.ok(cols, `a table-wide \`grant update on enhancement_requests to authenticated\` undoes the revoke: ${g[0].trim()}`);
    assert.ok(
      /\bstatus\b/.test(cols) && /\bapproved_at\b/.test(cols),
      `the re-grant must cover status and approved_at (advanceRequest writes exactly those): ${cols}`,
    );
    assert.ok(
      !/notified_at/.test(cols),
      `a notified_at column is granted back to authenticated, which reopens the reset and pre-claim: ${cols}`,
    );
  }

  // ⚠️ INSERT TOO. A COLUMN IS ONLY AS PROTECTED AS ITS WEAKEST WRITE PATH.
  // Narrowing UPDATE and leaving the table-wide INSERT grant live let a client
  // CREATE a request with a notification stamp already populated — the same
  // pre-claim through the other statement type, and the write-once trigger then
  // made the forged value immutable. Found by Codex minutes after the UPDATE
  // narrowing applied.
  assert.ok(
    /revoke\s+insert\s+on\s+public\.enhancement_requests\s+from\s+[^;]*\bauthenticated\b/i.test(sql),
    "no `revoke insert on public.enhancement_requests from authenticated` — a client can pre-stamp a request at creation",
  );
  const inserts = [...sql.matchAll(/grant\s+insert\s*(\([^)]*\))?\s*on\s+public\.enhancement_requests\s+to\s+([^;]*);/gi)];
  assert.ok(inserts.length > 0, "the creation columns are never granted back — addEnhancementRequest would 42501");
  for (const g of inserts) {
    if (!/\bauthenticated\b/.test(g[2])) continue;
    const cols = g[1];
    assert.ok(cols, `a table-wide \`grant insert on enhancement_requests to authenticated\` reopens the pre-claim: ${g[0].trim()}`);
    assert.ok(
      !/notified_at/.test(cols),
      `a notified_at column is insertable by authenticated, which is the pre-claim: ${cols}`,
    );
    // The columns addEnhancementRequest() actually writes. Dropping one breaks
    // client request creation outright.
    for (const need of ["owner", "subject", "message", "policy_id", "asset_id", "entity_id", "context"]) {
      assert.ok(
        new RegExp(`\\b${need}\\b`).test(cols),
        `the insert grant must cover ${need} — addEnhancementRequest writes it: ${cols}`,
      );
    }
  }
});

// ⚠️ BOTH BRANCHES, NOT JUST THE ONE THAT WAS REPORTED. The round-1 version of
// this test checked the requested branch only, and the approved branch carried
// the identical defect for a round (Codex #256 round 2, P1): it accepted
// `approved` by design, never read `approved_notified_at`, and stamped only
// after the sends, so an underwriter could resend indefinitely. A defect that
// exists in two arms of one function is ONE defect, and a per-branch test is how
// the second arm stays open. These are table-driven for that reason: a third
// event would have to be added to the table or the isolation assertion fails.
const BRANCHES = [
  {
    name: "requested",
    from: 'if (event === "requested")',
    to: 'event === "approved"',
    claim: 'claimNotification(requestId, "requested")',
    refusal: "already_notified",
    // Literal fragments that must be PRESENT and positioned before the first
    // send. ⚠️ Presence of the refusal STRING is not enough: a mutation to
    // `if (false) {` left "already_notified" sitting in a dead block, still
    // before the sends, and the position-only assertion passed. These pin the
    // guard EXPRESSION, which a dead branch cannot satisfy.
    requires: ["if (!claimed)"],
  },
  {
    name: "approved",
    from: 'if (row.status !== "underwriting" && row.status !== "approved")',
    to: null, // to end of file
    claim: 'claimNotification(requestId, "approved")',
    refusal: "already_notified",
    // `.select(` is load-bearing, not style: without it PostgREST returns no
    // body, `claimed` is empty on success as well as on a lost race, and the
    // two become indistinguishable. A mutation deleting it survived the first
    // version of this test.
    // ⚠️ `.eq("status", "approved")` binds the claim to the fact being
    // announced. Without it the claim matched a row another underwriter had
    // moved to `declined` after the stage read, and the client was emailed
    // "final approval" about a declined request (Codex #256 round 3).
    // `if (!moved ...)` is the other half: the underwriting->approved
    // transition must PROVE it matched, since PostgREST does not error when an
    // update matches zero rows.
    // ⚠️ The claim moved from a plain conditional update to an authorizing
    // SECURITY DEFINER function (Codex #256 round 4): `authenticated` held
    // UPDATE on every column, so staff could reset a stamp to force a re-send
    // OR pre-claim one to suppress the email entirely. `.eq("status",
    // "approved")` and the role check are now belt; the boundary is in the
    // function, which authorizes caller, status and direction.
    // `if (!moved ...)` stays: the underwriting->approved transition must still
    // prove it matched, because PostgREST does not error on a zero-row update.
    requires: [
      "if (!claimed)",
      "if (!moved || moved.length === 0)",
    ],
  },
];

for (const b of BRANCHES) {
  test(`the ${b.name}-event gate runs BEFORE any email is sent`, () => {
    const a = code.indexOf(b.from);
    assert.ok(a >= 0, `could not find the ${b.name} branch — has it been restructured?`);
    const z = b.to ? code.indexOf(b.to, a) : code.length;
    const branch = code.slice(a, z > a ? z : code.length);
    assert.ok(branch.length > 200, `could not isolate the ${b.name} branch`);

    const claimAt = branch.indexOf(b.claim);
    const firstSendAt = branch.indexOf("await sendEmail(");
    const keyGuardAt = branch.search(/if\s*\(\s*!RESEND_API_KEY\s*\)/);

    assert.ok(claimAt >= 0, `the ${b.name} branch no longer claims (${b.claim})`);
    assert.ok(firstSendAt >= 0, `no sendEmail in the ${b.name} branch — did the scan lose it?`);
    assert.ok(keyGuardAt >= 0, `the ${b.name} branch lost its !RESEND_API_KEY early return`);

    assert.ok(
      claimAt < firstSendAt,
      `${b.name}: the claim must be taken BEFORE any sendEmail — otherwise it gates nothing`,
    );
    assert.ok(
      keyGuardAt < claimAt,
      `${b.name}: the !RESEND_API_KEY return must precede the claim, or a keyless deploy marks rows it never emailed`,
    );

    // A refused claim must answer without sending. Asserted inside the branch,
    // so one branch cannot satisfy it on the other's behalf.
    const refusalAt = branch.indexOf(b.refusal);
    assert.ok(refusalAt >= 0, `${b.name}: no ${b.refusal} refusal`);
    assert.ok(refusalAt < firstSendAt, `${b.name}: the refusal must precede the first send`);

    // And the guard EXPRESSION itself, because the refusal string survives in a
    // dead block. Each must appear before the first send.
    for (const frag of b.requires) {
      const at = branch.indexOf(frag);
      assert.ok(at >= 0, `${b.name}: missing required guard \`${frag}\``);
      assert.ok(at < firstSendAt, `${b.name}: \`${frag}\` must appear before the first send`);
    }
  });
}

test("every event the handler accepts is covered by a branch in the table above", () => {
  // The isolation assertion. Without it, adding a third event would leave it
  // ungated and every test here would still pass.
  const accepted = [...code.matchAll(/event\s*!==\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(accepted.length > 0, "could not read the accepted event names from the guard clause");
  const covered = new Set(BRANCHES.map((b) => b.name));
  const missing = accepted.filter((e) => !covered.has(e));
  assert.deepEqual(missing, [], `these accepted events have no gate assertion: ${missing.join(", ")}`);
  assert.equal(
    accepted.length, BRANCHES.length,
    `the handler accepts ${accepted.length} events but this table covers ${BRANCHES.length}`,
  );
});

test("the requested branch keeps its bad_stage refusal", () => {
  assert.ok(
    /error:\s*"bad_stage",\s*status:\s*row\.status,\s*expected:\s*"requested"/.test(code),
    "the requested branch lost its bad_stage refusal",
  );
});

test("the deploy header names every RPC the code calls", () => {
  // The companion to the narrowed drift gate above. That gate cannot prove a
  // migration is applied, so the proof was moved to a DEPLOY STEP in index.ts's
  // header — and a deploy step that does not list a newly touched TABLE is a step
  // that silently stops covering it. This is what keeps the two in sync: add a
  // `.from("x")` without naming x in the deploy header and this fails.
  //
  // ⚠️ READS `src`, NOT `code`. `code` is comment-stripped (see the top of this
  // file), so the deploy header does not exist in it — the first version of this
  // test scanned `code` and failed with "the deploy header is gone", which is
  // the right failure for the wrong reason and would have been a confusing
  // false positive had it been written the other way round.
  //
  // Scoped to the header's own block, not the whole file, for the reason this
  // file already records twice: an assertion over a wider text than the property
  // belongs to cannot fail — every name here also appears in the handler below.
  const start = src.indexOf("BEFORE DEPLOYING THIS FUNCTION");
  assert.ok(start > 0, "the deploy header is gone — the list_migrations check has no home");
  const end = src.indexOf('import "jsr:', start);
  assert.ok(end > start, "could not find the end of the comment header");
  const header = src.slice(start, end);

  const touched = [...clientTables(), CLAIM_TABLE, CLAIM_RPC];
  assert.ok(touched.length > 2, "no client table access found — did the scan lose it?");
  for (const name of touched) {
    assert.ok(
      header.includes(name),
      `index.ts touches ${name} but the deploy header does not name it, so the list_migrations step would miss it`,
    );
  }
  assert.ok(
    /list_migrations/.test(header),
    "the deploy header no longer names list_migrations, which is the only authoritative applied-migration check available here",
  );

  // ⚠️ AND NAMING THE TABLES IS NOT THE WHOLE DEPENDENCY. The notification
  // boundary is the PRIVILEGE NARROWING on the tables this handler touches.
  // ⚠️ The two kinds of missing migration FAIL DIFFERENTLY, which is why both
  // are required: a missing CLAIM TABLE is fail-closed (every claim is 42501,
  // the function answers `claim_failed`, nothing is sent), while a missing
  // REVOKE leaves a working function with no boundary — silent, and the worse
  // direction. Codex #256 round 8.
  //
  // SET EQUALITY AGAINST A DERIVED SET, on ONE machine-readable line.
  // ⚠️ An earlier version asked `header.includes(version)` and a mutation
  // deleting 20261013014854 from the checklist SURVIVED, because the paragraph
  // explaining why it matters still named it. Same class as the two scans in
  // this file that matched a migration's own prose: an assertion over a wider
  // text than the property belongs to cannot fail. So the header carries a
  // single `CONFIRM APPLIED:` line and this compares that line, exactly.
  //
  // THE REQUIRED SET IS DERIVED, never hand-maintained: every APPLIED migration
  // that REVOKES on a table this handler names in `.from(...)`.
  //
  // ⚠️ IT USED TO BE DERIVED FROM THE RPC BODIES, AND THAT ANCHOR IS GONE WITH
  // THE RPCs. Re-anchoring on `.from(...)` is not a loosening — it is strictly
  // closer to the thing that matters, because it reads what this handler
  // actually touches rather than what a function it calls happens to mention.
  // It also keeps round 9's finding covered for the same reason that one was
  // missed: `profiles` is in the set because THIS FILE reads it to authorize the
  // approved path, so 20261005120100 is still required. A hard-coded table list
  // could not see that; this does.
  //
  // ⚠️ THE CLAIM TABLE'S OWN MIGRATION IS DELIBERATELY NOT IN THIS SET WHILE IT
  // IS UNAPPLIED — it lives in proposed/ and has no applied version to name. The
  // gate above requires it to be declared deploy-blocking in proposed/README.md
  // instead. When it is applied and moves to migrations/, it revokes on a
  // touched table (`revoke all ... from anon, authenticated`), so this
  // derivation picks it up automatically and set equality then REQUIRES it on
  // the line. Nothing has to remember to add it.
  //
  // Equality, not containment — so a version left behind after its migration is
  // renamed or dropped fails too, the same inversion lesson as BACK_ELIGIBLE.
  // Comments are stripped before the revoke scan: this file has already been
  // bitten twice by a migration's prose documenting the statement it must not
  // contain. `on function` is excluded — an EXECUTE revoke is the functions' own
  // hygiene, not a table boundary.
  const migDir = join(here, "..", "..", "migrations");
  const migs = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, version: f.split("_")[0], sql: readFileSync(join(migDir, f), "utf8") }));

  const trusted = new Set(clientTables());
  const required = new Set();
  const revokers = migs.filter((m) => {
    const sql = m.sql.replace(/^\s*--.*$/gm, "");
    return [...sql.matchAll(/revoke\s+[a-z, ()\w]*?\s+on\s+(?:table\s+)?public\.(\w+)/gi)]
      .some((r) => trusted.has(r[1]));
  });
  assert.ok(
    revokers.length > 0,
    `no migration revokes on any table this handler touches (${[...trusted].sort().join(", ")}) — the privilege narrowing that makes the claim a boundary is gone`,
  );
  for (const m of revokers) required.add(m.version);

  const line = header.split("\n").find((l) => l.includes("CONFIRM APPLIED:"));
  assert.ok(line, "the deploy header has no `CONFIRM APPLIED:` line, so nothing names the migrations to verify");
  const listed = new Set(line.slice(line.indexOf("CONFIRM APPLIED:")).match(/\d{14}/g) || []);
  assert.deepEqual(
    [...listed].sort(), [...required].sort(),
    "the deploy header's CONFIRM APPLIED list does not match the migrations this function actually depends on " +
    `(revoking on a table it touches: ${[...trusted].sort().join(", ")}): ` +
    `listed ${[...listed].sort().join(", ") || "none"}, required ${[...required].sort().join(", ")}`,
  );
});

// Parses the privilege list of a GRANT or REVOKE on `public.<table>` naming
// `authenticated`, and reports whether a given privilege is carried TABLE-WIDE
// (no column list) or column-scoped.
//
// ⚠️ WHY THIS IS A PARSER AND NOT A REGEX PER PRIVILEGE. The first version
// matched `grant\s+update\s+on ...`, i.e. the privilege immediately after the
// keyword — so a COMBINED statement, `grant select, insert, update on ... to
// authenticated`, matched neither UPDATE nor INSERT. That form is not
// hypothetical: it is how this repo granted both trusted tables in the first
// place (20260628083000 for enhancement_requests, 20260624171708 for profiles),
// so a future combined re-grant after the revokes would have reopened direct
// stamp writes with the security test still green. Codex #256 round 10.
//
// `all` / `all privileges` counts as carrying every privilege. A per-privilege
// column list (`grant update (status, approved_at)`) is column-scoped, which is
// the re-grant the narrowing depends on and must NOT be flagged.
function privilegeStatements(sql, table) {
  const out = [];
  // ⚠️ `[^;]*?` FOR THE PRIVILEGE LIST, NOT `[\s\S]*?`. With the latter a match
  // starting at an earlier statement's `revoke execute on function public.x(...)
  // from ...` ran ACROSS the semicolon and swallowed the real
  // `revoke update on public.enhancement_requests from authenticated` into its
  // privilege list — so the file's own revoke went unseen and the test failed
  // claiming nothing revokes it. Statement-scoped by construction instead.
  const re = /\b(grant|revoke)\s+([^;]*?)\s+on\s+(?:table\s+)?public\.(\w+)\s+(to|from)\s+([^;]*)/gi;
  for (const m of sql.matchAll(re)) {
    const [, verb, privList, onTable, , roles] = m;
    if (onTable.toLowerCase() !== table.toLowerCase()) continue;
    // ⚠️ TWO CHANNELS, NOT ONE. `authenticated` holds a privilege if it was
    // granted DIRECTLY to it **or** granted to PUBLIC, which every role
    // inherits — and a revoke only closes the channel it names, so
    // `revoke ... from authenticated` leaves a PUBLIC grant standing and vice
    // versa. The first version of this filter required `authenticated` in the
    // grantee text, so `grant update on public.profiles to public` was ignored
    // entirely and the replay stayed green while any client could again set
    // their own role to 'underwriter'. Codex #256 round 12.
    const channels = new Set();
    if (/\bauthenticated\b/i.test(roles)) channels.add("authenticated");
    if (/\bpublic\b/i.test(roles)) channels.add("public");
    if (/\bservice_role\b/i.test(roles)) channels.add("service_role");
    if (channels.size === 0) continue;
    // Split the privilege list on commas at paren depth 0, so a column list
    // cannot be mistaken for a privilege separator.
    const items = [];
    let depth = 0, cur = "";
    for (const ch of privList) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { items.push(cur); cur = ""; continue; }
      cur += ch;
    }
    items.push(cur);
    const privs = new Map();
    for (const raw of items) {
      const item = raw.trim();
      if (!item) continue;
      const name = (item.match(/^([a-z ]+?)\s*(\(|$)/i)?.[1] || item).trim().toLowerCase()
        .replace(/^all privileges$/, "all");
      privs.set(name, { tableWide: !item.includes("(") });
    }
    out.push({ verb: verb.toLowerCase(), privs, channels });
  }
  return out;
}

function carries(stmt, priv) {
  return stmt.privs.get(priv) ?? stmt.privs.get("all") ?? null;
}

test("every table this handler touches has its client write surface narrowed IN SOURCE", () => {
  // ⚠️ WRITTEN BECAUSE A MUTATION SURVIVED. The deploy-set gate above requires
  // the MIGRATION to be named; it does not require the STATEMENT to exist.
  // Deleting `revoke update on public.profiles from authenticated` left that
  // gate green, because the same file still carries the INSERT revoke and so
  // stays in the derived set. The named-migration check and the narrowing itself
  // are two different claims, and only the first had a test for `profiles` —
  // `enhancement_requests` had one (above) and that asymmetry is exactly how the
  // weaker half hides.
  //
  // THE INVARIANT: for every table the stamp functions read or write, the
  // `authenticated` role must END UP with no table-wide UPDATE and no
  // table-wide INSERT. The functions are SECURITY DEFINER precisely so the
  // caller does not need those; leaving either makes the function decorative,
  // and on `profiles` it is worse than decorative — table-wide UPDATE there
  // means a client can set their own `role` to 'underwriter', which
  // `stamp_approved_notified` then trusts (Codex #256 round 9).
  //
  // ⚠️ "END UP" IS DOING WORK: MIGRATION ORDER DECIDES. Both trusted tables
  // were originally granted table-wide, so a check that ignored order would
  // flag those original grants (false positive) or, read the other way, miss a
  // re-grant that lands AFTER the revoke (false negative, the one that matters).
  // Versions are 14-digit timestamps, so lexicographic order IS chronological.
  // Codex #256 round 10.
  //
  // The table list is DERIVED from the function bodies, the same two-hop scan as
  // the deploy-set gate, so a new trusted table is covered the day it appears.
  const migDir = join(here, "..", "..", "migrations");
  const migs = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, version: f.split("_")[0], sql: readFileSync(join(migDir, f), "utf8").replace(/^\s*--.*$/gm, "") }))
    .sort((a, b) => a.version.localeCompare(b.version));

  // ⚠️ DERIVED FROM `.from(...)`, NOT FROM RPC BODIES. The RPC anchor went with
  // the RPCs when the claim moved to its own table; this reads the tables THIS
  // handler actually touches, which is strictly closer to the property. Round
  // 9's finding stays covered for the same reason it was originally missed:
  // `profiles` is in the set because this file reads it to authorize the
  // approved path, so its narrowing is still required here.
  //
  // ⚠️ THE CLAIM TABLE IS EXCLUDED, and not for convenience. Its fence is
  // `revoke ALL from authenticated` plus zero policies — asserted in full by the
  // claim-table gate above — whereas this test asserts the OTHER shape: a table
  // the client legitimately writes, narrowed to specific columns. Running the
  // "no table-wide UPDATE/INSERT" rule against a table the client may not touch
  // at all would be checking the wrong invariant, and it would pass vacuously
  // once the migration is applied, which is worse than not running it.
  const trusted = new Set(clientTables());
  assert.ok(trusted.size > 0, "no client tables derived from the handler's .from() calls — did the scan lose them?");

  for (const table of trusted) {
    for (const priv of ["update", "insert"]) {
      // Replay the migrations in order and keep the LAST word on this
      // privilege: a table-wide grant opens it, a revoke closes it, and a
      // column-scoped grant leaves it closed.
      // ⚠️ ONLY A TABLE-WIDE REVOKE CLOSES A TABLE-WIDE GRANT. In Postgres,
      // `revoke update (role) on public.profiles from authenticated` removes a
      // COLUMN privilege and leaves the table-level one untouched — so treating
      // any revoke as closing the table-wide state meant a migration narrowing
      // the existing `revoke update on public.profiles` to `(role)` would leave
      // clients able to self-assign `underwriter` with this test still green.
      // Codex #256 round 11; it is the mirror of the grant side, where a column
      // list makes a statement harmless, and here it makes one ineffective.
      // One replay PER CHANNEL, because a revoke closes only the channel it
      // names. `authenticated` ends up holding the privilege if EITHER channel
      // is still open.
      const openedBy = { authenticated: null, public: null };
      let everRevoked = false;
      for (const m of migs) {
        for (const stmt of privilegeStatements(m.sql, table)) {
          const held = carries(stmt, priv);
          if (!held) continue;
          // ⚠️ CLIENT CHANNELS ONLY. `service_role` is a channel the parser now
          // reports (the claim-table gate needs it), and it is irrelevant here:
          // this test is about what the CLIENT ends up holding. Iterating it
          // would flag a legitimate service-role grant as "undoing the
          // narrowing" — a false positive on the one role that is supposed to
          // hold privileges.
          for (const ch of [...stmt.channels].filter((c) => c !== "service_role")) {
            if (stmt.verb === "revoke") {
              if (!held.tableWide) continue;      // column-scoped: no effect on the table privilege
              everRevoked = true;
              openedBy[ch] = null;
            } else if (held.tableWide) openedBy[ch] = m.file;
          }
        }
      }
      assert.ok(
        everRevoked,
        `no migration revokes table-wide ${priv.toUpperCase()} on public.${table} — ` +
        `the stamp functions trust that table, so a client holding it writes the columns directly`,
      );
      const open = Object.entries(openedBy).filter(([, f]) => f);
      assert.deepEqual(
        open, [],
        // ⚠️ "STILL IN FORCE", not "after the revoke" — the first wording was
        // wrong for the case that matters most. A `grant ... to public` placed
        // BEFORE the revokes is still open at the end, because
        // `revoke ... from authenticated` does not touch the PUBLIC channel.
        // Order does not launder a PUBLIC grant, and a message saying "after
        // the revoke" would send a reader looking for a late migration that
        // does not exist.
        open.map(([ch, f]) =>
          `${f} leaves table-wide ${priv.toUpperCase()} on public.${table} granted to ` +
          `${ch.toUpperCase()}` +
          (ch === "public" ? " (which every role inherits, authenticated included)" : "") +
          ` and still in force at the end of the replay — no later revoke closes the ` +
          `${ch.toUpperCase()} channel, so the narrowing the stamp functions depend on is absent`)
          .join("; "),
      );
    }
  }
});

test("EVERY recipient is resolved and validated before either claim", () => {
  // ⚠️ ORDERING, AND THE MIRROR IMAGE OF ROUND 1. Round 1 was "the gate ran
  // after the side effect". This is "something that can fail WITHOUT a side
  // effect ran after the gate". Together they give the rule this test pins:
  // the claim comes AFTER everything that can fail without sending, and BEFORE
  // anything that sends (the latter is the BRANCHES table above).
  //
  // Why it matters: `sendEmail("")` returns {sent:false, reason:"no_recipient"}
  // rather than throwing, so an empty address discovered after the claim means
  // 200 to the caller and a notification that is PERMANENTLY undeliverable —
  // the claim is write-once by design.
  //
  // ⚠️ THIS TEST IS BRANCH-GENERIC ON PURPOSE. Its first version asserted the
  // approved branch's client lookup alone, because that is the instance round
  // 10 found; round 11 named three more doors into the same mechanism (an unset
  // BROKER_EMAIL on either branch, and a requested-event caller whose JWT
  // carries no email). A per-instance assertion would have passed all three.
  const gates = [
    { name: "requested", from: 'if (event === "requested")', claim: 'claimNotification(requestId, "requested")' },
    { name: "approved", from: 'if (row.status !== "underwriting"', claim: 'claimNotification(requestId, "approved")' },
  ];

  assert.ok(
    /function missingRecipients\(/.test(code),
    "the shared recipient gate is gone — each branch would validate recipients by habit again",
  );
  assert.ok(
    /filter\(\(\[, v\]\) => !v\.trim\(\)\)/.test(code),
    "missingRecipients no longer treats a blank address as missing",
  );
  assert.ok(
    /error: "no_recipient", missing/.test(code),
    "missingRecipients no longer reports WHICH recipient is missing, which is the only actionable part",
  );

  for (const g of gates) {
    const a = code.indexOf(g.from);
    assert.ok(a >= 0, `could not find the ${g.name} branch — has it been restructured?`);
    const branch = code.slice(a, g.name === "requested" ? code.indexOf('if (row.status !== "underwriting"', a) : code.length);

    const claimAt = branch.indexOf(g.claim);
    const callAt = branch.indexOf("missingRecipients({");
    const returnAt = branch.indexOf("if (badRecipients) return badRecipients;");
    assert.ok(claimAt >= 0, `the ${g.name} branch no longer claims`);
    assert.ok(callAt >= 0, `the ${g.name} branch does not call missingRecipients`);
    assert.ok(returnAt >= 0, `the ${g.name} branch calls missingRecipients without RETURNING on a failure`);
    assert.ok(
      callAt < claimAt && returnAt < claimAt,
      `the ${g.name} branch must validate recipients and RETURN before the claim, ` +
      `or a missing address burns a claim that can never be retaken`,
    );

    // ⚠️ AND THE SEND-FAILURE LOG, PER BRANCH. This assertion used to sit
    // OUTSIDE this loop and search the whole file for one `||`, so it passed
    // while the requested branch still had `&&` — the approved branch's fix
    // satisfied it. Codex #256 round 12, and the fourth time in this pair that
    // an assertion over a wider text than the property belongs to could not
    // fail. "Branch-generic" has to mean asserted INSIDE each branch's slice.
    assert.ok(
      /if \(!brokerMail\.sent \|\| !clientMail\.sent\)/.test(branch),
      `the ${g.name} branch logs only when BOTH sends fail, so a half-delivered ` +
      `notification on an unrepeatable claim is invisible`,
    );
    assert.ok(
      !/if \(!brokerMail\.sent && !clientMail\.sent\)/.test(branch),
      `the ${g.name} branch still has the && form of the send-failure log`,
    );

    // BOTH recipients, in the one call. A gate that checks the client and not
    // the broker is the round-11 finding.
    const call = branch.slice(callAt, branch.indexOf("}", callAt) + 1);
    for (const who of ["broker: BROKER_EMAIL", "client:"]) {
      assert.ok(
        call.includes(who),
        `the ${g.name} branch's recipient gate does not cover \`${who}\` — it reads \`${call}\``,
      );
    }
  }

  // The approved branch additionally resolves the address through the Auth admin
  // API, which can fail on its own; that lookup must also precede the claim.
  const approved = code.slice(code.indexOf('if (row.status !== "underwriting"'));
  assert.ok(
    approved.indexOf("auth.admin.getUserById") >= 0 &&
    approved.indexOf("auth.admin.getUserById") < approved.indexOf('claimNotification(requestId, "approved")'),
    "the owner lookup must run BEFORE the claim, or a lookup failure burns a claim that can never be retaken",
  );
  assert.ok(
    /if \(ownerErr\) \{/.test(approved),
    "the approved branch no longer checks the getUserById error, so a transient failure reads as 'no email'",
  );

});

test("the claim FAILS CLOSED: an error is never read as 'already claimed'", () => {
  // ⚠️ WRITTEN BECAUSE A MUTATION SURVIVED. Changing claimNotification's error
  // branch to `return { claimed: null, error: null }` passed every other test in
  // this file — while converting the single most dangerous failure mode into a
  // silent one. The comment above that helper claimed "FAIL CLOSED, and the two
  // outcomes are not the same"; nothing checked it. Same class as the other
  // comment-overclaims-code findings this pair has produced all evening, and
  // found the same way.
  //
  // WHY IT MATTERS MORE THAN IT LOOKS. Zero rows means someone else holds the
  // claim -> `already_notified`, nothing sent, correct. An ERROR means the claim
  // could not be evaluated AT ALL — the migration is not applied, the grant is
  // missing, the database is unreachable. Collapsing the second into the first
  // makes every notification vanish quietly the moment the table or the grant
  // goes missing, which is precisely how this function spent its entire deployed
  // life before PR #256: a 42501 folded into a 404 that looked like a bad id.
  const m = code.match(/async function claimNotification\([\s\S]*?\n\}/);
  assert.ok(m, "claimNotification is gone or has been reshaped beyond this scan");
  const body = m[0];   // scoped to the helper: the smallest unit owning this property

  assert.ok(
    /if\s*\(error\)\s*return\s*\{[^}]*\berror\b\s*\}/.test(body),
    "claimNotification's error branch must return the error itself (shorthand `{ ..., error }`), so the caller can tell a failed claim from a taken one",
  );
  assert.equal(
    /if\s*\(error\)\s*return\s*\{[^}]*error\s*:\s*null/.test(body), false,
    "claimNotification nulls its error on the failure path — a missing table, a missing grant or an unreachable database would then read as 'already claimed' and silently send nothing",
  );

  // And both call sites must act on it: an error is `claim_failed` (500), never
  // the 409 that means someone else holds the claim.
  const sites = [...code.matchAll(/claimNotification\(requestId,\s*"(requested|approved)"\)/g)];
  assert.equal(sites.length, 2, `expected both branches to claim; found ${sites.length}`);
  for (const [, event] of sites) {
    const at = code.indexOf(`claimNotification(requestId, "${event}")`);
    const after = code.slice(at, at + 600);
    assert.ok(
      /if\s*\(claimErr\)/.test(after) && /claim_failed/.test(after),
      `the ${event} branch does not turn a claim error into claim_failed`,
    );
    assert.ok(
      /already_notified/.test(after),
      `the ${event} branch does not turn a zero-row claim into already_notified`,
    );
  }
});

test("the claim is BOUND TO THE REQUEST'S STATUS, in the same statement", () => {
  // ⚠️ CODEX P1 ON THE REDESIGN COMMIT, and the sharpest finding of the pair.
  // The first version of this redesign had the handler insert into the claim
  // table directly, so the claim carried no status predicate at all. If another
  // underwriter sets the request to `declined` after this handler's guarded
  // transition, that insert still claims the `approved` event and the client is
  // sent a FALSE FINAL-APPROVAL EMAIL. The primary key bounds it to one email;
  // it does not prevent it.
  //
  // I had written that window up as "one possibly-stale email", which was the
  // wrong reading: on the requested path a late email is merely stale, on the
  // approved path it asserts something untrue about the client's policy. The OLD
  // column-based claim did this one thing right — `and status = 'approved'` in
  // the same statement — and the redesign dropped it while fixing everything
  // around it.
  // ⚠️ THE EFFECTIVE DEFINITION, NOT THE FIRST ONE. A later CREATE OR REPLACE
  // that drops either status predicate is what Postgres would run, and the first
  // version of this gate took the first match — the same defect Codex had
  // already found on the stamp-RPC gate, reintroduced in its replacement. Third
  // occurrence of that class; see orderedMigrations() for why it is now one
  // shared lookup rather than a third patch.
  const hit = effectiveFunction(CLAIM_RPC, CLAIM_RPC_ARGS);
  assert.ok(hit, `the handler calls ${CLAIM_RPC} but no migration defines public.${CLAIM_RPC}`);
  const body = hit.body;   // scoped to the function's own body

  // The predicate, both directions. A claim for an event may only be taken while
  // the request is at the status that event announces.
  for (const [event, status] of [["requested", "requested"], ["approved", "approved"]]) {
    assert.ok(
      new RegExp(`p_event\\s*=\\s*'${event}'[\\s\\S]{0,80}?r\\.status\\s*=\\s*'${status}'`, "i").test(body),
      `public.${CLAIM_RPC} must refuse a '${event}' claim unless the request is still at status '${status}' — without it a declined request can still be announced as approved`,
    );
  }
  // It has to be ONE statement. A read-then-insert reopens the window it closes.
  assert.ok(
    /insert\s+into[\s\S]*?select[\s\S]*?from\s+public\.enhancement_requests[\s\S]*?where/i.test(body),
    `public.${CLAIM_RPC} must take the claim and check the status in ONE statement (insert ... select ... where); a separate read reopens the race`,
  );
  assert.ok(
    /on\s+conflict[\s\S]*?do\s+nothing[\s\S]*?returning/i.test(body),
    `public.${CLAIM_RPC} must keep its ON CONFLICT DO NOTHING ... RETURNING — that is what makes a concurrent second claim return NULL rather than raise`,
  );

  // ⚠️ AND IT MUST NOT BE CALLABLE BY THE CLIENT. This is the whole difference
  // between this function and the stamp functions round 6 bypassed: those were
  // granted EXECUTE to `authenticated`.
  // ⚠️ THE NET EXECUTE STATE AFTER EVERY MIGRATION, not the grants in the file
  // that happens to define the function. A later `grant execute ... to
  // authenticated` would otherwise pass unseen — and that is round 6 exactly:
  // the client taking its own claim and permanently suppressing the real
  // notification. Codex raised this as its own finding, in the same review that
  // caught the first-definition half.
  const exec = effectiveExecute(CLAIM_RPC, CLAIM_RPC_ARGS);
  for (const ch of ["authenticated", "anon", "public"]) {
    assert.equal(
      exec[ch], null,
      `EXECUTE on public.${CLAIM_RPC} ends up held by ${ch.toUpperCase()} (granted by ${exec[ch]}) — the client can then take its own claim and suppress the real notification, which is round 6 again`,
    );
  }
  assert.ok(
    exec.service_role,
    `EXECUTE on public.${CLAIM_RPC} must end up granted to service_role, or every claim fails and nothing is ever sent`,
  );
  assert.ok(
    /security\s+definer/i.test(body) && /set\s+search_path\s*=\s*''/.test(body),
    `public.${CLAIM_RPC} must be SECURITY DEFINER with a pinned search_path (advisor 0011)`,
  );
});

test("the retired stamp columns are not read back as a gate", () => {
  // ⚠️ CODEX P2, same review. Two prechecks still gated on
  // `row.requested_notified_at` / `row.approved_notified_at`, so for any row
  // whose OLD stamp had been set — including by round 6's direct-RPC bypass, and
  // including this repo's own probe rows, whose values are write-once and which
  // the migration neither clears nor imports — the handler answered
  // `already_notified` BEFORE consulting the claim table. The suppression bypass
  // survived the redesign for exactly those rows.
  //
  // The columns are not even SELECTed now, which makes a relapse impossible
  // rather than merely absent.
  for (const col of ["requested_notified_at", "approved_notified_at"]) {
    assert.equal(
      new RegExp(`row\\.${col}`).test(code), false,
      `the handler reads row.${col}; that column is vestigial and gating on it reinstates the suppression bypass for already-stamped rows`,
    );
    assert.equal(
      new RegExp(`select\\(["'][^"']*${col}`).test(code), false,
      `the handler still selects ${col} — don't fetch what must not be trusted`,
    );
  }
});

test("the claim serializes against a concurrent stage change", () => {
  // ⚠️ CODEX P1, ROUND 16, on the line its own P1 from round 15 had just added.
  // The status predicate is a snapshot read under READ COMMITTED: a decline that
  // has UPDATEd the request but not yet COMMITTED is invisible to it, so the
  // select still sees `approved`, the claim inserts, the decline commits, and
  // the client is sent a FALSE APPROVAL EMAIL. Adding the predicate narrowed
  // that window; only a row lock closes it.
  //
  // With `for update` the statement BLOCKS on the uncommitted decline and, when
  // it commits, READ COMMITTED re-evaluates the predicate against the new row
  // version (EvalPlanQual) — status is `declined`, nothing is inserted.
  const hit = effectiveFunction(CLAIM_RPC, CLAIM_RPC_ARGS);
  assert.ok(hit, `no migration defines public.${CLAIM_RPC}(${CLAIM_RPC_ARGS.join(", ")})`);
  assert.ok(
    /\bfor\s+update\b/i.test(hit.body),
    `public.${CLAIM_RPC} must lock the request row (\`for update\`) — the status predicate alone is a snapshot read, so an uncommitted decline stays invisible and the claim is taken on a row that is about to be declined`,
  );
  // The lock has to be on the request, inside the same statement — not a
  // separate SELECT ... FOR UPDATE before it, which reopens the gap it closes.
  assert.ok(
    /insert\s+into[\s\S]*?from\s+public\.enhancement_requests[\s\S]*?for\s+update[\s\S]*?on\s+conflict/i.test(hit.body),
    `the \`for update\` must be part of the INSERT ... SELECT that takes the claim, between the request table and the ON CONFLICT`,
  );
});

test("the migration documents a real-client probe of the claim RPC", () => {
  // ⚠️ THIS ASSERTS A COMMENT, WHICH THIS FILE NORMALLY REFUSES TO DO — and the
  // reason is the scanner's own stated limit. The scan cannot model
  // `ALTER DEFAULT PRIVILEGES`, role inheritance, or a grant to a role outside
  // the four channels it tracks; it says so. The deploy-time probe is the
  // authoritative check for exactly those paths, so losing the probe silently
  // would remove the only cover for the gap this file admits to.
  //
  // Codex, round 18: the first version of the footer probed the TABLE's ACL, the
  // RETIRED function, and service_role — never the one SECURITY DEFINER function
  // a client could use to pre-consume a claim. A stated fallback that does not
  // test the thing it is falling back for is not a fallback.
  const hit = effectiveFunction(CLAIM_RPC, CLAIM_RPC_ARGS);
  assert.ok(hit, `no migration defines public.${CLAIM_RPC}`);
  const raw = readFileSync(join(here, "..", "..", hit.file), "utf8");
  const probes = raw.slice(raw.indexOf("POST-APPLY PROBE"));
  assert.ok(probes.length > 0, `${hit.file} has no post-apply probe section`);

  // ⚠️ SCOPED TO THE ONE PROBE THAT OWNS EACH PROPERTY, not to the whole footer.
  // `42501` appears in probes 1 and 2 as well, so asserting it against the
  // joined text would pass with probe 2b carrying no expectation at all — the
  // same defect as the concatenated-migrations scan recorded in CLAUDE.md
  // ("an assertion over concatenated files cannot fail"). The block runs from
  // its own numbered heading to the next one.
  const call = new RegExp(`select\\s+public\\.${CLAIM_RPC}\\(`);
  const at = probes.search(call);
  assert.ok(
    at !== -1,
    `${hit.file}'s probes never call public.${CLAIM_RPC} as a client — the one privilege path the source scan admits it cannot model is then untested in both places`,
  );
  // The heading is the LAST `-- <number>.` line before the call. Searching for a
  // bare `\n-- ` instead finds the call's own line, because the call is itself a
  // `--` comment with leading spaces — which silently cut the heading, and its
  // `Expect 42501`, out of the block.
  const headings = [...probes.slice(0, at).matchAll(/\n-- \d/g)];
  assert.ok(
    headings.length > 0,
    `the ${CLAIM_RPC} probe must sit under a numbered heading, so a reader runs it in order`,
  );
  const headingStart = headings[headings.length - 1].index;

  // ⚠️ AND THE HEADING MUST BE THIS PROBE'S OWN. Taking the nearest preceding
  // heading is not enough: strip 2b's number and the search walks back to probe
  // 2, whose block carries its own `Expect 42501`, and the assertion below goes
  // vacuous again one level up. Mutation-tested — that version SURVIVED.
  // So: no other statement may sit between the heading and this call.
  const between = probes.slice(headingStart, at);
  assert.ok(
    !/^--\s+(?:select|insert|update|delete)\b/im.test(between),
    `the ${CLAIM_RPC} probe shares a numbered block with an earlier statement — it needs its own heading, or its expected result cannot be told apart from the other probe's`,
  );

  const after = [...probes.slice(at).matchAll(/\n-- \d/g)];
  const nextHeading = after.length ? at + after[0].index : probes.length;
  const block = probes.slice(headingStart, nextHeading);
  assert.ok(
    /42501/.test(block),
    `${hit.file}'s probe of ${CLAIM_RPC} must state the expected denial (42501) in its OWN block, not merely call the function`,
  );
  assert.ok(
    /00000000-0000-0000-0000-000000000000/.test(block),
    `the ${CLAIM_RPC} probe must use a nonexistent UUID, so that if EXECUTE is unexpectedly held it reveals the privilege without creating a claim — a probe for a suppression bug must not be able to suppress`,
  );
});
