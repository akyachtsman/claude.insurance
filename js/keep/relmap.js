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
