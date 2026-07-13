// Tests for keep/relmap.js — run: node --test js/keep/relmap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { capTablesByEntity, controlsByEntity, fitPlan, orchestrate } from "./relmap.js";

// A small graph mirroring the demo shape: a 3-owner company plus a trustee link
// (no stake) and an ownership chain.
const NODES = [
  { id: "me" }, { id: "spouse" }, { id: "trustA" }, { id: "cafe" }, { id: "sub1" }, { id: "sub2" },
];
const EDGES = [
  { from: "me", to: "cafe", role: "Managing member", stake: "50%" },
  { from: "spouse", to: "cafe", role: "Member", stake: "40%" },
  { from: "trustA", to: "cafe", role: "Holds", stake: "10%" },
  { from: "me", to: "trustA", role: "Trustee", stake: "" },      // control only, no stake
  { from: "cafe", to: "sub1", role: "Owner", stake: "100%" },
  { from: "sub1", to: "sub2", role: "Owner", stake: "100%" },
];

test("capTablesByEntity groups stakes on the owned entity and skips no-stake links", () => {
  const caps = capTablesByEntity(EDGES);
  assert.equal(caps.cafe.length, 3);
  assert.deepEqual(caps.cafe.map((c) => c.pct).sort((a, b) => b - a), [50, 40, 10]);
  const total = caps.cafe.reduce((s, c) => s + c.pct, 0);
  assert.equal(total, 100);
  // trustA is a trustee target with no stake → no cap-table entry
  assert.equal(caps.trustA, undefined);
});

test("capTablesByEntity ties each stake to its owner", () => {
  const caps = capTablesByEntity(EDGES);
  const byOwner = Object.fromEntries(caps.cafe.map((c) => [c.ownerId, c.pct]));
  assert.deepEqual(byOwner, { me: 50, spouse: 40, trustA: 10 });
});

test("orchestrate inserts a dummy waypoint for an edge that spans a layer", () => {
  // u(0) -> v(1) -> w(2), plus a long edge u -> w that skips layer 1
  const ns = [{ id: "u" }, { id: "v" }, { id: "w" }];
  const es = [
    { from: "u", to: "v", stake: "100%" },
    { from: "v", to: "w", stake: "100%" },
    { from: "u", to: "w", stake: "50%" },
  ];
  const { edgePath, dummy, layerOf } = orchestrate(ns, es);
  assert.equal(layerOf.w, 2);
  const path = edgePath["u>w"];
  assert.equal(Array.isArray(path) && path.length, 1);         // one dummy in the middle layer
  assert.equal(dummy[path[0]], 1);                             // sits in layer 1
});

test("orchestrate leaves adjacent-layer edges without dummies", () => {
  const { edgePath, dummy } = orchestrate(
    [{ id: "a" }, { id: "b" }],
    [{ from: "a", to: "b", stake: "100%" }],
  );
  assert.deepEqual(edgePath, {});
  assert.deepEqual(dummy, {});
});

test("orchestrate accepts a band override and routes across the given bands", () => {
  // p(band 0) owns c(band 2); band 1 sits between them → one dummy in band 1,
  // even though no edge touches band 1 (mirrors a person→business link with a
  // trust band between them in the by-type view).
  const ns = [{ id: "p" }, { id: "t" }, { id: "c" }];
  const es = [{ from: "p", to: "c", stake: "100%" }];
  const band = { p: 0, t: 1, c: 2 };
  const { edgePath, dummy, layerOf } = orchestrate(ns, es, (n) => band[n.id]);
  assert.equal(layerOf.p, 0);
  assert.equal(layerOf.c, 2);
  const path = edgePath["p>c"];
  assert.equal(Array.isArray(path) && path.length, 1);
  assert.equal(dummy[path[0]], 1);
});

test("orchestrate with a band override handles a reverse-direction edge", () => {
  // owner in a LATER band than the target (a business owning a trust): still gets
  // a dummy through the intervening band, with the chain kept in from→to order.
  const band = { biz: 2, mid: 1, tr: 0 };
  const { edgePath, dummy } = orchestrate(
    [{ id: "biz" }, { id: "mid" }, { id: "tr" }],
    [{ from: "biz", to: "tr", stake: "100%" }],
    (n) => band[n.id],
  );
  const path = edgePath["biz>tr"];
  assert.equal(Array.isArray(path) && path.length, 1);
  assert.equal(dummy[path[0]], 1);
});

test("orchestrate with a band override leaves same-band edges direct", () => {
  const band = { a: 2, b: 2 };
  const { edgePath, dummy } = orchestrate(
    [{ id: "a" }, { id: "b" }],
    [{ from: "a", to: "b", stake: "100%" }],
    (n) => band[n.id],
  );
  assert.deepEqual(edgePath, {});
  assert.deepEqual(dummy, {});
});

test("orchestrate is deterministic", () => {
  const ns = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const es = [{ from: "a", to: "c", stake: "50%" }, { from: "b", to: "c", stake: "50%" }, { from: "c", to: "d", stake: "100%" }];
  assert.deepEqual(orchestrate(ns, es).rows, orchestrate(ns, es).rows);
});

test("fitPlan fits when boxes stay above the minimum", () => {
  // 3 boxes of 200 across a 900px container → ~ fits, node >> 150
  const plan = fitPlan({ contentW: 700, containerW: 900, nodeW: 200, minNodePx: 150 });
  assert.equal(plan.mode, "fit");
});

test("fitPlan pans once boxes would drop below the minimum", () => {
  // very wide content in a narrow container → node would be tiny → pan
  const plan = fitPlan({ contentW: 2000, containerW: 380, nodeW: 200, minNodePx: 150 });
  assert.equal(plan.mode, "pan");
  // render width holds nodes at exactly the floor: 2000 * (150/200) = 1500
  assert.equal(plan.renderW, 1500);
});

test("fitPlan is safe with no container width", () => {
  const plan = fitPlan({ contentW: 700, containerW: 0, nodeW: 200, minNodePx: 150 });
  assert.equal(plan.mode, "fit");
  assert.equal(plan.renderW, 700);
});

test("fitPlan is safe with zero content width", () => {
  const plan = fitPlan({ contentW: 0, containerW: 900, nodeW: 200, minNodePx: 150 });
  assert.equal(plan.mode, "fit");
});

test("capTablesByEntity returns an empty object for no edges", () => {
  assert.deepEqual(capTablesByEntity([]), {});
});

test("controlsByEntity groups no-stake role links on the controlled entity", () => {
  const ctrls = controlsByEntity(EDGES);
  // trustA is controlled by me as Trustee, with no stake
  assert.deepEqual(ctrls.trustA, [{ ownerId: "me", role: "Trustee" }]);
  // cafe is owned by stakes only → no control-only entry
  assert.equal(ctrls.cafe, undefined);
});

test("controlsByEntity ignores stake links and role-less links", () => {
  const ctrls = controlsByEntity([
    { from: "a", to: "b", role: "Member", stake: "50%" },   // has a stake → not control-only
    { from: "c", to: "d", role: "", stake: "" },             // no role → skipped
    { from: "e", to: "f", role: "Manager", stake: "" },      // control-only → kept
  ]);
  assert.deepEqual(ctrls, { f: [{ ownerId: "e", role: "Manager" }] });
});
