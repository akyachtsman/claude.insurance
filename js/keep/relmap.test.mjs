// Tests for keep/relmap.js — run: node --test js/keep/relmap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { capTablesByEntity, layeredLayout, fitPlan } from "./relmap.js";

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

test("layeredLayout places owners above what they own (longest-path layers)", () => {
  const { layerOf } = layeredLayout(NODES, EDGES);
  assert.equal(layerOf.me, 0);
  assert.equal(layerOf.spouse, 0);
  assert.equal(layerOf.trustA, 1);          // owned by me
  assert.equal(layerOf.cafe, 2);            // deepest owner is trustA (layer 1)
  assert.equal(layerOf.sub1, 3);
  assert.equal(layerOf.sub2, 4);
});

test("layeredLayout groups every node into exactly one row", () => {
  const { order, rows } = layeredLayout(NODES, EDGES);
  const all = order.flatMap((r) => rows[r]);
  assert.equal(all.length, NODES.length);
  assert.deepEqual([...all].sort(), NODES.map((n) => n.id).sort());
});

test("layeredLayout is deterministic", () => {
  const a = layeredLayout(NODES, EDGES);
  const b = layeredLayout(NODES, EDGES);
  assert.deepEqual(a.rows, b.rows);
});

test("layeredLayout tolerates a cycle without infinite recursion", () => {
  const cyc = layeredLayout(
    [{ id: "a" }, { id: "b" }],
    [{ from: "a", to: "b", stake: "50%" }, { from: "b", to: "a", stake: "50%" }],
  );
  assert.equal(cyc.order.length >= 1, true);
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

test("layeredLayout handles an empty graph", () => {
  const { order, rows } = layeredLayout([], []);
  assert.deepEqual(order, []);
  assert.deepEqual(rows, {});
});

test("layeredLayout handles a single unlinked node", () => {
  const { order, rows, layerOf } = layeredLayout([{ id: "me" }], []);
  assert.deepEqual(order, [0]);
  assert.deepEqual(rows, { 0: ["me"] });
  assert.equal(layerOf.me, 0);
});

test("capTablesByEntity returns an empty object for no edges", () => {
  assert.deepEqual(capTablesByEntity([]), {});
});
