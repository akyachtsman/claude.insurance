// Tests for keep/relmap.js — run: node --test js/keep/logic/relmap.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { capTablesByEntity, controlsByEntity, edgeKey, fitPlan, orchestrate,
         alignCross, relOrtho, relHopPath, REL_NODE_W, REL_NODE_H, REL_HGAP, REL_VGAP } from "./relmap.js";

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
  const path = edgePath[edgeKey({ from: "u", to: "w" }, 2)];  // third edge in `es`
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
  const path = edgePath[edgeKey({ from: "p", to: "c" }, 0)];
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
  const path = edgePath[edgeKey({ from: "biz", to: "tr" }, 0)];
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

// ── Regression: layout integrity (audit 2026-10-05) ────────────────────────
test("a non-numeric stake is kept out of the cap table", () => {
  // parsePct returns NaN for junk and `NaN != null` is true, so "NaN%" was
  // rendered with a NaN bar width. `stake` is text with no CHECK constraint.
  assert.deepEqual(capTablesByEntity([{ from: "a", to: "b", stake: "n/a" }]), {});
  // and it must land in controls instead, never in neither or both
  assert.deepEqual(controlsByEntity([{ from: "a", to: "b", stake: "n/a", role: "Trustee" }]),
    { b: [{ ownerId: "a", role: "Trustee" }] });
});

test("two edges between the same pair keep separate routes", () => {
  // Keyed "from>to" previously, so the second overwrote the first — orphaning a
  // dummy that still reserved layout width while both edges drew as one line.
  const ns = [{ id: "x" }, { id: "m" }, { id: "n" }];
  const es = [{ from: "x", to: "n", stake: "50%" }, { from: "x", to: "n", stake: "50%" }];
  const band = { x: 0, m: 1, n: 2 };
  const { edgePath } = orchestrate(ns, es, (n) => band[n.id]);
  assert.equal(Object.keys(edgePath).length, 2, "each edge needs its own entry");
  assert.notDeepEqual(edgePath[edgeKey(es[0], 0)], undefined);
  assert.notDeepEqual(edgePath[edgeKey(es[1], 1)], undefined);
});

test("orchestrate does not mutate the edges it is given", () => {
  const es = [{ from: "a", to: "b", stake: "100%" }];
  const snapshot = JSON.stringify(es);
  orchestrate([{ id: "a" }, { id: "b" }], es);
  assert.equal(JSON.stringify(es), snapshot);
});

test("a same-band edge is excluded from between-row adjacency", () => {
  // up/down drive crossings() and the median heuristic. A same-layer segment has
  // no direction, and `lyr(a) < lyr(b)` is false when equal — so the target was
  // recorded as the PARENT, and same-row positions polluted the crossing count.
  const band = { p: 0, q: 0 };
  const { up, down } = orchestrate([{ id: "p" }, { id: "q" }], [{ from: "p", to: "q", stake: "100%" }], (n) => band[n.id]);
  assert.deepEqual(down.p, []);
  assert.deepEqual(up.q, []);
});

test("a row containing a neighbourless node orders deterministically", () => {
  // The old comparator was non-transitive, so V8 returned an order that varied
  // with input permutation and the shipped layout was non-deterministic.
  const ns = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "root" }];
  const es = [{ from: "root", to: "B", stake: "50%" }, { from: "root", to: "C", stake: "50%" }];
  const band = { root: 0, A: 1, B: 1, C: 1 };
  const first = JSON.stringify(orchestrate(ns, es, (n) => band[n.id]).rows);
  for (let i = 0; i < 8; i++) {
    assert.equal(JSON.stringify(orchestrate(ns, es, (n) => band[n.id]).rows), first);
  }
});

// ── The connector standard's GEOMETRIC verification (audit 2026-10-05) ──────
//
// CLAUDE.md → "Non-overlapping connectors (always)" requires counting
// cross-source collinear overlaps and lines-behind-boxes PROGRAMMATICALLY,
// because "a visual glance misses collinear overlaps". That check was
// impossible to write while the routing math was sealed inside the 839-line
// DOM-bound view; these are it.

// Build real edge polylines for a graph, the way the renderer does.
function routeAll(nodes, edges, bandOf) {
  const { order, rows, dummy, edgePath, up, down } = orchestrate(nodes, edges, bandOf);
  const sepOf = () => REL_NODE_W + REL_HGAP;
  const cross = alignCross(order, rows, up, down, sepOf);
  const bandIndex = {};
  order.forEach((b, bi) => rows[b].forEach((id) => { bandIndex[id] = bi; }));
  const ptOf = (id) => ({ x: cross[id], y: bandIndex[id] * (REL_NODE_H + REL_VGAP) });
  return edges.map((e, i) => {
    const wp = edgePath[edgeKey(e, i)] || [];
    const chain = [ptOf(e.from), ...wp.map(ptOf), ptOf(e.to)];
    const r = relOrtho(chain, false, null, null);
    return { e, pts: r.pts || [] };
  }).filter((r) => r.pts.length >= 2);
}
const segsOf = (pts) => pts.slice(0, -1).map((p, i) => [p, pts[i + 1]]);
const near = (a, b) => Math.abs(a - b) < 0.5;

test("no two edges from DIFFERENT sources run collinear", () => {
  // Two owners' runs sharing a line read as one line — the failure the standard
  // exists to prevent, and the one the eye cannot catch.
  const nodes = [{ id: "o1" }, { id: "o2" }, { id: "t1" }, { id: "t2" }, { id: "mid" }];
  const edges = [
    { from: "o1", to: "t1", stake: "100%" },
    { from: "o2", to: "t2", stake: "100%" },
  ];
  const band = { o1: 0, o2: 0, mid: 1, t1: 2, t2: 2 };
  const routed = routeAll(nodes, edges, (n) => band[n.id]);
  let overlaps = 0;
  for (let i = 0; i < routed.length; i++) {
    for (let j = i + 1; j < routed.length; j++) {
      if (routed[i].e.from === routed[j].e.from) continue;   // a bus is one relationship
      for (const [a, b] of segsOf(routed[i].pts)) {
        for (const [c, d] of segsOf(routed[j].pts)) {
          const vert = near(a.x, b.x) && near(c.x, d.x) && near(a.x, c.x);
          const horz = near(a.y, b.y) && near(c.y, d.y) && near(a.y, c.y);
          if (!vert && !horz) continue;
          const [p0, p1] = vert ? [a.y, b.y] : [a.x, b.x];
          const [q0, q1] = vert ? [c.y, d.y] : [c.x, d.x];
          const span = Math.min(Math.max(p0, p1), Math.max(q0, q1)) - Math.max(Math.min(p0, p1), Math.min(q0, q1));
          if (span > 1) overlaps++;    // a shared POINT is a crossing, not an overlap
        }
      }
    }
  }
  assert.equal(overlaps, 0, `${overlaps} cross-source collinear overlap(s)`);
});

test("no edge segment runs behind a node box", () => {
  // Includes the same-band case (a holding company owning an operating company,
  // both in the business band), which is where a straight run would cut through
  // whatever card sits between them.
  const nodes = [{ id: "holdco" }, { id: "midco" }, { id: "opco" }];
  const edges = [{ from: "holdco", to: "opco", stake: "100%" }];
  const band = { holdco: 2, midco: 2, opco: 2 };
  const { rows, order, up, down } = orchestrate(nodes, edges, (n) => band[n.id]);
  const cross = alignCross(order, rows, up, down, () => REL_NODE_W + REL_HGAP);
  const bandIndex = {};
  order.forEach((b, bi) => rows[b].forEach((id) => { bandIndex[id] = bi; }));
  const ptOf = (id) => ({ x: cross[id], y: bandIndex[id] * (REL_NODE_H + REL_VGAP) });
  const { pts } = relOrtho([ptOf("holdco"), ptOf("opco")], false, null, null);
  assert.ok(pts && pts.length >= 2, "same-band edge must produce a routed polyline");

  const boxes = nodes.map((n) => {
    const c = ptOf(n.id);
    return { id: n.id, x0: c.x - REL_NODE_W / 2, x1: c.x + REL_NODE_W / 2, y0: c.y - REL_NODE_H / 2, y1: c.y + REL_NODE_H / 2 };
  });
  const inside = (p, b) => p.x > b.x0 + 1 && p.x < b.x1 - 1 && p.y > b.y0 + 1 && p.y < b.y1 - 1;
  const behind = [];
  for (const [a, b] of segsOf(pts)) {
    for (const box of boxes) {
      if (box.id === "holdco" || box.id === "opco") continue;   // its own endpoints
      // Sample the segment; these runs are axis-aligned so sampling is exact enough.
      for (let t = 0; t <= 1; t += 0.05) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (inside(p, box)) { behind.push(box.id); t = 2; }
      }
    }
  }
  assert.deepEqual([...new Set(behind)], [], "edge runs behind a card");
});

test("a perpendicular crossing is broken with a GAP, never an arc", () => {
  // relHopPath must emit a fresh `M` (a move, i.e. a gap) at each crossing —
  // never a curve command, which reads as a node or a join at small sizes.
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
  const d = relHopPath(pts, [{ c: 100, s0: -50, s1: 50 }], false);
  assert.ok(d.includes("M"), "expected a move command (the gap)");
  assert.equal(/[CcQqSsTtAa]/.test(d.replace(/^M/, "")), false, `arc/curve command in path: ${d}`);
  // and with no crossers it stays one unbroken run
  assert.equal((relHopPath(pts, [], false).match(/M/g) || []).length, 1);
});

// ── Regression: resolving a dummy's target (Codex P1, 2026-10-05) ───────────
//
// relmap-view.js builds a dummy -> target map so each routing waypoint can be
// snapped to its target's column. It used to derive the target by PARSING the
// edgePath key: `key.slice(key.indexOf(">") + 1)`. Once the key gained the edge
// index, that returned "to>0" instead of "to", so the subsequent cross[] lookup
// was undefined and the nudge produced NaN — which propagated through every
// dummy position, the canvas offset and ultimately every rendered coordinate,
// for any relationship spanning more than one band.
//
// The earlier geometric tests here did not catch it because they call alignCross
// and relOrtho directly and never go through the view's edgePath consumption.
// These assert the contract that consumption depends on.
test("every edgePath entry resolves to a REAL target node id via edge metadata", () => {
  const nodes = [{ id: "owner" }, { id: "mid" }, { id: "target" }];
  const edges = [{ from: "owner", to: "target", stake: "100%" }];
  const band = { owner: 0, mid: 1, target: 2 };
  const { edgePath, dummy } = orchestrate(nodes, edges, (n) => band[n.id]);
  const ids = new Set(nodes.map((n) => n.id));

  // exactly how the view must build it: from the edge objects, never the key
  const dummyTarget = {};
  edges.forEach((e, i) => {
    (edgePath[edgeKey(e, i)] || []).forEach((d) => { dummyTarget[d] = e.to; });
  });

  assert.ok(Object.keys(dummy).length > 0, "this graph must produce a dummy to be a real test");
  assert.equal(Object.keys(dummyTarget).length, Object.keys(dummy).length);
  for (const [d, to] of Object.entries(dummyTarget)) {
    assert.ok(ids.has(to), `dummy ${d} resolved to "${to}", which is not a node id`);
  }
});

test("the edgePath key is NOT parseable as from>to — do not parse it", () => {
  // Kept as an explicit guard: it records WHY the view must not slice the key,
  // so a future reader does not reintroduce the parse as a tidy-up.
  const e = { from: "owner", to: "target" };
  const key = edgeKey(e, 0);
  assert.equal(key, "owner>target>0");
  assert.notEqual(key.slice(key.indexOf(">") + 1), e.to,
    "if this ever passes, the key format changed and the NaN trap is gone — but still prefer e.to");
  assert.equal(key.split(">")[1], e.to, "the target is the MIDDLE segment, not the tail");
});
