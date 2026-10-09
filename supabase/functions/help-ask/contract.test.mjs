// contract.test.mjs — pins the help-ask wire format to what js/keep/logic/help.js
// actually consumes.
//
// WHY THIS FILE EXISTS. The function and the logic module are two halves of one
// contract, and in an earlier draft each was correct and tested in isolation
// while disagreeing about `retryAfter` (seconds vs minutes), `usedRecords` (a
// list vs a count) and every reason name. Nothing caught it, because nothing
// tested the PAIR. That is exactly how js/nav.js and its history stamper stayed
// broken through three correct-looking fixes on PR #251 — the lesson that PR
// paid four review rounds for.
//
// So this reads the function's SOURCE for the reason strings it can emit and
// asserts the consumer understands each one. A hand-kept list of reasons would be
// a third place to drift.
//
// ⚠️ The reason given here used to be "the function cannot be imported (Deno-only
// `jsr:`/`npm:` specifiers)". That stopped being true when the logic moved to
// handler.ts so it could be executed: handler.test.mjs imports it and runs it.
// `index.ts` still cannot be imported — it is the file holding the jsr/npm
// specifiers — but handler.ts can. What justifies a SOURCE scrape now is narrower
// and worth stating precisely: this asserts a property of the TEXT, namely the
// complete SET of reason strings the file can emit. Executing the handler proves
// the reasons it does emit on the paths a test drives; only reading it catches a
// reason added on a path no test reaches. The two are complements, and the
// executed test is the stronger of them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answerShape, FAILURE_NOTICE, ANSWER_REASONS } from "../../../js/keep/logic/help.js";

const here = dirname(fileURLToPath(import.meta.url));
// handler.ts, not index.ts: the logic moved there so it could be EXECUTED
// (see handler.test.mjs). A source scrape left pointing at the old file would
// still parse, still pass, and assert nothing — which is the failure mode this
// whole file exists to prevent, so the parse-health assertions below matter
// more than ever.
const fnSrc = readFileSync(join(here, "handler.ts"), "utf8");

// Every `unavailable("x")` the function can return.
const emitted = [...fnSrc.matchAll(/\bunavailable\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
// Every success `reason:` literal in the final json() payload. SHAPE-INDEPENDENT
// on purpose: the first version of this matched one exact ternary
// (`facts.length ? "a" : "b"`) and went silently empty the moment a third reason
// was added to it — so the only thing that noticed was the "did the parse break?"
// assertion below, which is the only reason this is not now a hole. A scraper
// that quietly finds nothing is worse than no scraper, because it reads green.
const payload = fnSrc.slice(fnSrc.lastIndexOf("return json({"));
const reasonAt = payload.indexOf("reason:");
const closeAt = payload.indexOf("\n  });", reasonAt);
const reasonExpr = reasonAt < 0 ? "" : payload.slice(reasonAt, closeAt < 0 ? undefined : closeAt);
const successReasons = [...reasonExpr.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

test("the function emits at least one failure reason and one success reason", () => {
  assert.ok(emitted.length > 0, "no unavailable() calls found — did the parse break?");
  assert.ok(reasonAt >= 0, "the final json() payload has no `reason:` property — did the parse break?");
  assert.ok(successReasons.length > 0,
    `no success reason found in ${JSON.stringify(reasonExpr.slice(0, 120))} — did the payload shape change?`);
});

// FR-8's hand-off exists in the view only because this reason can arrive. It was
// unreachable before the trailer shipped: the function never emitted `refused`,
// so `brokerHandoff` in help.js was dead code that read as a working feature.
test("the function can emit `refused`, which is what drives FR-8's broker hand-off", () => {
  assert.ok(successReasons.includes("refused"),
    `the payload cannot emit "refused" (found ${JSON.stringify(successReasons)}), so the view's broker hand-off is unreachable`);
});

test("every failure reason the function emits is one the consumer has a notice for", () => {
  const known = Object.keys(FAILURE_NOTICE);
  const unknown = [...new Set(emitted)].filter((r) => !known.includes(r));
  assert.deepEqual(unknown, [],
    `the function can emit ${JSON.stringify(unknown)}, which help.js has no notice for — ` +
    `add it to FAILURE_NOTICE or rename it to one of ${JSON.stringify(known)}`);
});

test("every success reason the function emits is one the consumer recognises", () => {
  const unknown = [...new Set(successReasons)].filter((r) => !ANSWER_REASONS.includes(r));
  assert.deepEqual(unknown, [],
    `the function can emit ${JSON.stringify(unknown)}, which is not in ANSWER_REASONS`);
});

test("retryAfter is sent in SECONDS, and is never a hardcoded literal", () => {
  // The bug the first half pins: `retryAfterMinutes: 60` would have rendered an
  // hour's wait as "try again in 60 seconds".
  assert.ok(!/retryAfterMinutes/.test(fnSrc), "retryAfterMinutes is the wrong key AND the wrong unit");

  // ⚠️ THE SECOND HALF IS INVERTED FROM WHAT IT USED TO BE, and the inversion is
  // the finding. It used to require a literal — `fnSrc.match(/retryAfter:\s*(\d+)/)`
  // with "no numeric retryAfter found" — and read the digits to check the unit.
  // Both caps now COMPUTE the wait from the rows that will survive the rejection,
  // so there is no literal left and that assertion became unsatisfiable: it could
  // only pass while the overstatement it was written beside was still there. Same
  // class as the `.k-help__out` assertion CLAUDE.md records — a check that fails
  // when the code gets better is not a check.
  // A literal cannot be right here: both windows are ROLLING, so any constant is
  // a promise the endpoint cannot keep (the hourly branch sent a flat 3600 for
  // five rounds). The UNIT is pinned where it can be: handler.test.mjs executes
  // the function and asserts the actual seconds — 5 for the grace case, ~600 and
  // ~1800 for the settled ones.
  const literal = fnSrc.match(/retryAfter:\s*(\d+)/);
  assert.equal(literal, null,
    `retryAfter is hardcoded as ${literal && literal[1]} — both cap windows roll, so a constant is a wait the endpoint cannot honour`);
  assert.ok(/retryAfterFor\(/.test(fnSrc), "the wait is no longer computed by retryAfterFor()");
  assert.ok(/Math\.ceil\(GRACE_MS \/ 1000\)/.test(fnSrc),
    "the grace-case wait is not converted to seconds");
});

test("usedRecords is sent as a list of the records actually used, not all of them", () => {
  // TWO bugs, and this assertion used to pin the second one as correct. The
  // first is real: `retryAfterMinutes`-style, a COUNT cannot satisfy FR-11's
  // "name what you drew on" because "3 records" is not checkable — the consumer
  // maps over this. The second is that the fix for it sent `facts.map(...)`,
  // every record on file, on every answer. That is the same defect already found
  // and fixed for `usedTopics`, and this test asserted the exact expression that
  // caused it, so fixing the function would have failed a test whose message
  // said the fix was wrong.
  assert.ok(!/usedRecords:\s*\w+\.length/.test(fnSrc), "usedRecords must not be a count");
  assert.ok(!/usedRecords:\s*facts\.map/.test(fnSrc),
    "usedRecords: facts.map(...) credits EVERY record on every answer — the usedTopics defect, in the half that was left behind");
  assert.ok(/recordIds[\s\S]{0,400}?recordIndex\(/.test(fnSrc),
    "usedRecords must be resolved from the model's record tags via recordIndex(), the way usedTopics is resolved from its ids");
});

test("a rate_limited payload shaped as the function sends it yields a usable wait", () => {
  const shaped = answerShape({ answer: null, reason: "rate_limited", retryAfter: 3600 });
  assert.equal(shaped.ok, false);
  assert.equal(shaped.reason, "rate_limited");
  assert.equal(shaped.retryAfter, 3600);
  assert.ok(shaped.notice.length > 0);
});

test("a success payload shaped as the function sends it keeps its records and topics", () => {
  const shaped = answerShape({
    answer: "Your auto policy renews on 12 March.",
    usedTopics: ["insurance"],
    usedRecords: ["Personal auto — renews: 12 March 2027"],
    reason: "answered",
  });
  assert.equal(shaped.ok, true);
  assert.deepEqual(shaped.topics, ["insurance"]);
  assert.deepEqual(shaped.records, ["Personal auto — renews: 12 March 2027"]);
  assert.equal(shaped.answer, "Your auto policy renews on 12 March.");
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BILLING LINE. Between reserving the throttle slot and calling the model,
// nothing has been billed, so every exit must release the reservation — or a
// transient corpus/database failure eats the caller's hourly allowance AND the
// shared daily one, and the feature stays rate-limited after its dependency
// recovers. Two of the four pre-provider exits did not release; Codex found one.
//
// Asserted structurally rather than by eye: every such exit goes through
// `releaseAnd`, so a bare `unavailable(` in that region is the defect itself.
// ─────────────────────────────────────────────────────────────────────────────
test("every exit between reserving the slot and calling the model releases the reservation", () => {
  // The region runs from where the helper is DEFINED (which is where a slot
  // exists to release) to the provider call. The exit just above it —
  // `if (slotErr || !slot)` — is deliberately outside: the reservation itself
  // failed there, so there is nothing to give back.
  const helperAt = fnSrc.indexOf("const releaseAnd");
  const bill = fnSrc.indexOf("messages.create(");
  assert.ok(helperAt > 0, "releaseAnd is gone — the release rule has no single place to live");
  assert.ok(bill > helperAt, "could not locate the provider call after the helper — did the parse break?");

  // The helper's own body legitimately calls unavailable(); everything else must
  // go through the helper.
  const helperEnd = fnSrc.indexOf("};", helperAt) + 2;
  const checked = fnSrc.slice(helperEnd, bill);

  const bare = [...checked.matchAll(/return\s+unavailable\(\s*"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(bare, [],
    `these pre-provider exits return without releasing the reservation: ${JSON.stringify(bare)} — ` +
    `use releaseAnd(...) instead, or the caller pays an hour of quota for a failure that cost nothing`);

  assert.ok(/releaseAnd\(/.test(checked), "nothing in the region calls releaseAnd — did the parse break?");
});

test("past the model call, ONLY a provider HTTP error releases the reservation", () => {
  // This test used to say "nothing after the model call releases", which was too
  // coarse and asserted a wrong rule as if it were right. The line is not the
  // call, it is whether the provider BILLED:
  //
  //   · an HTTP-status error (bad key, unknown model, exhausted credit, 429,
  //     529) is a REJECTED request — no tokens, no charge — so the reservation
  //     goes back, or the caller pays an hour of quota for the provider's
  //     refusal, and 400 such failures take the desk down for everyone;
  //   · a connection error or timeout carries no status, and the request may
  //     have been served with the response lost, so billing is UNKNOWN and the
  //     row stays;
  //   · max_tokens, a refusal, an empty answer and a trailer-only reply all
  //     produced output. Billed. The row stays.
  const bill = fnSrc.indexOf("messages.create(");
  assert.ok(bill > 0, "could not locate the provider call");
  const after = fnSrc.slice(bill);

  const releases = [...after.matchAll(/releaseAnd\(/g)];
  assert.equal(releases.length, 1, `expected exactly one post-call release, found ${releases.length}`);

  // It must be the status-guarded one, not just any release that happens to sit
  // in the catch.
  const guard = after.slice(0, releases[0].index);
  assert.ok(/status[\s\S]{0,200}typeof status === "number"/.test(guard),
    "the post-call release is not guarded by a provider HTTP status — a billed failure would refund quota");

  // The three BILLED outcomes must each still return without releasing.
  for (const path of [/stop_reason[\s\S]{0,120}?return (\w+)\("incomplete"/,
                      /if \(!answer\) return (\w+)\("incomplete"/,
                      /if \(!split\.answer\) return (\w+)\("incomplete"/]) {
    const m = path.exec(after);
    assert.ok(m, `could not locate a billed-outcome exit (${path}) — did the parse break?`);
    assert.equal(m[1], "unavailable",
      `a billed outcome returns via ${m[1]}(...) — output was generated, so the reservation must stand`);
  }

  // And no raw delete sneaking past the helper.
  assert.ok(!/help_queries"\)\s*\.delete\(/.test(after),
    "a raw delete after the model call bypasses the one place this rule is stated");
});

test("the daily cap derives its retryAfter instead of reusing the hourly 3600", () => {
  // An hour is an UPPER bound for the hourly window, so 3600 there is
  // conservative and never a false promise. On the rolling 24-hour window it is
  // the opposite: 400 calls in the last hour means the cap holds for nearly
  // another 23, and "try again in an hour" is a promise the endpoint cannot keep.
  const at = fnSrc.indexOf("DAILY_TOTAL_CAP) {");
  assert.ok(at > 0, "could not locate the daily-cap branch — did the parse break?");
  const branch = fnSrc.slice(at, fnSrc.indexOf("\n  }", at));
  assert.ok(!/retryAfter:\s*3600/.test(branch),
    "the daily cap reports the hourly 3600, which under-states a 24-hour window");
  assert.ok(/86_400_000|86400000/.test(branch),
    "the daily cap does not derive its wait from the 24-hour window");
  assert.ok(/retryAfter \?/.test(branch),
    "the daily cap must omit retryAfter when it cannot be derived — a wrong number is worse than none");
});

// ─────────────────────────────────────────────────────────────────────────────
// index.ts — THE ONE FILE NOTHING CAN EXECUTE, so the only gate it can have is
// a source scrape. It imports `jsr:` and `npm:` specifiers, so `node --test`
// cannot load it, and handler.test.mjs injects fakes for everything it wires.
// Review round 5 measured the consequence: reverting `maxRetries` to 1, deleting
// the corpus-fetch timeout, and un-pinning the supabase-js import EACH passed
// the entire suite. Every invariant below is one a previous round established at
// cost; a scrape is weak, but a weak gate on an unexecutable file beats none.
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ CODE ONLY. The first version of these tests scanned the raw file and the
// blanket `maxRetries: [1-9]` assertion matched the COMMENT that explains why
// `maxRetries: 1` was wrong — a scrape tripping over its own documentation. Any
// source scrape that asserts the ABSENCE of a pattern has to ignore comments, or
// writing down the defect reintroduces it. (schema.test.mjs carries the same
// helper for the same reason; duplicated rather than shared because these two
// files have no module between them and a third file in this directory would
// need its own manifest story.)
//
// ⚠️ KNOWN LIMIT: a REGEX LITERAL containing `/*` — e.g. `.replace(/\/*$/, "")`,
// a plausible trailing-slash trim — opens a block comment that runs to end of
// file, because this does not track regex-literal context (telling `/` as
// division from `/` as a regex start needs real lexing). It FAILS CLOSED: three
// of the index.ts scrapes then fail on correct code, with messages naming the
// wrong cause ("the Anthropic client must be built with maxRetries: 0"). If that
// happens, the scrape is wrong, not the code. Measured by review round 6; a lone
// quote or backtick inside a regex literal was tried and does not break it.
function codeOnly(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
const idxSrc = codeOnly(readFileSync(join(here, "index.ts"), "utf8"));

test("index.ts: one reservation buys exactly one provider call", () => {
  // maxRetries: 1 sent two billable generations against one reserved row, so the
  // throttle undercounted spend by up to 2x — the bypass the reservation exists
  // to prevent. It also doubled the worst case to ~121s against a 150s limit.
  assert.match(idxSrc, /new Anthropic\(\{[^}]*maxRetries:\s*0\b/,
    "the Anthropic client must be built with maxRetries: 0");
  assert.ok(!/maxRetries:\s*[1-9]/.test(idxSrc), "a non-zero maxRetries reintroduces the double-spend");
});

test("index.ts: the corpus fetch is bounded", () => {
  // This fetch runs AFTER the throttle row is inserted. A hung Pages response
  // held that reservation until the 150s platform timeout with nothing to
  // release it — pure loss to the client, since nothing was billed.
  assert.match(idxSrc, /help-guide\.json[\s\S]{0,400}?AbortSignal\.timeout\(/,
    "the corpus fetch must carry an AbortSignal.timeout");
});

test("index.ts: server dependencies are pinned, not floating", () => {
  // The file argues this itself four lines above the import, and the Anthropic
  // SDK beside it was already pinned while supabase-js was `@2`.
  //
  // ⚠️ THE FIRST VERSION OF THIS TEST WAS VACUOUS IN THREE WAYS. It matched
  // `from\s+"(jsr|npm):(@[^"]+)"` — double quotes only, a `from` clause only, and
  // a SCOPED package only — so it examined ZERO specifiers against single quotes
  // (`'jsr:@supabase/supabase-js@2'`), an unscoped package (`npm:dayjs`) or a
  // side-effect import (`import "jsr:@std/dotenv/load"`). Converting the two real
  // imports to single quotes with `@2` — the exact mutation this test was written
  // to catch — left it green, with nothing examined and nothing asserted.
  // Measured. So: every quoting style, with or without `from`, scoped or not, AND
  // a non-vacuity floor, because a scrape that matches nothing passes.
  const specs = [...idxSrc.matchAll(/(?:from\s*)?["'`](jsr|npm):([^"'`]+)["'`]/g)]
    .map(([, reg, spec]) => `${reg}:${spec}`);
  assert.ok(specs.length >= 3,
    `only ${specs.length} jsr:/npm: specifiers found — this scrape has gone vacuous: ${JSON.stringify(specs)}`);

  // A bare type/side-effect import of edge-runtime.d.ts is exempt: it carries no
  // code, and the deployed notify-enhancement has the identical line, so pinning
  // it here would diverge from the function that already works. deno lint still
  // reports it, which is the honest place for it.
  const floating = specs.filter((s) =>
    !/@\d+\.\d+\.\d+/.test(s) && !s.includes("functions-js/edge-runtime"));
  assert.deepEqual(floating, [],
    `unpinned server dependency specifier(s): ${JSON.stringify(floating)}`);
});

test("index.ts: hasKeys is decided before any client is constructed", () => {
  // handler.ts documents hasKeys as "checked before anything else". It was not:
  // `admin: createClient(...)` evaluated as an argument, so an empty URL or
  // service key threw inside createClient and the caller got a bare 500 with no
  // CORS headers, no JSON body and no `where` log line — instead of FR-17's one
  // quiet notice, and with nothing for owner-gate step 8 to read.
  const hasKeysAt = idxSrc.search(/const HAS_KEYS\s*=/);
  assert.ok(hasKeysAt > 0, "HAS_KEYS must be computed at module scope");
  const serveAt = idxSrc.search(/Deno\.serve\(/);
  assert.ok(hasKeysAt < serveAt, "HAS_KEYS must be computed before Deno.serve");
  // ⚠️ NO createClient MAY BE CALLED OUTSIDE THE HAS_KEYS GUARD AT ALL. The first
  // version of this assertion only rejected the literal text `admin: createClient(`,
  // so three rewrites restored the original 500 with the suite green: an
  // unguarded module-scope `const adminClient = createClient(...)`, an IIFE in the
  // deps literal, and `const HAS_KEYS = true`. Measured by executing each one.
  // So: every createClient call site must sit on a line that mentions HAS_KEYS,
  // and HAS_KEYS must be derived from the secrets rather than written.
  assert.match(idxSrc, /const HAS_KEYS\s*=\s*Boolean\(/,
    "HAS_KEYS must be derived from the secrets with Boolean(...), not assigned a literal");
  // ⚠️ THE EXACT SHAPE, not a proximity test — and this is the SECOND time this
  // assertion was too weak. A per-line check reported both real call sites as
  // unguarded (each spans lines). A 240-char preceding-context window then let two
  // of the three known defeats straight through, because `const HAS_KEYS =
  // Boolean(...)` sits directly above the admin client, so the window found the
  // string "HAS_KEYS" and called an UNGUARDED call guarded. Proximity to a
  // declaration is not a guard. Both measured.
  //
  // So this pins the shape that is known safe and fails on any deviation. That is
  // deliberately brittle: a refactor here must re-establish the property on
  // purpose rather than inherit a pass. The file cannot be executed under
  // `node --test`, so shape is all a gate can check.
  const sites = [...idxSrc.matchAll(/\bcreateClient\(/g)].map((m) => m.index);
  assert.equal(sites.length, 2,
    `expected exactly 2 createClient call sites (the guarded admin client and the per-request ` +
    `callerClient), found ${sites.length} — a new one needs its own guard and its own line here`);

  // 1. The admin client is the true branch of a HAS_KEYS ternary, and nothing else.
  assert.match(idxSrc, /const adminClient\s*=\s*HAS_KEYS\s*\?\s*createClient\(/,
    "adminClient must be the true branch of a HAS_KEYS ternary — an unguarded " +
    "`const adminClient = createClient(...)` throws on a blank key before handle() runs");

  // 2. Nothing constructs a client inside the deps literal. An IIFE there restores
  //    the original bare-500 defect byte for byte while every text match still holds.
  const depsBlock = idxSrc.slice(idxSrc.search(/Deno\.serve\(/));
  assert.ok(!/createClient\(/.test(depsBlock),
    "no createClient may appear after Deno.serve( — arguments are evaluated before handle() " +
    "can reach its hasKeys check, which is the whole defect");

  // 3. The deps literal uses the guarded binding by name.
  assert.match(depsBlock, /admin:\s*adminClient\b/, "deps.admin must reference the guarded binding");
});
