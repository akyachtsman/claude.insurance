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

test("usedRecords is sent as a list, which is what the consumer maps over", () => {
  assert.ok(/usedRecords:\s*facts\.map/.test(fnSrc),
    "usedRecords must be a list of display lines; a count cannot satisfy FR-11's 'name what you used'");
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
