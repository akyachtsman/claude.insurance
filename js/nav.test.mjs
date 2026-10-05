// nav.test.mjs — unit tests for the origin-aware navigation stack.
// Run: node --test js/nav.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createNavStack } from "./nav.js";

test("forward navigation exposes the prior page as previous", () => {
  const n = createNavStack();
  n.track("#/keep/entities");
  assert.equal(n.previous(), null);            // at root
  n.track("#/keep/entity/jordan");
  assert.equal(n.previous(), "#/keep/entities");
  n.track("#/keep/asset/tesla");
  assert.equal(n.previous(), "#/keep/entity/jordan");
});

test("in-place re-render (same hash) does not change previous", () => {
  const n = createNavStack();
  n.track("#/keep/entity/jordan");
  n.track("#/keep/asset/tesla");
  n.track("#/keep/asset/tesla");               // re-render
  assert.equal(n.previous(), "#/keep/entity/jordan");
  assert.equal(n.depth, 2);
});

test("back does NOT create a circular loop (the reported asset↔policy bug)", () => {
  const n = createNavStack();
  n.track("#/keep/entities");
  n.track("#/keep/entity/jordan");
  n.track("#/keep/asset/tesla");
  n.track("#/keep/policy/auto");
  assert.equal(n.previous(), "#/keep/asset/tesla");

  // Back: policy → asset. Asset's previous must be the ENTITY, not the policy.
  n.track("#/keep/asset/tesla");
  assert.equal(n.previous(), "#/keep/entity/jordan",
    "after backing out of the policy, the asset must not point back at the policy");

  // Back: asset → entity, then entity → entities, unwinding cleanly.
  n.track("#/keep/entity/jordan");
  assert.equal(n.previous(), "#/keep/entities");
  n.track("#/keep/entities");
  assert.equal(n.previous(), null);
  assert.equal(n.depth, 1);
});

test("deep-link / fresh load has no previous (caller uses its fallback)", () => {
  const n = createNavStack();
  n.track("#/keep/policy/auto");               // landed directly
  assert.equal(n.previous(), null);
});

// ── Regression: multi-step back (audit 2026-10-05) ──────────────────────────
// A held back button / history dropdown / history.go(-2) fires ONE hashchange
// for the final hash. Testing only stack[len-2] pushed a duplicate, and the
// back control then pointed FORWARD — the A↔B loop this module exists to stop.
test("a multi-step back unwinds the stack instead of pushing", () => {
  const n = createNavStack();
  ["#/a", "#/b", "#/c"].forEach((h) => n.track(h));
  n.track("#/a", true);          // browser Back, two steps
  assert.equal(n.depth, 1);
  assert.equal(n.previous(), null);
});

test("a back to a middle entry truncates to it", () => {
  const n = createNavStack();
  ["#/a", "#/b", "#/c", "#/d"].forEach((h) => n.track(h));
  n.track("#/b", true);          // browser Back
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

test("repeated A<->B via Back does not grow the stack without bound", () => {
  const n = createNavStack();
  for (let i = 0; i < 20; i++) { n.track("#/b"); n.track("#/a", true); }
  assert.ok(n.depth <= 2, `stack grew to ${n.depth}`);
});

// ── Regression: forward links must NOT unwind (Codex P2, 2026-10-05) ───────
// Deciding from the hash alone is wrong in both directions. Unwinding to any
// existing entry broke breadcrumbs: this app builds them, so it is the common
// case. The caller now passes whether the event was a history traversal.
test("a forward link to a route already deeper in the stack PUSHES", () => {
  const n = createNavStack();
  ["#/keep/list", "#/keep/entity/1", "#/keep/asset/9", "#/keep/policy/7"].forEach((h) => n.track(h));
  n.track("#/keep/entity/1");          // breadcrumb click — a LINK, not Back
  assert.equal(n.depth, 5);
  assert.equal(n.previous(), "#/keep/policy/7",
    "entity's back must return to the policy the user actually came from");
});

test("the SAME hash unwinds when it is a history traversal", () => {
  const n = createNavStack();
  ["#/keep/list", "#/keep/entity/1", "#/keep/asset/9", "#/keep/policy/7"].forEach((h) => n.track(h));
  n.track("#/keep/entity/1", true);    // browser Back
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/keep/list");
});

test("a traversal to a hash not in the stack pushes rather than losing it", () => {
  // Back past the start of this session's stack, or a Forward onto a route the
  // previous unwind truncated away.
  const n = createNavStack();
  n.track("#/a");
  n.track("#/zz", true);
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

test("an in-place re-render is still a no-op either way", () => {
  const n = createNavStack();
  n.track("#/a"); n.track("#/a"); n.track("#/a", true);
  assert.equal(n.depth, 1);
});

test("a single-step back still pops when no traversal flag is supplied", () => {
  // The degradation path: in a context where history.replaceState throws,
  // main.js can never stamp an entry, so every navigation arrives as
  // non-traversal. The common case must still work rather than reinstating the
  // circular loop — which is why the single-step pop is not gated on the flag.
  const n = createNavStack();
  ["#/a", "#/b", "#/c"].forEach((h) => n.track(h));
  n.track("#/b");                       // no flag — unstampable context
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});
