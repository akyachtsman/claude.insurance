// nav.test.mjs — unit tests for the origin-aware navigation stack.
// Run: node --test js/nav.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createNavStack, createHistorySignal } from "./nav.js";

// Mirror what js/main.js passes. `link` is a fresh history entry (an in-app
// link or a load); `back` replays the id of an entry already stood on, which is
// what a browser Back/Forward looks like. `blind` is the unstampable context,
// where main.js can offer no signal at all.
let seq = 0;
const link = () => ({ id: `e${++seq}`, traversal: false });
const back = (sig) => ({ id: sig.id, traversal: true });
const blind = null;
// Walk a fresh path, returning each step's signal so a later test can traverse
// back to any of them by identity.
function walk(n, hashes) {
  return hashes.map((h) => { const s = link(); n.track(h, s); return s; });
}

test("forward navigation exposes the prior page as previous", () => {
  const n = createNavStack();
  n.track("#/keep/entities", link());
  assert.equal(n.previous(), null);            // at root
  n.track("#/keep/entity/jordan", link());
  assert.equal(n.previous(), "#/keep/entities");
  n.track("#/keep/asset/tesla", link());
  assert.equal(n.previous(), "#/keep/entity/jordan");
});

test("in-place re-render (same hash) does not change previous", () => {
  const n = createNavStack();
  n.track("#/keep/entity/jordan", link());
  const a = link();
  n.track("#/keep/asset/tesla", a);
  n.track("#/keep/asset/tesla", a);             // re-render, same entry
  assert.equal(n.previous(), "#/keep/entity/jordan");
  assert.equal(n.depth, 2);
});

test("back does NOT create a circular loop (the reported asset↔policy bug)", () => {
  const n = createNavStack();
  const [root, e, a] = walk(n, [
    "#/keep/entities", "#/keep/entity/jordan", "#/keep/asset/tesla", "#/keep/policy/auto",
  ]);
  assert.equal(n.previous(), "#/keep/asset/tesla");

  // Back: policy → asset. Asset's previous must be the ENTITY, not the policy.
  n.track("#/keep/asset/tesla", back(a));
  assert.equal(n.previous(), "#/keep/entity/jordan",
    "after backing out of the policy, the asset must not point back at the policy");

  // Back: asset → entity, then entity → entities, unwinding cleanly.
  n.track("#/keep/entity/jordan", back(e));
  assert.equal(n.previous(), "#/keep/entities");
  n.track("#/keep/entities", back(root));
  assert.equal(n.previous(), null);
  assert.equal(n.depth, 1);
});

test("deep-link / fresh load has no previous (caller uses its fallback)", () => {
  const n = createNavStack();
  n.track("#/keep/policy/auto", link());       // landed directly
  assert.equal(n.previous(), null);
});

// ── Regression: multi-step back (audit 2026-10-05) ──────────────────────────
// A held back button / history dropdown / history.go(-2) fires ONE hashchange
// for the final hash. Testing only stack[len-2] pushed a duplicate, and the
// back control then pointed FORWARD — the A↔B loop this module exists to stop.
test("a multi-step back unwinds the stack instead of pushing", () => {
  const n = createNavStack();
  const [a] = walk(n, ["#/a", "#/b", "#/c"]);
  n.track("#/a", back(a));       // browser Back, two steps
  assert.equal(n.depth, 1);
  assert.equal(n.previous(), null);
});

test("a back to a middle entry truncates to it", () => {
  const n = createNavStack();
  const [, b] = walk(n, ["#/a", "#/b", "#/c", "#/d"]);
  n.track("#/b", back(b));       // browser Back
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

test("repeated A<->B via Back does not grow the stack without bound", () => {
  const n = createNavStack();
  const a = link();
  n.track("#/a", a);
  for (let i = 0; i < 20; i++) { n.track("#/b", link()); n.track("#/a", back(a)); }
  assert.ok(n.depth <= 2, `stack grew to ${n.depth}`);
});

// ── Regression: forward links must NOT unwind (Codex P2, round 2) ──────────
test("a forward link to a route already deeper in the stack PUSHES", () => {
  const n = createNavStack();
  walk(n, ["#/keep/list", "#/keep/entity/1", "#/keep/asset/9", "#/keep/policy/7"]);
  n.track("#/keep/entity/1", link());          // breadcrumb click — a LINK
  assert.equal(n.depth, 5);
  assert.equal(n.previous(), "#/keep/policy/7",
    "entity's back must return to the policy the user actually came from");
});

test("the SAME hash unwinds when it is a history traversal", () => {
  const n = createNavStack();
  const [, e] = walk(n, ["#/keep/list", "#/keep/entity/1", "#/keep/asset/9", "#/keep/policy/7"]);
  n.track("#/keep/entity/1", back(e));         // browser Back
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/keep/list");
});

test("a traversal to an entry not in the stack pushes rather than losing it", () => {
  // Back past the start of this session's stack, or a Forward onto an entry the
  // previous unwind truncated away.
  const n = createNavStack();
  n.track("#/a", link());
  n.track("#/zz", { id: "never-seen", traversal: true });
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

// ── Regression: the single-step pop is not "unambiguous" (Codex P2, round 3) ─
test("a forward link to the entry just below the top PUSHES, not pops", () => {
  const n = createNavStack();
  walk(n, ["#/keep/entity/1", "#/keep/asset/9", "#/keep/policy/7"]);
  n.track("#/keep/asset/9", link());    // ASSET breadcrumb, clicked from the policy
  assert.equal(n.depth, 4);
  assert.equal(n.previous(), "#/keep/policy/7",
    "the asset's back must return to the policy the user came from, not the entity");
});

test("a single-step back pops when the signal says traversal", () => {
  const n = createNavStack();
  const [, b] = walk(n, ["#/a", "#/b", "#/c"]);
  n.track("#/b", back(b));              // browser Back, one step
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

// ── Regression: a hash is not an identity (Codex P2, round 4) ──────────────
// Resolving a traversal by HASH was correct until a hash appeared twice. After
// a→b→c and a click on b's breadcrumb the stack is [a,b,c,b]; Back to c
// truncated to [a,b,c], and Forward to the NEWER b then matched the OLDER b
// (lastIndexOf) and truncated to [a,b] — so b's back went to a, not the c the
// user came from. Entry identity is the only thing that settles it.
test("Forward onto a duplicated route keeps the origin of the NEWER entry", () => {
  const n = createNavStack();
  const [, , c] = walk(n, ["#/a", "#/b", "#/c"]);
  const b2 = link();
  n.track("#/b", b2);                   // b's breadcrumb, clicked from c
  assert.equal(n.previous(), "#/c");

  n.track("#/c", back(c));              // browser Back
  assert.equal(n.depth, 3);
  assert.equal(n.previous(), "#/b");

  n.track("#/b", back(b2));             // browser Forward, onto the NEWER b
  assert.equal(n.previous(), "#/c",
    "the newer b was reached from c, so its back must return to c");
  assert.equal(n.depth, 4);
});

test("Back onto the OLDER of two same-hash entries truncates to that one", () => {
  const n = createNavStack();
  const [, b1] = walk(n, ["#/a", "#/b", "#/c"]);
  n.track("#/b", link());               // [a,b,c,b]
  n.track("#/b", back(b1));             // Back all the way to the FIRST b
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a", "the original b was reached from a");
});

// ── The degradation path: no signal at all ─────────────────────────────────
test("no signal falls back to the pre-stamp single-step heuristic", () => {
  // Only reachable where history.replaceState throws, so main.js can never
  // stamp an entry and reports null rather than claiming "not a traversal".
  const n = createNavStack();
  ["#/a", "#/b", "#/c"].forEach((h) => n.track(h, blind));
  n.track("#/b", blind);
  assert.equal(n.depth, 2);
  assert.equal(n.previous(), "#/a");
});

test("with no signal a multi-step back still pushes rather than looping", () => {
  // Documents what the fallback costs: without a stamp there is no way to tell
  // a two-step Back from a link, so the stack grows. previous() must at least
  // not point FORWARD at the page just backed out of.
  const n = createNavStack();
  ["#/a", "#/b", "#/c"].forEach((h) => n.track(h, blind));
  n.track("#/a", blind);
  assert.equal(n.depth, 4);
  assert.equal(n.previous(), "#/c");
});

test("a stale stamp from a previous page load does not match a new entry", () => {
  // history.state survives a reload, so ids are prefixed per load in main.js.
  // A mismatched prefix must fail to match and push, never resolve to an
  // unrelated entry that happens to share a counter value.
  const n = createNavStack();
  n.track("#/a", { id: "load2:1", traversal: false });
  n.track("#/b", { id: "load2:2", traversal: false });
  n.track("#/c", { id: "load1:1", traversal: true });   // stale id from before
  assert.equal(n.depth, 3, "a stale id must not truncate the live stack");
  assert.equal(n.previous(), "#/b");
});

// ── Integration: the stamper and the stack, driven together ───────────────
// Every round of this bug was the two halves disagreeing — the stack was fine
// in isolation and so was the stamper. These tests drive the REAL
// createHistorySignal against a fake same-document history, so a future change
// to either half that breaks the pair fails here rather than in a browser.

function browser() {
  const entries = [];
  let cur = -1;
  let lastHash = null;
  const history = {
    get state() { return cur >= 0 ? entries[cur].state : null; },
    replaceState(st) { entries[cur].state = st; },
  };
  const navSignal = createHistorySignal(history, "load1");
  const nav = createNavStack();
  // Only a CHANGE of fragment fires hashchange, which is the sole event
  // js/main.js routes on — so a traversal between two entries sharing a hash
  // produces no route call. Modelled faithfully rather than assumed away.
  const fire = () => {
    const { hash } = entries[cur];
    if (hash === lastHash) return;
    lastHash = hash;
    nav.track(hash, navSignal());
  };
  return {
    nav,
    link(hash) {                       // in-app link: new entry, drops forward
      entries.length = cur + 1;
      entries.push({ hash, state: null });
      cur = entries.length - 1;
      fire();
    },
    back(n = 1) { cur = Math.max(0, cur - n); fire(); },
    forward(n = 1) { cur = Math.min(entries.length - 1, cur + n); fire(); },
  };
}

test("integration: Forward onto a duplicated route keeps the newer origin", () => {
  const b = browser();
  b.link("#/a"); b.link("#/b"); b.link("#/c");
  b.link("#/b");                                  // b's breadcrumb, from c
  assert.equal(b.nav.previous(), "#/c");
  b.back();
  assert.equal(b.nav.previous(), "#/b");
  b.forward();                                    // onto the NEWER b
  assert.equal(b.nav.previous(), "#/c",
    "the newer b was reached from c, so its back must return to c");
});

test("integration: a breadcrumb one level up keeps its origin", () => {
  const b = browser();
  b.link("#/entity"); b.link("#/asset"); b.link("#/policy");
  b.link("#/asset");                              // asset breadcrumb, from policy
  assert.equal(b.nav.previous(), "#/policy");
});

test("integration: a multi-step Back unwinds rather than pushing", () => {
  const b = browser();
  b.link("#/a"); b.link("#/b"); b.link("#/c");
  b.back(2);
  assert.equal(b.nav.depth, 1);
  assert.equal(b.nav.previous(), null);
});

test("integration: backing out of a policy does not loop (the original bug)", () => {
  const b = browser();
  b.link("#/entities"); b.link("#/entity"); b.link("#/asset"); b.link("#/policy");
  b.back();
  assert.equal(b.nav.previous(), "#/entity",
    "the asset must not point back at the policy just left");
});

test("integration: an unstampable history degrades instead of throwing", () => {
  const history = { get state() { return null; }, replaceState() { throw new Error("denied"); } };
  const navSignal = createHistorySignal(history, "load1");
  const nav = createNavStack();
  assert.equal(navSignal(), null, "a throwing replaceState reports NO signal");
  ["#/a", "#/b", "#/c"].forEach((h) => nav.track(h, navSignal()));
  nav.track("#/b", navSignal());          // single-step back, via the fallback
  assert.equal(nav.depth, 2);
  assert.equal(nav.previous(), "#/a");
});

test("integration: a stamped entry reads back as a traversal, a fresh one does not", () => {
  const entries = [{ state: null }];
  let cur = 0;
  const history = {
    get state() { return entries[cur].state; },
    replaceState(st) { entries[cur].state = st; },
  };
  const navSignal = createHistorySignal(history, "load1");
  const first = navSignal();
  assert.deepEqual(first, { id: "load1:1", traversal: false });
  assert.deepEqual(navSignal(), { id: "load1:1", traversal: true },
    "standing on a stamped entry again is a traversal");
  entries.push({ state: null }); cur = 1;        // a new entry
  assert.deepEqual(navSignal(), { id: "load1:2", traversal: false });
  cur = 0;                                        // Back to the first
  assert.deepEqual(navSignal(), { id: "load1:1", traversal: true });
});
