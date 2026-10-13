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
