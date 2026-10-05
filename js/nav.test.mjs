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
  n.track("#/a");
  assert.equal(n.depth, 1);
  assert.equal(n.previous(), null);
});

test("a back to a middle entry truncates to it", () => {
  const n = createNavStack();
  ["#/a", "#/b", "#/c", "#/d"].forEach((h) => n.track(h));
  n.track("#/b");
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

test("repeated A->B->A->B does not grow the stack without bound", () => {
  const n = createNavStack();
  for (let i = 0; i < 20; i++) { n.track("#/a"); n.track("#/b"); }
  assert.ok(n.depth <= 2, `stack grew to ${n.depth}`);
});
