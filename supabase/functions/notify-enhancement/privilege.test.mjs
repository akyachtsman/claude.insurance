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

test("every table access and RPC goes through the caller's client", () => {
  // Each `.from(` / `.rpc(` must be preceded by `caller`. Anything else — an
  // `admin`, an `authAdmin`, a fresh service-role client — is the defect.
  const accesses = [...code.matchAll(/([A-Za-z_$][\w$]*)\s*\n?\s*\.\s*(from|rpc)\(\s*["']([^"']+)["']/g)]
    .map((m) => ({ client: m[1], kind: m[2], target: m[3] }));

  assert.ok(accesses.length >= 4, `expected at least 4 table/RPC accesses, found ${accesses.length}`);

  const wrong = accesses.filter((a) => a.client !== "caller");
  assert.deepEqual(
    wrong, [],
    `these go through a client other than \`caller\`: ${wrong.map((w) => `${w.client}.${w.kind}("${w.target}")`).join(", ")}`,
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

test("the requested stamp goes through the RPC, not a direct update", () => {
  // There is no owner UPDATE policy on enhancement_requests, so an owner's
  // `.update({ requested_notified_at })` is refused by RLS — and a column grant
  // cannot express the narrow thing, because client/broker/underwriter are all
  // the `authenticated` role. See the migration for the rejected alternatives.
  assert.ok(
    /\.rpc\(\s*["']stamp_requested_notified["']/.test(code),
    "the requested-event stamp no longer calls stamp_requested_notified",
  );
  const directStamp = /\.update\(\s*\{[^}]*requested_notified_at/s.test(code);
  assert.equal(directStamp, false, "requested_notified_at is being written by a direct .update(), which RLS refuses");
});

test("every RPC the code calls is DEFINED IN SOURCE, and an unapplied one is declared as blocking", () => {
  // Cross-file drift gate, over SOURCE ONLY. The code and the migration are two
  // halves of one contract; renaming the function in one place would leave the
  // claim silently returning an error nobody reads.
  //
  // ⚠️ WHAT THIS DOES NOT PROVE, stated here because the test name used to
  // imply it did: that any migration is APPLIED. This reads directories. A file
  // placed in supabase/migrations/ whose remote apply was skipped or FAILED is
  // byte-identical to one that is live, so it classifies as applied, satisfies
  // the definition lookup, and skips the proposed/ blocker checks below — while
  // the deployed function returns `claim_failed` on every call. Codex round 7
  // on PR #256; the claim is narrowed rather than the check strengthened,
  // because strengthening it is not available here: a test that could tell
  // would need production credentials, and this repo's Safety Rules say test
  // commands must not require them. Directory placement is a CONVENTION this
  // repo declares (CLAUDE.md: "`supabase/migrations/` means live and matching
  // `list_migrations`"), not evidence.
  // The authoritative check is therefore a DEPLOY STEP, written into index.ts's
  // deploy header: run `list_migrations` and confirm the migration defining each
  // called RPC is there, before deploying. Fail-closed if it is not, which is
  // why a narrowed claim here is tolerable and a false one was not.
  //
  // ⚠️ `proposed/` IS SEARCHED TOO, AND THAT IS NOT A LOOSENING. This repo keeps
  // written-but-unapplied migrations in supabase/proposed/ precisely because
  // `migrations/` must mean "live" (see that directory's README). An RPC defined
  // only there is a REAL state — the code ships before the migration is
  // approved — and the honest check is not "does it exist in migrations" but
  // "is it defined, and if it is not applied, is that declared where an
  // operator will see it". So an unapplied RPC must be named in
  // proposed/README.md as blocking the deploy. That turns the coupling into
  // something enforced rather than a sentence in a PR thread.
  const root = join(here, "..", "..");
  const read = (dir) => readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: `${dir}/${f}`, sql: readFileSync(join(root, dir, f), "utf8") }));
  const applied = read("migrations");
  const proposed = read("proposed");
  const readme = readFileSync(join(root, "proposed", "README.md"), "utf8");

  const called = [...new Set([...code.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((m) => m[1]))];
  assert.ok(called.length > 0, "no rpc calls found — did the scan lose them?");

  for (const name of called) {
    const defRe = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$\\$\\s*;`, "i",
    );
    const hit = [...applied, ...proposed].find((m) => defRe.test(m.sql));
    assert.ok(hit, `index.ts calls rpc("${name}") but no migration defines public.${name}( ... $$;`);
    const body = hit.sql.match(defRe)[0];

    // ⚠️ SCOPED TO THIS FUNCTION'S OWN BODY, not the concatenated migrations.
    // The first version asserted /owner = auth.uid()/ against ALL migrations
    // joined together, and a mutation deleting the gate from THIS function
    // PASSED — a dozen unrelated RLS policies contain that string. An assertion
    // that cannot fail is not a check; found only by deleting the guard.
    assert.ok(
      /security\s+definer/i.test(body),
      `public.${name} must stay SECURITY DEFINER, or the narrowed privileges refuse every call`,
    );
    assert.ok(
      /set\s+search_path\s*=\s*''/.test(body),
      `public.${name} must pin search_path (advisor 0011, and SECURITY DEFINER hygiene)`,
    );
    // Each stamp function authorizes its own caller. The requested one gates on
    // ownership; the approved one on the underwriter role. Losing either makes
    // the function a hole with a narrow name.
    assert.ok(
      /owner\s*=\s*auth\.uid\(\)/.test(body) || /role\s*=\s*'underwriter'/.test(body),
      `public.${name} must authorize its caller (owner = auth.uid(), or the underwriter role)`,
    );
    assert.ok(
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^)]*\\)\\s+to\\s+authenticated`, "i").test(hit.sql),
      `public.${name} must be granted EXECUTE to authenticated, or the caller cannot stamp`,
    );
    assert.ok(
      !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^)]*\\)\\s+to\\s+[^;]*\\banon\\b`, "i").test(hit.sql),
      `public.${name} must not be granted EXECUTE to anon`,
    );

    if (hit.file.startsWith("proposed/")) {
      const base = hit.file.slice("proposed/".length);
      assert.ok(
        readme.includes(base),
        `public.${name} is defined only in ${hit.file}, which is NOT applied — so ${base} must be listed in proposed/README.md`,
      );
      assert.ok(
        /BLOCKS THE .*DEPLOY|blocking the deploy|blocks the deploy/i.test(readme),
        `${base} is unapplied and the code calls it; proposed/README.md must say it blocks the deploy`,
      );
    }
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
    claim: 'rpc("stamp_requested_notified"',
    refusal: "already_notified",
    // Literal fragments that must be PRESENT and positioned before the first
    // send. ⚠️ Presence of the refusal STRING is not enough: a mutation to
    // `if (false) {` left "already_notified" sitting in a dead block, still
    // before the sends, and the position-only assertion passed. These pin the
    // guard EXPRESSION, which a dead branch cannot satisfy.
    requires: ["if (!stamped)"],
  },
  {
    name: "approved",
    from: 'if (row.status !== "underwriting" && row.status !== "approved")',
    to: null, // to end of file
    claim: 'rpc("stamp_approved_notified"',
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
  // header — and a deploy step that does not list a newly added RPC is a step
  // that silently stops covering it. This is what keeps the two in sync: add an
  // `.rpc("x")` without naming x in the deploy header and this fails.
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

  const called = [...new Set([...code.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((m) => m[1]))];
  assert.ok(called.length > 0, "no rpc calls found — did the scan lose them?");
  for (const name of called) {
    assert.ok(
      header.includes(name),
      `index.ts calls rpc("${name}") but the deploy header does not name it, so the list_migrations step would miss it`,
    );
  }
  assert.ok(
    /list_migrations/.test(header),
    "the deploy header no longer names list_migrations, which is the only authoritative applied-migration check available here",
  );

  // ⚠️ AND THE RPC MIGRATIONS ARE NOT THE WHOLE DEPENDENCY. The notification
  // boundary is the PRIVILEGE NARROWING: without it the stamp functions are
  // decorative, because the same caller writes the columns directly. A skipped
  // apply there is WORSE than a skipped RPC migration — the RPC case is
  // fail-closed (the claim errors, nothing is sent), while a missing revoke
  // leaves a working function with no boundary. Codex #256 round 8; the
  // header's first version listed only the two RPC migrations.
  //
  // SET EQUALITY AGAINST A DERIVED SET, on ONE machine-readable line.
  // ⚠️ An earlier version asked `header.includes(version)` and a mutation
  // deleting 20261013014854 from the checklist SURVIVED, because the paragraph
  // explaining why it matters still named it. Same class as the two scans in
  // this file that matched a migration's own prose: an assertion over a wider
  // text than the property belongs to cannot fail. So the header carries a
  // single `CONFIRM APPLIED:` line and this compares that line, exactly.
  //
  // THE REQUIRED SET IS DERIVED IN TWO HOPS, never hand-maintained:
  //   1. every migration DEFINING an RPC this code calls;
  //   2. every migration that REVOKES on a table those RPCs TRUST — read out of
  //      each function's own body, not listed here.
  //
  // ⚠️ HOP 2 USED TO SAY "revokes on public.enhancement_requests", WHICH MISSED
  // A REAL DEPENDENCY. `stamp_approved_notified` authorizes its caller by
  // reading `public.profiles` for role = 'underwriter'. If
  // 20261005120100_profiles_role_not_self_assignable were skipped, the old
  // grants let any authenticated client UPDATE or INSERT their own
  // `profiles.role` — so a client makes themselves an underwriter, and both
  // this function and `er_underwriter_select` believe them: approval capability
  // and cross-client request access. A hard-coded table name could not see
  // that; the body scan can, because the trust is written in the SQL.
  // Codex #256 round 9.
  //
  // Equality, not containment — so a version left behind after its migration is
  // renamed or dropped fails too, the same inversion lesson as BACK_ELIGIBLE.
  // Comments are stripped before the revoke scan: this file has already been
  // bitten twice by a migration's prose documenting the statement it must not
  // contain. `on function` is excluded — an EXECUTE revoke is the functions'
  // own hygiene, not a table boundary.
  const migDir = join(here, "..", "..", "migrations");
  const migs = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, version: f.split("_")[0], sql: readFileSync(join(migDir, f), "utf8") }));

  const required = new Set();
  const trusted = new Set();
  for (const name of called) {
    const defRe = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$\\$\\s*;`, "i",
    );
    const hits = migs.filter((m) => defRe.test(m.sql));
    assert.ok(hits.length > 0, `no migration defines public.${name}, so nothing can be required for it`);
    for (const m of hits) {
      required.add(m.version);
      // Every public.<thing> the function body names, minus the RPCs
      // themselves, is a table it reads or writes — i.e. trusts.
      for (const t of m.sql.match(defRe)[0].matchAll(/public\.(\w+)/g)) {
        if (!called.includes(t[1])) trusted.add(t[1]);
      }
    }
  }
  assert.ok(trusted.size > 0, "no trusted tables derived from the RPC bodies — did the body scan lose them?");

  const revokers = migs.filter((m) => {
    const sql = m.sql.replace(/^\s*--.*$/gm, "");
    return [...sql.matchAll(/revoke\s+[a-z, ()\w]*?\s+on\s+(?:table\s+)?public\.(\w+)/gi)]
      .some((r) => trusted.has(r[1]));
  });
  assert.ok(
    revokers.length > 0,
    `no migration revokes on any of the tables these RPCs trust (${[...trusted].sort().join(", ")}) — the privilege narrowing that makes them a boundary is gone`,
  );
  for (const m of revokers) required.add(m.version);

  const line = header.split("\n").find((l) => l.includes("CONFIRM APPLIED:"));
  assert.ok(line, "the deploy header has no `CONFIRM APPLIED:` line, so nothing names the migrations to verify");
  const listed = new Set(line.slice(line.indexOf("CONFIRM APPLIED:")).match(/\d{14}/g) || []);
  assert.deepEqual(
    [...listed].sort(), [...required].sort(),
    "the deploy header's CONFIRM APPLIED list does not match the migrations this function actually depends on " +
    `(defining its RPCs, or revoking on a table those RPCs trust: ${[...trusted].sort().join(", ")}): ` +
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
    if (!/\bauthenticated\b/i.test(roles)) continue;
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
    out.push({ verb: verb.toLowerCase(), privs });
  }
  return out;
}

function carries(stmt, priv) {
  return stmt.privs.get(priv) ?? stmt.privs.get("all") ?? null;
}

test("every table these RPCs trust has its client write surface narrowed IN SOURCE", () => {
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

  const called = [...new Set([...code.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((m) => m[1]))];
  const trusted = new Set();
  for (const name of called) {
    const defRe = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$\\$\\s*;`, "i",
    );
    for (const m of migs.filter((x) => defRe.test(x.sql))) {
      for (const t of m.sql.match(defRe)[0].matchAll(/public\.(\w+)/g)) {
        if (!called.includes(t[1])) trusted.add(t[1]);
      }
    }
  }
  assert.ok(trusted.size > 0, "no trusted tables derived from the RPC bodies — did the body scan lose them?");

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
      let openedBy = null;
      let everRevoked = false;
      for (const m of migs) {
        for (const stmt of privilegeStatements(m.sql, table)) {
          const held = carries(stmt, priv);
          if (!held) continue;
          if (stmt.verb === "revoke") {
            if (!held.tableWide) continue;          // column-scoped: no effect on the table privilege
            everRevoked = true;
            openedBy = null;
          } else if (held.tableWide) openedBy = m.file;
        }
      }
      assert.ok(
        everRevoked,
        `no migration revokes table-wide ${priv.toUpperCase()} on public.${table} from authenticated — ` +
        `the stamp functions trust that table, so a client holding it writes the columns directly`,
      );
      assert.equal(
        openedBy, null,
        `${openedBy} grants table-wide ${priv.toUpperCase()} on public.${table} back to authenticated ` +
        `after the revoke, undoing the narrowing the stamp functions depend on`,
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
    { name: "requested", from: 'if (event === "requested")', claim: 'rpc("stamp_requested_notified"' },
    { name: "approved", from: 'if (row.status !== "underwriting"', claim: 'rpc("stamp_approved_notified"' },
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
    approved.indexOf("auth.admin.getUserById") < approved.indexOf('rpc("stamp_approved_notified"'),
    "the owner lookup must run BEFORE the claim, or a lookup failure burns a claim that can never be retaken",
  );
  assert.ok(
    /if \(ownerErr\) \{/.test(approved),
    "the approved branch no longer checks the getUserById error, so a transient failure reads as 'no email'",
  );

  // And the send-failure log must fire on EITHER failure. `!broker && !client`
  // let a successful broker send mask a failed client send, on a claim that
  // cannot be retaken.
  assert.ok(
    /if \(!brokerMail\.sent \|\| !clientMail\.sent\)/.test(code),
    "a branch logs only when BOTH sends fail, so a half-delivered notification is invisible",
  );
});
