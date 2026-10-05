// keep/logic/relmap.js — pure helpers for the Relationships map (no DOM).
// Turns the flat {nodes, edges} graph into: each entity's ownership cap table,
// a top-down layered layout (owners above what they own), and a fit-vs-pan plan
// that keeps boxes from shrinking below a readable minimum. Unit-tested.

import { parsePct } from "./ownership.js";

// Cap table per OWNED entity: { entityId: [{ ownerId, pct }] } — one entry per
// ownership edge that carries a numeric stake. Control-only links (a trustee
// with no percentage) are not ownership and are excluded.
export function capTablesByEntity(edges) {
  const out = {};
  for (const e of edges) {
    const pct = parsePct(e.stake);
    // Number.isFinite, not `!= null`: parsePct returns NaN for a non-numeric
    // stake and `NaN != null` is TRUE, so junk reached the cap table and the bar
    // rendered "NaN%" with a NaN width. `stake` is text with no CHECK
    // constraint, so a broker/service-role write can produce it.
    if (Number.isFinite(pct)) (out[e.to] = out[e.to] || []).push({ ownerId: e.from, pct });
  }
  return out;
}

// Control-only relationships per CONTROLLED entity: { entityId: [{ ownerId, role }] }
// — one entry per link that carries a role but no numeric stake (a trustee, a
// manager with no equity). These are the counterpart to capTablesByEntity: the role
// is shown inside the controlled entity's box rather than as a label on the line.
export function controlsByEntity(edges) {
  const out = {};
  for (const e of edges) {
    // The exact complement of capTablesByEntity's test, so an edge lands in
    // exactly one of the two (a NaN stake was previously in BOTH neither — it
    // entered the cap table and was skipped here).
    if (!Number.isFinite(parsePct(e.stake)) && e.role) (out[e.to] = out[e.to] || []).push({ ownerId: e.from, role: e.role });
  }
  return out;
}

// Orchestrated layered layout (Sugiyama-style) — the antidote to a crossing
// "spaghetti" graph. On top of longest-path layering it (1) inserts dummy routing
// nodes for every edge that spans more than one layer, so long edges bend through
// the layers instead of cutting straight across; (2) minimizes crossings with
// median-heuristic sweeps, keeping the best ordering seen; and (3) returns the
// per-edge dummy chain so the renderer can route each long edge through its
// waypoints. Cross-axis (x) placement is left to the caller, which owns pixels.
// `bandOf(node)` is optional: when given, it fixes each node's layer (used by the
// "by type" view to layer by category); when omitted, layers come from longest-path
// ownership depth. `floorOf(id)` is an optional per-node minimum band, applied only
// in the depth path — layer = max(ownership depth, floor) — so a category can be
// pinned to a tier (individuals < trusts < businesses) while descendants still nest
// deeper. Either way, edges that span >1 layer — in EITHER direction — get
// dummies through every intervening layer, so the renderer can keep them out of the
// cards. Returns { order, rows (real + dummy ids per layer, ordered), layerOf, dummy
// (id -> layer), edgePath ("from>to>edgeIndex" -> [dummyId...] ordered), up, down }.
// Callers read edgePath via edgeKey(edge) — never by building "from>to" by hand.
// The edgePath key for an edge at index `i` of the array passed to orchestrate.
// The index is part of the key so two relationships between the SAME pair keep
// separate routes instead of collapsing into one.
//
// `i` is the index in the CALLER's original array. orchestrate filters out edges
// whose endpoints are absent, so an index taken after filtering would not line
// up — which is why this takes the index rather than reading it off the edge
// (and why orchestrate does not mutate the edges it is given).
export function edgeKey(e, i) {
  return e.from + ">" + e.to + ">" + (i != null ? i : 0);
}

export function orchestrate(nodes, edges, bandOf, floorOf) {
  const ids = new Set(nodes.map((n) => n.id));
  // Keep each surviving edge paired with its ORIGINAL index, so edgeKey matches
  // what the caller computes from its own array.
  const kept = [];
  edges.forEach((e, i) => { if (ids.has(e.from) && ids.has(e.to)) kept.push({ e, i }); });
  const E = kept.map((k) => k.e);
  const layer = {};
  if (bandOf) {
    // Default the band: an undefined return put the key "undefined" into `rows`,
    // which became NaN in the order list and threw an opaque TypeError further
    // down. Not reachable from today's caller; cheap to make impossible.
    nodes.forEach((n) => { const b = bandOf(n); layer[n.id] = Number.isFinite(b) ? b : 0; });
  } else {
    const incoming = {};
    nodes.forEach((n) => { incoming[n.id] = []; });
    E.forEach((e) => incoming[e.to].push(e.from));
    // Longest-path depth, but never above the node's optional category floor —
    // so a caller can pin a whole category (e.g. trusts, then businesses) to a
    // minimum band while still letting ownership depth push descendants deeper.
    const visit = (id, seen) => {
      if (layer[id] != null) return layer[id];
      if (seen.has(id)) return 0;
      seen.add(id);
      let m = floorOf ? floorOf(id) : 0;
      for (const p of incoming[id]) m = Math.max(m, visit(p, seen) + 1);
      return (layer[id] = m);
    };
    nodes.forEach((n) => visit(n.id, new Set()));
  }

  // Split long edges into unit-length segments through fresh dummy nodes.
  const dummy = {}; let dc = 0;
  const seg = []; const edgePath = {};
  // Keyed "from>to>index", not "from>to". entity_relationships has no uniqueness
  // constraint (only from<>to), and a dual link is realistic — 50% Member AND
  // Manager. Two such edges each built their own dummy chain, then both wrote the
  // same key: the second won, the first's dummies stayed in `rows` reserving a
  // phantom column, and both relationships rendered along one indistinguishable
  // line — the "two different owners sharing a line" case CLAUDE.md's
  // non-overlapping-connectors rule forbids.
  for (const { e, i: ei } of kept) {
    let a = e.from, b = e.to, la = layer[a], lb = layer[b];
    if (la === lb) { seg.push([a, b]); continue; }           // same layer (unusual)
    if (la > lb) { const t = a; a = b; b = t; const tl = la; la = lb; lb = tl; }
    if (lb - la === 1) { seg.push([a, b]); continue; }
    let prev = a; const chain = [];
    for (let L = la + 1; L < lb; L++) { const d = "Δ" + (dc++); dummy[d] = L; chain.push(d); seg.push([prev, d]); prev = d; }
    seg.push([prev, b]);
    edgePath[edgeKey(e, ei)] = layer[e.from] < layer[e.to] ? chain : chain.slice().reverse();
  }

  const rows = {};
  nodes.forEach((n) => { (rows[layer[n.id]] = rows[layer[n.id]] || []).push(n.id); });
  for (const d in dummy) (rows[dummy[d]] = rows[dummy[d]] || []).push(d);
  const order = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const lyr = (id) => (dummy[id] != null ? dummy[id] : layer[id]);
  const up = {}, down = {};
  order.forEach((r) => rows[r].forEach((id) => { up[id] = []; down[id] = []; }));
  // up/down are BETWEEN-row adjacency, used by crossings() and the median
  // heuristic. A same-layer segment has no up/down direction — `lyr(a) < lyr(b)`
  // is false when equal, so `b` was recorded as the PARENT of `a` (inverted),
  // and same-row positions were then mixed into the between-row crossing count
  // while median() fed a node its own row's positions. The minimiser was
  // optimising a wrong objective. Excluded here; the renderer routes these via
  // relOrtho's dedicated same-band branch, which already keeps them out of the
  // cards, so nothing about their drawn path changes.
  seg.forEach(([a, b]) => {
    if (lyr(a) === lyr(b)) return;
    const t = lyr(a) < lyr(b) ? a : b, u = t === a ? b : a;
    down[t].push(u); up[u].push(t);
  });

  const pos = {};
  order.forEach((r) => rows[r].forEach((id, i) => { pos[id] = i; }));
  const median = (arr) => {
    if (!arr.length) return -1;
    const q = arr.map((x) => pos[x]).sort((a, b) => a - b);
    const m = q.length >> 1;
    return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2;
  };
  const crossings = () => {
    let c = 0;
    for (let r = 0; r < order.length - 1; r++) {
      const es = [];
      rows[order[r]].forEach((t) => down[t].forEach((b) => es.push([pos[t], pos[b]])));
      for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++)
        if ((es[i][0] - es[j][0]) * (es[i][1] - es[j][1]) < 0) c++;
    }
    return c;
  };
  const snapshot = () => order.reduce((o, r) => { o[r] = rows[r].slice(); return o; }, {});
  let best = snapshot(), bestC = crossings();
  for (let it = 0; it < 16; it++) {
    const dn = it % 2 === 0;
    const seq = dn ? order.slice(1) : order.slice(0, -1).reverse();
    for (const r of seq) {
      const key = dn ? up : down;
      // Stable PARTITION, not a comparator that returns 0 for the pinned case.
      // `(x.m < 0 || y.m < 0 ? 0 : x.m - y.m) || idCompare` is NON-TRANSITIVE: a
      // neighbourless node (m === -1) compared by id against everything while
      // median-bearing nodes compared by median, so with A(m=-1), B(m=5),
      // C(m=10) and ids A>B, A<C you get B<C, A>B, A<C — contradictory. V8's
      // sort does not detect that and returns an order that varies with array
      // length, making the shipped layout non-deterministic for any row holding
      // an isolated node. The intent was "leave the -1 nodes where they are",
      // which is a partition: order the ones that have a median, and splice the
      // neighbourless ones back at their original indices.
      const decorated = rows[r].map((id, i) => ({ id, i, m: median(key[id]) }));
      const pinned = decorated.filter((d) => d.m < 0);
      const movable = decorated.filter((d) => d.m >= 0)
        .sort((x, y) => (x.m - y.m) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const next = [];
      let mi = 0;
      for (let i = 0; i < decorated.length; i++) {
        const hold = pinned.find((d) => d.i === i);
        next.push(hold ? hold.id : (movable[mi++] || {}).id);
      }
      rows[r] = next.filter((id) => id !== undefined);
      rows[r].forEach((id, i) => { pos[id] = i; });
    }
    const c = crossings();
    if (c < bestC) { bestC = c; best = snapshot(); }
  }
  return { order, rows: best, layerOf: layer, dummy, edgePath, up, down };
}

// Fit-to-width vs. pan decision. If scaling the content to the container would
// shrink a node below `minNodePx`, we stop shrinking: render at that floor (wider
// than the container) and let the map pan. Otherwise it fits and scales to width.
// Returns { mode: "fit" | "pan", renderW }.
export function fitPlan({ contentW, containerW, nodeW, minNodePx }) {
  if (!contentW || !containerW || containerW <= 0) return { mode: "fit", renderW: contentW };
  const nodePxIfFit = nodeW * (containerW / contentW);
  if (nodePxIfFit >= minNodePx) return { mode: "fit", renderW: Math.min(contentW, containerW) };
  return { mode: "pan", renderW: contentW * (minNodePx / nodeW) };
}
