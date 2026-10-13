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

test("the RPC the code calls exists in an applied migration, under that exact name", () => {
  // Cross-file drift gate. The code and the migration are two halves of one
  // contract; renaming the function in one place would leave the stamp silently
  // returning an error nobody reads.
  const migDir = join(here, "..", "..", "migrations");
  const sql = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(migDir, f), "utf8"))
    .join("\n");

  const called = [...code.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(called.length > 0, "no rpc calls found — did the scan lose them?");

  for (const name of called) {
    // ⚠️ SCOPED TO THIS FUNCTION'S OWN BODY, not the concatenated migrations.
    // The first version of this test asserted /owner = auth.uid()/ against ALL
    // migrations joined together, and a mutation deleting the gate from THIS
    // function PASSED — because a dozen unrelated RLS policies in this repo
    // contain that same string. An assertion that cannot fail is not a check;
    // it was found by deleting the guard and re-running, which is the only way
    // it ever gets found.
    const defRe = new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$\\$\\s*;`, "i",
    );
    const def = sql.match(defRe);
    assert.ok(def, `index.ts calls rpc("${name}") but no migration defines public.${name}( ... $$;`);
    const body = def[0];

    // The authorisation IS the WHERE clause on a SECURITY DEFINER function, so
    // its loss is the finding the migration names explicitly.
    assert.ok(
      /owner\s*=\s*auth\.uid\(\)/.test(body),
      `public.${name} must still gate on owner = auth.uid() inside its own body`,
    );
    assert.ok(
      /security\s+definer/i.test(body),
      `public.${name} must stay SECURITY DEFINER, or the missing owner UPDATE policy refuses every call`,
    );
    assert.ok(
      /set\s+search_path\s*=\s*''/.test(body),
      `public.${name} must pin search_path (advisor 0011, and SECURITY DEFINER hygiene)`,
    );
    assert.ok(
      new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^)]*\\)\\s+to\\s+authenticated`, "i").test(sql),
      `public.${name} must be granted EXECUTE to authenticated, or the owner cannot stamp`,
    );
    assert.ok(
      !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^)]*\\)\\s+to\\s+[^;]*\\banon\\b`, "i").test(sql),
      `public.${name} must not be granted EXECUTE to anon`,
    );
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
    claim: '.is("approved_notified_at", null)',
    refusal: "already_notified",
    // `.select(` is load-bearing, not style: without it PostgREST returns no
    // body, `claimed` is empty on success as well as on a lost race, and the
    // two become indistinguishable. A mutation deleting it survived the first
    // version of this test.
    requires: ['.select(', "if (!claimed || claimed.length === 0)"],
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
