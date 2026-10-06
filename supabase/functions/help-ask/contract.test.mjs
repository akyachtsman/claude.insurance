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
// asserts the consumer understands each one. Source-reading is deliberate: the
// function cannot be imported here (Deno-only `jsr:`/`npm:` specifiers), and a
// hand-kept list of reasons would be a third place to drift.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answerShape, FAILURE_NOTICE, ANSWER_REASONS } from "../../../js/keep/logic/help.js";

const here = dirname(fileURLToPath(import.meta.url));
const fnSrc = readFileSync(join(here, "index.ts"), "utf8");

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

test("retryAfter is sent in SECONDS, which is the unit the consumer reads", () => {
  // The bug this pins: `retryAfterMinutes: 60` would have rendered an hour's
  // wait as "try again in 60 seconds".
  assert.ok(!/retryAfterMinutes/.test(fnSrc), "retryAfterMinutes is the wrong key AND the wrong unit");
  const m = fnSrc.match(/retryAfter:\s*(\d+)/);
  assert.ok(m, "no numeric retryAfter found");
  assert.ok(Number(m[1]) >= 60, `retryAfter ${m[1]} looks like minutes, not seconds`);
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

test("nothing AFTER the model call releases the reservation", () => {
  // The mirror: past the billing line the call has been paid for, so the row
  // stays whatever comes back. A release here would hand back free retries on
  // exactly the failures a caller can provoke.
  const bill = fnSrc.indexOf("messages.create(");
  assert.ok(bill > 0, "could not locate the provider call");
  assert.ok(!/releaseAnd\(|help_queries"\)\s*\.delete\(/.test(fnSrc.slice(bill)),
    "the reservation is released after the model call — that call was billed");
});
