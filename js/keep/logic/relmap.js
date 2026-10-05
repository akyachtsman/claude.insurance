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

// ── Cross-axis placement and orthogonal edge routing ────────────────────────
//
// Moved here from views/relmap-view.js (audit 2026-10-05). These three are
// completely pure — plain objects and numbers in, numbers and SVG path STRINGS
// out, no DOM — and CLAUDE.md assigns "layout math" to this module. More to the
// point, the project's own connector standard requires that edge geometry be
// "verif[ied] geometrically before shipping ... programmatically", and that
// verification is a unit test over exactly these functions. While they were
// sealed inside an 839-line DOM-bound view with no test file, the standard
// mandated a check the file layout made impossible to write.
//
// Node geometry travels with them, since the routing math is expressed in it.
export const REL_NODE_W = 210, REL_NODE_H = 118, REL_HGAP = 30, REL_VGAP = 78;

// Cross-axis placement (Brandes–Köpf). A simple barycenter relaxation drifts and
// never straightens single-child chains (a deep A→B→C hangs out as a staircase).
// Instead: (1) align each node under the median of its owners, chaining nodes into
// vertical "blocks" while forbidding crossings, so an ownership chain becomes one
// straight column; then (2) compact the blocks as far toward the start of the axis
// as the minimum separation allows. Deterministic; owners sit directly above what
// they own and the whole layout packs tight.
export function alignCross(order, rows, up, down, sepOf) {
  const rowOf = {}, pos = {};
  order.forEach((r) => rows[r].forEach((id, i) => { rowOf[id] = r; pos[id] = i; }));

  // (1) Vertical alignment: link each node to its median owner into a block
  // (root = block head, alignN = next node in the block, cyclic).
  const root = {}, alignN = {};
  order.forEach((r) => rows[r].forEach((id) => { root[id] = id; alignN[id] = id; }));
  for (let ri = 1; ri < order.length; ri++) {
    const r = order[ri], prev = order[ri - 1];
    let last = -1;                                    // owner index used so far — keep increasing (no crossing)
    for (const v of rows[r]) {
      const owners = (up[v] || []).map((u) => pos[u]);
      if (!owners.length) continue;
      owners.sort((a, b) => a - b);
      const lo = Math.floor((owners.length - 1) / 2), hi = Math.ceil((owners.length - 1) / 2);
      for (let m = lo; m <= hi; m++) {
        if (alignN[v] !== v) break;                   // already placed in a block
        const oi = owners[m];
        if (oi > last) { const u = rows[prev][oi]; alignN[u] = v; root[v] = root[u]; alignN[v] = root[v]; last = oi; }
      }
    }
  }

  // (2) Horizontal compaction: shove each block toward the axis start, respecting
  // the min separation against the block to its left in every row (BK sink/shift).
  const sink = {}, shift = {}, x = {};
  order.forEach((r) => rows[r].forEach((id) => { sink[id] = id; shift[id] = Infinity; }));
  const place = (v) => {
    if (x[v] != null) return;
    x[v] = 0;
    let w = v;
    do {
      const p = pos[w];
      if (p > 0) {
        const u = rows[rowOf[w]][p - 1], ru = root[u];
        place(ru);
        const sep = sepOf(u, w);
        if (sink[v] === v) sink[v] = sink[ru];
        if (sink[v] !== sink[ru]) shift[sink[ru]] = Math.min(shift[sink[ru]], x[v] - x[ru] - sep);
        else x[v] = Math.max(x[v], x[ru] + sep);
      }
      w = alignN[w];
    } while (w !== v);
  };
  order.forEach((r) => rows[r].forEach((id) => { if (root[id] === id) place(id); }));

  const c = {};
  order.forEach((r) => rows[r].forEach((id) => {
    c[id] = x[root[id]];
    const sh = shift[sink[root[id]]];
    if (sh < Infinity) c[id] += sh;
  }));
  return c;
}
// Orthogonal (org-chart) edge routing through a chain of box/dummy centres. Every
// run is axis-aligned and straight: the edge leaves the owner's facing edge, drops
// into the empty channel in the gap *between* two rows, runs across it, then into the
// next row — repeating through any dummy waypoints (which occupy the gap columns
// between boxes). Because each cross-run lives in a row gap and each along-run in a
// box-centre or dummy column, the line never passes behind a box. The exit/entry
// faces follow the actual band direction (so a reverse link — owner below its target
// — leaves the top and enters the bottom), and a same-band link dips into the
// adjacent row gap rather than cutting through the cards. Works along either axis via
// a main/cross split (main = the band-stacking axis). `channelOf(p, q)` optionally
// picks the along-gap coordinate for each run (used to fan each owner's bus onto its
// own lane so runs don't overlap); it defaults to the middle of the gap. Returns the
// path `d` plus a `mid` anchor for the role label.
export function relOrtho(chain, horiz, channelOf, entryCross) {
  const halfMain = (horiz ? REL_NODE_W : REL_NODE_H) / 2;
  const gapHalf = (horiz ? REL_HGAP : REL_VGAP) / 2;
  const mainOf = (p) => (horiz ? p.x : p.y);
  const crossOf = (p) => (horiz ? p.y : p.x);
  const pt = (main, cross) => (horiz ? { x: main, y: cross } : { x: cross, y: main });
  const pathOf = (P) => P.reduce((s, p, i) => s + (i ? " L " : "M ") + p.x + " " + p.y, "");
  const n = chain.length;
  const a = chain[0], b = chain[n - 1];
  if (n < 2) return { d: "", mid: a || { x: 0, y: 0 } };

  // Same-band link (no rows between the two cards): dip into the gap just past the
  // band and back, so the run stays out of every card in that band.
  if (n === 2 && mainOf(a) === mainOf(b)) {
    const ch = mainOf(a) + halfMain + gapHalf, ac = crossOf(a), bc = crossOf(b);
    const P = [pt(mainOf(a) + halfMain, ac), pt(ch, ac), pt(ch, bc), pt(mainOf(b) + halfMain, bc)];
    return { d: pathOf(P), mid: pt(ch, (ac + bc) / 2), pts: P };
  }

  const dStart = Math.sign(mainOf(chain[1]) - mainOf(a)) || 1;
  const dEnd = Math.sign(mainOf(b) - mainOf(chain[n - 2])) || 1;
  // Enter the target at `entryCross` when given (its owner's slice of the cap-table
  // bar) so several arrows into one box spread across the bar instead of stacking on
  // the centre; the last run jogs to it.
  const crossAt = (i) => (i === n - 1 && entryCross != null) ? entryCross : crossOf(chain[i]);
  const P = [pt(mainOf(a) + dStart * halfMain, crossOf(a))];
  for (let i = 0; i < n - 1; i++) {
    const ch = channelOf ? channelOf(chain[i], chain[i + 1]) : (mainOf(chain[i]) + mainOf(chain[i + 1])) / 2;   // channel (lane) in the row gap
    P.push(pt(ch, crossAt(i)), pt(ch, crossAt(i + 1)));
  }
  P.push(pt(mainOf(b) - dEnd * halfMain, crossAt(n - 1)));
  const m = (n - 1) >> 1, p = chain[m], q = chain[m + 1];
  return { d: pathOf(P), mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, pts: P };
}

// Build an edge's path string, breaking each of its gap-spanning runs with a small
// GAP where it crosses the perpendicular run of another edge — so where an edge
// merely passes across another (e.g. a holding company's connector crossing the
// arrows into an unrelated box) the crossed line breaks and the other passes cleanly
// through, reading as a crossing, not a join (and without an arc that looks like a
// node). `crossers` are the perpendicular segments of every other edge: `c` is their
// constant coordinate and `[s0,s1]` their span. In vertical layout the gap-spanning
// run is horizontal; in horizontal layout it is vertical. Only interior crossings break.
export function relHopPath(pts, crossers, horiz) {
  const R = 6;                                            // half-gap (the rounded line-caps eat ~1.25px each side)
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    // The gap-spanning run breaks: horizontal in a vertical layout, vertical otherwise.
    const hoppable = horiz ? (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 1)
                           : (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 1);
    if (!hoppable) { d += ` L ${b.x} ${b.y}`; continue; }
    const fixed = horiz ? a.x : a.y;                     // constant coordinate of the run
    const t0 = horiz ? a.y : a.x, t1 = horiz ? b.y : b.x;   // the run travels t0 → t1
    const dir = Math.sign(t1 - t0) || 1;
    const cuts = crossers
      .filter((v) => v.c > Math.min(t0, t1) + 2 && v.c < Math.max(t0, t1) - 2 && fixed > v.s0 + 1 && fixed < v.s1 - 1)
      .map((v) => v.c)
      .sort((x, y) => dir * (x - y));
    for (const c of cuts) {                              // draw up to the crossing, then skip over it
      if (horiz) d += ` L ${a.x} ${c - dir * R} M ${a.x} ${c + dir * R}`;
      else d += ` L ${c - dir * R} ${a.y} M ${c + dir * R} ${a.y}`;
    }
    d += ` L ${b.x} ${b.y}`;
  }
  return d;
}
