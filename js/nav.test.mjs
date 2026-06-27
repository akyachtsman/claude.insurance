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
