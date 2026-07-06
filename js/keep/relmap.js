// keep/relmap.js — pure helpers for the Relationships map (no DOM).
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
    if (pct != null) (out[e.to] = out[e.to] || []).push({ ownerId: e.from, pct });
  }
  return out;
}

// Top-down layered layout. A node's layer is the longest ownership path from a
// root (a node nothing points to) — so owners always sit above what they own and
// chains read in order. Within each layer, a barycenter sweep orders nodes near
// their owners to cut edge crossings. Pure and deterministic (ties broken by id).
// Returns { order: layer numbers ascending, rows: { layer: [nodeId] }, layerOf }.
export function layeredLayout(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = {};
  nodes.forEach((n) => { incoming[n.id] = []; });
  edges.forEach((e) => { if (ids.has(e.from) && ids.has(e.to)) incoming[e.to].push(e.from); });

  const layer = {};
  const visit = (id, seen) => {
    if (layer[id] != null) return layer[id];
    if (seen.has(id)) return 0;              // cycle guard — don't recurse forever
    seen.add(id);
    let m = 0;
    for (const p of incoming[id]) m = Math.max(m, visit(p, seen) + 1);
    return (layer[id] = m);
  };
  nodes.forEach((n) => visit(n.id, new Set()));

  const rows = {};
  nodes.forEach((n) => { (rows[layer[n.id]] = rows[layer[n.id]] || []).push(n.id); });
  const order = Object.keys(rows).map(Number).sort((a, b) => a - b);

  const pos = {};
  order.forEach((r) => rows[r].forEach((id, i) => { pos[id] = i; }));
  const bary = (id) => {
    const ps = incoming[id].map((p) => pos[p]).filter((v) => v != null);
    return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : pos[id];
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const r of order) {
      if (r === 0) continue;
      rows[r].sort((a, b) => bary(a) - bary(b) || (a < b ? -1 : a > b ? 1 : 0));
      rows[r].forEach((id, i) => { pos[id] = i; });
    }
  }
  return { order, rows, layerOf: layer };
}

// Group nodes into bands for the "by type" perspective — people, trusts,
// businesses — returning the same { order, rows } shape as layeredLayout so the
// renderer can consume either. `bandOf(node)` maps a node to its band index;
// input order is preserved within a band. Pure.
export function typeBands(nodes, bandOf) {
  const rows = {};
  for (const n of nodes) {
    const b = bandOf(n);
    (rows[b] = rows[b] || []).push(n.id);
  }
  const order = Object.keys(rows).map(Number).sort((a, b) => a - b);
  return { order, rows };
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
// ownership depth. Either way, edges that span >1 layer — in EITHER direction — get
// dummies through every intervening layer, so the renderer can keep them out of the
// cards. Returns { order, rows (real + dummy ids per layer, ordered), layerOf, dummy
// (id -> layer), edgePath (from>to -> [dummyId...] ordered), up, down }.
export function orchestrate(nodes, edges, bandOf) {
  const ids = new Set(nodes.map((n) => n.id));
  const E = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const layer = {};
  if (bandOf) {
    nodes.forEach((n) => { layer[n.id] = bandOf(n); });
  } else {
    const incoming = {};
    nodes.forEach((n) => { incoming[n.id] = []; });
    E.forEach((e) => incoming[e.to].push(e.from));
    const visit = (id, seen) => {
      if (layer[id] != null) return layer[id];
      if (seen.has(id)) return 0;
      seen.add(id);
      let m = 0;
      for (const p of incoming[id]) m = Math.max(m, visit(p, seen) + 1);
      return (layer[id] = m);
    };
    nodes.forEach((n) => visit(n.id, new Set()));
  }

  // Split long edges into unit-length segments through fresh dummy nodes.
  const dummy = {}; let dc = 0;
  const seg = []; const edgePath = {};
  for (const e of E) {
    let a = e.from, b = e.to, la = layer[a], lb = layer[b];
    if (la === lb) { seg.push([a, b]); continue; }           // same layer (unusual)
    if (la > lb) { const t = a; a = b; b = t; const tl = la; la = lb; lb = tl; }
    if (lb - la === 1) { seg.push([a, b]); continue; }
    let prev = a; const chain = [];
    for (let L = la + 1; L < lb; L++) { const d = "Δ" + (dc++); dummy[d] = L; chain.push(d); seg.push([prev, d]); prev = d; }
    seg.push([prev, b]);
    edgePath[e.from + ">" + e.to] = layer[e.from] < layer[e.to] ? chain : chain.slice().reverse();
  }

  const rows = {};
  nodes.forEach((n) => { (rows[layer[n.id]] = rows[layer[n.id]] || []).push(n.id); });
  for (const d in dummy) (rows[dummy[d]] = rows[dummy[d]] || []).push(d);
  const order = Object.keys(rows).map(Number).sort((a, b) => a - b);
  const lyr = (id) => (dummy[id] != null ? dummy[id] : layer[id]);
  const up = {}, down = {};
  order.forEach((r) => rows[r].forEach((id) => { up[id] = []; down[id] = []; }));
  seg.forEach(([a, b]) => { const t = lyr(a) < lyr(b) ? a : b, u = t === a ? b : a; down[t].push(u); up[u].push(t); });

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
      rows[r] = rows[r]
        .map((id) => ({ id, m: median(key[id]) }))
        .sort((x, y) => (x.m < 0 || y.m < 0 ? 0 : x.m - y.m) || (x.id < y.id ? -1 : 1))
        .map((o) => o.id);
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
