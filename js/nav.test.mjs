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
  // Flags omitted: this is the no-signal fallback path. The flagged path is
  // covered by "the SAME hash unwinds when it is a history traversal" below.
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

// ── Regression: the single-step pop is not "unambiguous" (Codex P2, round 3) ─
// An earlier fix popped whenever the target was exactly stack[len-2], flag or
// no flag, reasoning that one step could only be a Back. It is also the
// commonest FORWARD navigation in this app: a breadcrumb one level up.
test("a forward link to the entry just below the top PUSHES, not pops", () => {
  const n = createNavStack();
  ["#/keep/entity/1", "#/keep/asset/9", "#/keep/policy/7"].forEach((h) => n.track(h, false));
  n.track("#/keep/asset/9", false);     // ASSET breadcrumb, clicked from the policy
  assert.equal(n.depth, 4);
  assert.equal(n.previous(), "#/keep/policy/7",
    "the asset's back must return to the policy the user came from, not the entity");
});

test("a single-step back pops when the flag says traversal", () => {
  const n = createNavStack();
  ["#/a", "#/b", "#/c"].forEach((h) => n.track(h, false));
  n.track("#/b", true);                 // browser Back, one step
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

test("no signal (null) falls back to the pre-flag single-step heuristic", () => {
  // The degradation path, and the ONLY place the heuristic still runs: in a
  // context where history.replaceState throws, main.js can never stamp an
  // entry, so it reports null — "cannot tell" — rather than claiming `false`.
  // Single-step Back must still work there rather than reinstating the
  // circular loop; breadcrumbs lose their origin, which is the lesser harm.
  for (const noSignal of [null, undefined]) {
    const n = createNavStack();
    ["#/a", "#/b", "#/c"].forEach((h) => n.track(h, noSignal));
    n.track("#/b", noSignal);
    assert.equal(n.depth, 2, `signal ${String(noSignal)}`);
    assert.equal(n.previous(), "#/a");
  }
});

test("with no signal a multi-step back still pushes rather than looping", () => {
  // Documents what the fallback costs: without a stamp there is no way to tell
  // a two-step Back from a link, so the stack grows. previous() must at least
  // not point FORWARD at the page just backed out of.
  const n = createNavStack();
  ["#/a", "#/b", "#/c"].forEach((h) => n.track(h, null));
  n.track("#/a", null);
  assert.equal(n.depth, 4);
  assert.equal(n.previous(), "#/c");
});
