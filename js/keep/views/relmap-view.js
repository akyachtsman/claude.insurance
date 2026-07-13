// keep/relmap-view.js — the Relationships-map rendering subsystem for the Keep.
// Turns the ownership graph (getMapData) into an interactive, pannable/zoomable
// Sugiyama-style diagram, plus the toolbar that drives its view options. The
// layout math lives in keep/relmap.js; this module owns the DOM/SVG rendering
// and the map's view state. Extracted from views/keep.js.
// Public interface: relationshipMap() + relToolbar(drawMap, host).
import { el } from "../../dom.js";
import { s } from "../../svg.js";
import { icon } from "../../icons.js";
import { getMapData } from "../../supabase.js";
import { parsePct } from "../logic/ownership.js";
import { entityRelStyleKey as relStyleKey, entityMapSub } from "../logic/entity-display.js";
import { capTablesByEntity, orchestrate } from "../logic/relmap.js";

function svgText(str, attrs) { const t = s("text", attrs); t.textContent = str; return t; }


// Inline-SVG relationship graph, built live from the entity_relationships table.
// Owners sit above what they own (top-down layered layout — see keep/relmap.js
// orchestrate); each owned entity shows its ownership split as a cap-table bar.
// The map is ownership-only — control-only links (trustee/manager) are not shown.
// Nodes for entities you manage are keyboard-focusable and open their detail.
const REL_STYLE = {
  me: { fill: "#fff", avFill: "#E7EFFE", avText: "#2F6AF6", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  person: { fill: "#fff", avFill: "#E7EFFE", avText: "#2F6AF6", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  biz: { fill: "#fff", avFill: "#F3E1E5", avText: "#800020", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  np: { fill: "#fff", avFill: "#defaef", avText: "#0e8e66", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  trust: { fill: "#fff", avFill: "#E6E8EF", avText: "#1B2540", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
};
// Owner-type colours for ownership edges and cap-table segments — the project's
// palette (blue = people, burgundy = business, neutral ink = trust, green =
// nonprofit), so a colour on the map always reads as an entity type, not a
// per-owner rainbow. Mirrors the accent/company/text-primary/ok tokens.
const REL_TYPE_COLOR = { me: "#3F6FD8", person: "#3F6FD8", biz: "#800020", trust: "#1B2540", np: "#0E8E66" };
// Ownership / control pills use the LIGHT TINT of the owner's avatar as their
// background with a dark type colour as text (mirrors the entity-view stake
// pills), so a pill reads as the same colour as the initials it echoes.
const REL_PILL = {
  me:     { bg: "#E7EFFE", fg: "#1F52D6" },
  person: { bg: "#E7EFFE", fg: "#1F52D6" },
  biz:    { bg: "#F3E1E5", fg: "#800020" },
  np:     { bg: "#DEFAEF", fg: "#0B7355" },
  trust:  { bg: "#E6E8EF", fg: "#1B2540" },
};
const relPill = (sk) => REL_PILL[sk] || { bg: "#EAEDF4", fg: "#55607F" };
// Band order for the "by type" perspective: people, trusts, businesses.
const REL_BAND = { me: 0, person: 0, trust: 1, biz: 2, np: 2 };
// View controls for the Relationships map — held across in-view re-renders so the
// toolbar and the chart stay in sync. orient: vertical|horizontal · mode:
// ownership (by depth) | type (by category) · focus: entity id or null · chips:
// asset-marker declutter toggle.
const relView = { orient: "vertical", mode: "ownership", focus: null, chips: true };
// DB entity node → REL_STYLE key. Personal ("me") renders like the other
// individuals — white with a blue outline — distinguished by its "You" subtitle;
// nonprofit businesses (green) split from for-profit businesses by subtype.
// Node geometry and layout spacing. The map lays out top-down by ownership depth
// (owners above what they own) — see keep/relmap.js orchestrate — and sizes the
// canvas to the busiest row and the depth of the deepest chain, so boxes never
// pack tighter than one node + gap.
const REL_NODE_W = 210, REL_NODE_H = 118, REL_HGAP = 30, REL_VGAP = 78, REL_PAD = 34;
const REL_DUMMY_W = 16;   // routing-waypoint slot width on the cross axis
// Below this on-screen box width the map stops shrinking and pans instead.
const REL_MIN_NODE_PX = 150;
// Manual zoom bounds and per-click step (relative to the fit scale's natural 1×).
const REL_ZOOM_MIN = 0.3, REL_ZOOM_MAX = 2.4, REL_ZOOM_STEP = 1.25;
// Lay the graph out per the current relView. Bands (ownership layers, or type
// groups) stack along one axis; members spread along the other. Orientation swaps
// which axis is which — vertical stacks bands top-down, horizontal stacks them
// left-to-right (spreading deep chains across the width).
// Cross-axis placement (Brandes–Köpf). A simple barycenter relaxation drifts and
// never straightens single-child chains (a deep A→B→C hangs out as a staircase).
// Instead: (1) align each node under the median of its owners, chaining nodes into
// vertical "blocks" while forbidding crossings, so an ownership chain becomes one
// straight column; then (2) compact the blocks as far toward the start of the axis
// as the minimum separation allows. Deterministic; owners sit directly above what
// they own and the whole layout packs tight.
function alignCross(order, rows, up, down, sepOf) {
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
function relOrtho(chain, horiz, channelOf, entryCross) {
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
function relHopPath(pts, crossers, horiz) {
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

function relLayout() {
  const data = getMapData();
  const nodes = data.nodes.map((n) => ({ ...n, sk: relStyleKey(n) }));
  // Ownership-only map: control-only links (trustee/manager, no stake) are excluded.
  const edges = data.edges.filter((e) => parsePct(e.stake) != null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const horiz = relView.orient === "horizontal";

  // Both modes use the same orchestration (crossing-minimized, waypoint-routed) so
  // every edge is routed through the row gaps and never runs behind a card. Ownership
  // layers by depth; "by type" layers by category (people / trusts / businesses),
  // compacting the present bands to dense indices so an absent category leaves no
  // empty row.
  let order, rows, dummy, edgePath, up, down;
  if (relView.mode === "type") {
    const bandVal = (n) => REL_BAND[n.sk] ?? 2;
    const present = [...new Set(nodes.map(bandVal))].sort((a, b) => a - b);
    const dense = new Map(present.map((v, i) => [v, i]));
    ({ order, rows, dummy, edgePath, up, down } = orchestrate(nodes, edges, (n) => dense.get(bandVal(n))));
  } else {
    ({ order, rows, dummy, edgePath, up, down } = orchestrate(nodes, edges));
  }
  const bandIndex = {};
  order.forEach((b, bi) => rows[b].forEach((id) => { bandIndex[id] = bi; }));
  const bands = order.length || 1;

  const isDummy = (id) => dummy[id] != null;
  const wOf = (id) => (isDummy(id) ? REL_DUMMY_W : (horiz ? REL_NODE_H : REL_NODE_W));
  const sepOf = (a, b) => wOf(a) / 2 + wOf(b) / 2 + ((isDummy(a) || isDummy(b)) ? 16 : (horiz ? REL_VGAP : REL_HGAP));
  const cross = alignCross(order, rows, up, down, sepOf);
  // Cluster the top-level owners (root band). The alignment pins each owner above
  // its holdings, so an owner whose entities sit at the far edge of a wide tree (a
  // business partner who only co-owns two right-hand companies) is stranded off on
  // its own, far from the other people. Instead pack the roots together at their
  // minimum separation and centre that block over the span of everything they own,
  // so the top row reads as one group of people; each owner's link then routes out
  // to its holdings on its own lane. Only the roots move — every lower band keeps
  // its verified crossing-free position, and the overlap-deconfliction pass still
  // runs afterward.
  {
    const ids = (rows[order[0]] || []).filter((id) => !isDummy(id));
    if (ids.length) {
      const rel = [0];
      for (let i = 1; i < ids.length; i++) rel.push(rel[i - 1] + sepOf(ids[i - 1], ids[i]));
      const span = rel[rel.length - 1] || 0;
      const owned = [];
      ids.forEach((id) => (down[id] || []).forEach((n) => { if (cross[n] != null) owned.push(cross[n]); }));
      owned.sort((a, b) => a - b);
      const center = owned.length ? (owned[0] + owned[owned.length - 1]) / 2 : span / 2;   // centre of the holdings' span
      const start = center - span / 2;
      ids.forEach((id, i) => { cross[id] = start + rel[i]; });
    }
  }
  // Pull each long-edge routing dummy toward its edge's target column, within the
  // slack its row neighbours allow. A long edge (owner two+ layers above what it
  // owns) otherwise drops through a dummy parked at the midpoint — often right beside
  // an unrelated box in between — which reads as a connection to that box. Snapping
  // the dummy to the target's column makes the edge run straight down its own column,
  // clear of the boxes it passes. Real nodes stay put, so the layout doesn't shift.
  const dummyTarget = {};
  for (const key in edgePath) { const to = key.slice(key.indexOf(">") + 1); edgePath[key].forEach((d) => { dummyTarget[d] = to; }); }
  if (Object.keys(dummyTarget).length) {
    for (let pass = 0; pass < 4; pass++) {
      for (const r of order) {
        const ids = rows[r];
        const idx = pass % 2 ? [...ids.keys()].reverse() : [...ids.keys()];
        for (const i of idx) {
          const id = ids[i];
          if (dummyTarget[id] == null) continue;               // only nudge routing dummies
          const lo = i > 0 ? cross[ids[i - 1]] + sepOf(ids[i - 1], id) : -Infinity;
          const hi = i < ids.length - 1 ? cross[ids[i + 1]] - sepOf(id, ids[i + 1]) : Infinity;
          cross[id] = Math.max(lo, Math.min(hi, cross[dummyTarget[id]]));
        }
      }
    }
  }
  const cvals = Object.values(cross);
  const halfBand = (horiz ? REL_NODE_H : REL_NODE_W) / 2;
  const off = REL_PAD + halfBand - (cvals.length ? Math.min(...cvals) : 0);   // left/top margin = PAD
  const crossPx = (id) => cross[id] + off;
  const crossMax = (cvals.length ? Math.max(...cvals) : 0) + off + halfBand + REL_PAD;

  const bandSize = horiz ? REL_NODE_W : REL_NODE_H;
  const bandGap = horiz ? REL_HGAP : REL_VGAP;
  const bandCenter = (bi) => REL_PAD + bi * (bandSize + bandGap) + bandSize / 2;
  const bandSpan = REL_PAD * 2 + bands * bandSize + (bands - 1) * bandGap;
  const W = horiz ? bandSpan : crossMax;
  const H = horiz ? crossMax : bandSpan;

  const centerOf = (id) => horiz
    ? { x: bandCenter(bandIndex[id]), y: crossPx(id) }
    : { x: crossPx(id), y: bandCenter(bandIndex[id]) };
  nodes.forEach((n) => { const c = centerOf(n.id); n.x = Math.round(c.x - REL_NODE_W / 2); n.cy = Math.round(c.y); });

  const waypoints = {};
  for (const key in edgePath) waypoints[key] = edgePath[key].map((d) => { const c = centerOf(d); return { x: Math.round(c.x), y: Math.round(c.y) }; });
  return { nodes, edges, W, H, waypoints, horiz };
}

// The map is a fixed-size viewport you pan in 2D: the whole chart translates under
// the pointer (drag anywhere on the background — mouse or touch), in both axes.
// On first paint it scales to fit the viewport but never below the readable node
// floor, so a large chart overflows and you drag to reach the rest. A press that
// lands on a node without moving opens it.
function setupRelViewport(wrap, svg, W, H, bounds) {
  const MIN_K = REL_MIN_NODE_PX / REL_NODE_W;      // scale at which a node is exactly the floor width
  const MAX_K = 1.25;                              // don't over-zoom a tiny graph
  svg.style.transformOrigin = "0 0";               // predictable translate/scale from the top-left
  let k = 1, tx = 0, ty = 0, fitted = false;
  // Real node-cluster bounds in user units, measured from the actual rendered
  // nodes (below). The declared canvas / getBBox include edge-routing overshoot,
  // which would sit the graph off to the side — measuring the nodes avoids that.
  let bx = bounds ? bounds.x : 0, by = bounds ? bounds.y : 0;
  let bw = bounds ? bounds.w : W, bh = bounds ? bounds.h : H;
  const applyT = () => { svg.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`; };
  // Momentarily render at 1:1 and read the union rect of the node elements, in px
  // relative to the wrap (= user units at scale 1). Returns false if not yet laid out.
  const measureNodes = () => {
    const prev = svg.style.transform;
    svg.style.transform = "translate(0px,0px) scale(1)";
    const wr = wrap.getBoundingClientRect();
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity, any = false;
    svg.querySelectorAll(".k-relnode").forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width) { any = true; L = Math.min(L, r.left); T = Math.min(T, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom); }
    });
    if (!any) { svg.style.transform = prev; return false; }
    bx = L - wr.left; by = T - wr.top; bw = R - L; bh = B - T;
    return true;
  };
  // Keep the pan within bounds but never snap back to centre — the chart stays
  // draggable even when it fits, as long as a margin of it stays on screen.
  const clampPan = (vw, vh) => {
    const M = 48;
    tx = Math.min(vw - M - bx * k, Math.max(M - (bx + bw) * k, tx));
    ty = Math.min(vh - M - by * k, Math.max(M - (by + bh) * k, ty));
  };
  // Guarantee avatar initials never spill the r-17 circle: reset any prior clamp,
  // then squeeze only those whose rendered width exceeds the circle's usable width
  // (normal 2-letter initials are untouched). Re-run on every fit AND once the
  // webfonts finish loading — Quicksand can load *after* the first fit, widening
  // glyphs that measured narrow under the fallback font, so a one-shot clamp at
  // first paint silently misses them (why "MF" spilled again live).
  const clampAvatars = () => {
    svg.querySelectorAll(".k-relav").forEach((t) => {
      t.removeAttribute("textLength"); t.removeAttribute("lengthAdjust");
      if (t.getComputedTextLength() > 27) { t.setAttribute("textLength", "27"); t.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
    });
  };
  // Node name/subtitle can be longer than the fixed-width box (e.g. "Mercer Family
  // Foundation"); truncate any that would spill past the right edge with an ellipsis
  // — the full text stays available on hover. Re-measured on every fit AND on
  // fonts.ready so it reflects the loaded font, not the narrower fallback.
  const LABEL_MAXW = REL_NODE_W - 70;   // name/sub start 62px in; keep an 8px right margin
  const clampLabels = () => {
    svg.querySelectorAll(".k-relname, .k-relsub").forEach((t) => {
      const full = t.getAttribute("data-full") || t.textContent;
      t.setAttribute("data-full", full);
      t.textContent = full;                                 // reset (drops any prior ellipsis/title) before re-measuring
      if (t.getComputedTextLength() <= LABEL_MAXW) return;
      let n = full.length;
      while (n > 1 && t.getComputedTextLength() > LABEL_MAXW) {
        n--;
        t.textContent = full.slice(0, n).replace(/\s+$/, "") + "…";
      }
      const ti = s("title", {}); ti.textContent = full; t.appendChild(ti);
    });
  };
  // First paint (and every resize): measure the nodes, scale to fill the width,
  // hug the content height (no dead space), and centre the node box on both axes —
  // so it opens centred every single time.
  const fit = () => {
    const vw = wrap.clientWidth || 0;
    if (!vw || !measureNodes()) return;
    clampAvatars();
    clampLabels();
    k = Math.max(MIN_K, Math.min(vw / bw, MAX_K));
    const ch = bh * k;
    const viewH = (typeof window !== "undefined" ? window.innerHeight : 800);
    const boxH = Math.max(300, Math.min(ch + 24, viewH * 0.78, 760));
    if (Math.abs((parseFloat(wrap.style.height) || 0) - boxH) > 0.5) wrap.style.height = boxH + "px";
    const vh = wrap.clientHeight || boxH;
    tx = (vw - bw * k) / 2 - bx * k;
    ty = (vh - bh * k) / 2 - by * k;
    clampPan(vw, vh); applyT(); fitted = true;
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!wrap.isConnected) { if (fitted) ro.disconnect(); return; }
      fit();                                              // recompute fit scale + re-centre on every resize
    });
    ro.observe(wrap);
  }
  // Webfonts can finish loading after the first fit — re-run the clamps then so
  // late-widening glyphs can't spill (avatar initials out of their circle, or a
  // long name past the box edge, e.g. "Mercer Family Foundation").
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (wrap.isConnected) { clampAvatars(); clampLabels(); } });
  }
  // Manual zoom: scale to `nk`, keeping the content point under the focal point
  // (fx, fy — viewport-relative) fixed, then re-clamp the pan.
  const zoomTo = (nk, fx, fy) => {
    nk = Math.max(REL_ZOOM_MIN, Math.min(REL_ZOOM_MAX, nk));
    if (nk === k) return;
    const cx = (fx - tx) / k, cy = (fy - ty) / k;   // content point under the focal point
    k = nk; tx = fx - cx * k; ty = fy - cy * k;
    clampPan(wrap.clientWidth || 0, wrap.clientHeight || 0); applyT();
  };
  // The on-map +/- buttons zoom around the viewport centre.
  const zoom = (dir) => {
    const vw = wrap.clientWidth || 0, vh = wrap.clientHeight || 0;
    if (!vw || !vh) return;
    zoomTo(dir > 0 ? k * REL_ZOOM_STEP : k / REL_ZOOM_STEP, vw / 2, vh / 2);
  };
  // Mouse-wheel / trackpad zoom toward the cursor. deltaMode is normalised to
  // pixels; scroll up zooms in. preventDefault (non-passive) so the page doesn't
  // scroll while pointing at the map.
  wrap.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    let d = ev.deltaY;
    if (ev.deltaMode === 1) d *= 16; else if (ev.deltaMode === 2) d *= (wrap.clientHeight || 400);
    const r = wrap.getBoundingClientRect();
    zoomTo(k * Math.exp(-d * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  wrap.__relfit = fit;     // exposed so the toolbar's "Fit to screen" can recentre
  wrap.__relzoom = zoom;   // exposed for the on-map zoom buttons
  fit();

  // Drag-to-pan (mouse + touch). Opening a node is a genuine `click` (below), so it
  // also works for screen-reader activation and click-dispatching tests; a click
  // that merely concludes a pan is ignored via the `moved` flag.
  let down = false, moved = false, sx = 0, sy = 0, otx = 0, oty = 0, pressNode = null;
  wrap.addEventListener("pointerdown", (ev) => {
    down = true; moved = false; sx = ev.clientX; sy = ev.clientY; otx = tx; oty = ty;
    pressNode = ev.target.closest ? ev.target.closest(".k-relnode--link") : null;
    wrap.classList.add("is-grabbing");
    // Stop the browser starting a text selection on the drag (the click that opens
    // a node still fires, and keyboard focus is unaffected).
    if (ev.cancelable) ev.preventDefault();
    try { wrap.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });
  wrap.addEventListener("pointermove", (ev) => {
    if (!down) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    tx = otx + dx; ty = oty + dy;
    clampPan(wrap.clientWidth || 0, wrap.clientHeight || 0); applyT();
    ev.preventDefault();
  });
  const end = () => { down = false; wrap.classList.remove("is-grabbing"); };
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);
  // Navigate on a real click (not the tail of a pan). Pointer capture can retarget
  // the click to the wrapper, so fall back to the node the press started on; a
  // synthesized/AT click (no press) hits the node directly via ev.target. Delegated
  // so it also covers screen-reader activation and click-dispatching tests.
  wrap.addEventListener("click", (ev) => {
    if (moved) return;
    const node = (ev.target.closest && ev.target.closest(".k-relnode--link")) || pressNode;
    const href = node && node.getAttribute("data-href");
    if (href) location.hash = href;
  });
}

function relationshipMap() {
  const NODE_W = REL_NODE_W, NODE_H = REL_NODE_H, FS = "Nunito, sans-serif", FD = "Quicksand, sans-serif";
  const { nodes, edges, W, H, waypoints, horiz } = relLayout();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const caps = capTablesByEntity(edges);
  // Focus perspective: when an entity is chosen, highlight it plus its direct
  // owners and holdings and dim the rest. focusSet holds the ids kept bright.
  const focusId = relView.focus && byId.has(relView.focus) ? relView.focus : null;
  let focusSet = null;
  if (focusId) {
    focusSet = new Set([focusId]);
    edges.forEach((e) => { if (e.from === focusId) focusSet.add(e.to); else if (e.to === focusId) focusSet.add(e.from); });
  }
  const nodeDim = (id) => focusSet && !focusSet.has(id) ? "0.14" : null;
  const edgeDim = (e) => focusSet && e.from !== focusId && e.to !== focusId;
  // Every node sits at its computed layout position — no dragging, no persistence,
  // so the map is always the clean auto-layout.
  const pos = {};
  nodes.forEach((n) => { pos[n.id] = { x: n.x, cy: n.cy }; });
  const center = (id) => ({ x: pos[id].x + NODE_W / 2, y: pos[id].cy });

  // Cap-table bar geometry per owned entity, computed once so the bar and the arrows
  // that point at it agree. `seg.center` is the x of each owner's slice; an incoming
  // ownership arrow enters the box there (vertical only) so several arrows fan across
  // the bar instead of stacking on the box centre.
  const capBars = {};
  nodes.forEach((n) => {
    const cap = caps[n.id];
    if (!cap || !cap.length) return;
    const total = cap.reduce((t, c) => t + c.pct, 0);
    const barW = Math.min(NODE_W - 32, Math.max(80, cap.length * 64));
    const barX = n.x + (NODE_W - barW) / 2;
    const segs = [];
    let cx = barX;
    [...cap].sort((a, b) => b.pct - a.pct).forEach((c) => {
      const w = barW * (c.pct / Math.max(total, 100));
      segs.push({ ownerId: c.ownerId, pct: c.pct, x: cx, w, center: cx + w / 2 });
      cx += w;
    });
    capBars[n.id] = { barX, barW, total, segs };
  });
  const entryCrossFor = (e) => {
    if (horiz) return null;                                   // segments run along x; entry is on the side face
    const bar = capBars[e.to];
    const seg = bar && bar.segs.find((sg) => sg.ownerId === e.from);
    return seg ? seg.center : null;
  };

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Ownership map of your entities", class: "k-relsvg" });
  svg.appendChild(s("defs", {}, [
    // Arrowhead pointing from an owner to the entity it owns.
    s("marker", { id: "rel-arrow", viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "9", markerHeight: "9", orient: "auto", markerUnits: "userSpaceOnUse" }, [
      // Inherit the edge's own colour so each arrowhead matches (and darkens with) its line.
      s("path", { d: "M0,0 L10,5 L0,10 L2.5,5 Z", fill: "context-stroke", stroke: "none" }),
    ]),
  ]));

  // Edges under the nodes. Each ownership edge is tinted with its owner's type
  // colour (matching that owner's segment in the owned entity's cap-table bar) and
  // carries no label — the stake lives on the owned entity's cap-table bar.
  const edgeRefs = edges.map((e) => {
    const owner = byId.get(e.from);
    const color = REL_TYPE_COLOR[owner ? owner.sk : "person"] || "#c3b2f0";
    const path = s("path", { fill: "none", stroke: color, "stroke-width": "2.5", "stroke-linecap": "round", "marker-end": "url(#rel-arrow)", opacity: edgeDim(e) ? "0.08" : "0.85" });
    svg.appendChild(path);
    return { ...e, path, wp: (waypoints && waypoints[e.from + ">" + e.to]) || [] };
  });
  // Fan each owner's downward "bus" onto its own lane within the row gap. Without
  // this every edge crossing a gap runs along the same centre line, so different
  // owners' runs overlap into one line and a crossing looks like a join. Group the
  // segments by gap and by their upper endpoint (the bus source), then spread those
  // buses across the clear space between the two rows so each is a distinct line and
  // crossings read as crossings. Positions are static, so this is computed once.
  const laneMain = (p) => (horiz ? p.x : p.y);
  const laneKey = (p) => Math.round(p.x) + "," + Math.round(p.y);
  const halfMainNode = (horiz ? REL_NODE_W : REL_NODE_H) / 2;
  const gapBuses = new Map();
  edgeRefs.forEach((er) => {
    const chain = [center(er.from), ...er.wp, center(er.to)];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i], b = chain[i + 1];
      if (laneMain(a) === laneMain(b)) continue;                 // same-band link routes its own way
      const up = laneMain(a) < laneMain(b) ? a : b, dn = up === a ? b : a;
      const gk = Math.round(laneMain(up)) + ">" + Math.round(laneMain(dn));
      let m = gapBuses.get(gk); if (!m) { m = new Map(); gapBuses.set(gk, m); }
      m.set(laneKey(up), up);
    }
  });
  const channelY = new Map();
  gapBuses.forEach((busMap, gk) => {
    const [um, dm] = gk.split(">").map(Number);
    const mid = (um + dm) / 2;
    const room = Math.abs(dm - um) - 2 * halfMainNode;           // clear space between the two rows
    const buses = [...busMap.values()].sort((p, q) => (horiz ? p.y - q.y : p.x - q.x));
    const k = buses.length;
    const step = k > 1 ? Math.min(18, Math.max(0, room - 10) / (k - 1)) : 0;   // clear vertical gap between lanes so converging owner lines read as separate
    buses.forEach((p, i) => channelY.set(laneKey(p), mid + (i - (k - 1) / 2) * step));
  });
  const channelOf = (p, q) => {
    const up = laneMain(p) < laneMain(q) ? p : q;
    const v = channelY.get(laneKey(up));
    return v != null ? v : (laneMain(p) + laneMain(q)) / 2;
  };
  // A run's coordinate along the band-stacking axis (its length) and across it (its
  // column). A band-traversing run — a long edge's drop, a box's exit/entry stub —
  // holds a near-constant cross while its main sweeps between bands; these are the
  // runs that can lie collinear on top of each other.
  const mainC = (p) => (horiz ? p.x : p.y);
  const crossC = (p) => (horiz ? p.y : p.x);
  const isDrop = (a, b) => Math.abs(crossC(a) - crossC(b)) < 0.5 && Math.abs(mainC(a) - mainC(b)) > 1;
  const updateEdges = () => {
    // Pass 1: route every edge orthogonally (owner → owned through box centres and any
    // dummy waypoints, each owner on its own lane) and keep its point list.
    edgeRefs.forEach((er) => {
      const chain = [center(er.from), ...er.wp, center(er.to)];
      er.pts = relOrtho(chain, horiz, channelOf, entryCrossFor(er)).pts || [];
    });
    // Pass 1.5: no two owners' lines may lie on top of each other. A single owner's
    // lines sharing one trunk down a column is fine (an intentional bus); but where a
    // long edge's drop runs collinear with a DIFFERENT owner's vertical — e.g. an
    // owner two bands up dropping straight down a column that another owner's box
    // already exits — the two read as one line. Only a long edge's INTERIOR drop is
    // free to move (its own box stub and its cap-slice entry stay anchored so the
    // arrow still lands on the right owner's slice); shift it one lane off the shadowed
    // column and let its horizontal jogs absorb the offset, so the lines separate.
    const LANE = 16;
    const dropsOf = (er, ei) => {
      const out = [];
      for (let i = 0; i < er.pts.length - 1; i++) {
        if (isDrop(er.pts[i], er.pts[i + 1])) out.push({ ei, i, from: er.from, col: crossC(er.pts[i]), m0: Math.min(mainC(er.pts[i]), mainC(er.pts[i + 1])), m1: Math.max(mainC(er.pts[i]), mainC(er.pts[i + 1])) });
      }
      return out;
    };
    const allDrops = edgeRefs.flatMap((er, ei) => dropsOf(er, ei));
    edgeRefs.forEach((er, ei) => {
      for (let i = 1; i < er.pts.length - 2; i++) {              // interior drops only — skip the box stubs at either end
        const a = er.pts[i], b = er.pts[i + 1];
        if (!isDrop(a, b)) continue;
        const col = crossC(a), m0 = Math.min(mainC(a), mainC(b)), m1 = Math.max(mainC(a), mainC(b));
        const clash = allDrops.some((d) => d.ei !== ei && d.from !== er.from && Math.abs(d.col - col) < 2 && Math.min(d.m1, m1) - Math.max(d.m0, m0) > 3);
        if (!clash) continue;
        const dir = Math.sign(crossC(er.pts[er.pts.length - 1]) - col) || 1;   // step toward this edge's own entry side
        const nc = col + dir * LANE;
        if (horiz) { a.y = nc; b.y = nc; } else { a.x = nc; b.x = nc; }         // jogs at P[i-1]→P[i] and P[i+1]→P[i+2] follow the shifted column
      }
    });
    // Collect the perpendicular runs (verticals in a vertical layout) each edge could
    // be hopped over: constant coordinate `c`, span `[s0,s1]`, tagged by edge index.
    const crossers = [];
    edgeRefs.forEach((er, ei) => {
      for (let i = 0; i < er.pts.length - 1; i++) {
        const a = er.pts[i], b = er.pts[i + 1];
        const perp = horiz ? Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 1
                           : Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 1;
        if (perp) crossers.push({ ei, c: horiz ? a.y : a.x, s0: Math.min(horiz ? a.x : a.y, horiz ? b.x : b.y), s1: Math.max(horiz ? a.x : a.y, horiz ? b.x : b.y) });
      }
    });
    // Pass 2: draw each edge, bridging its gap-spanning runs over other edges' runs.
    edgeRefs.forEach((er, ei) => {
      if (!er.pts.length) { er.path.setAttribute("d", ""); return; }
      er.path.setAttribute("d", relHopPath(er.pts, crossers.filter((v) => v.ei !== ei), horiz));
    });
  };

  nodes.forEach((n) => {
    const o = REL_STYLE[n.sk];
    const top = n.cy - NODE_H / 2;
    const interactive = Boolean(n.href);
    const cap = caps[n.id];
    // Speak the ownership split to assistive tech — otherwise only in hover
    // <title>s, which never fire on touch (iPad Safari).
    const ownDesc = cap && cap.length
      ? " Owned by " + cap.map((c) => { const ow = byId.get(c.ownerId); return `${ow ? ow.name : "an owner"} ${c.pct}%`; }).join(", ") + "."
      : "";
    const g = s("g", interactive
      ? { class: "k-relnode k-relnode--link", tabindex: "0", role: "link", "aria-label": `Open ${n.name}.${ownDesc}` }
      : { class: "k-relnode k-relnode--static", role: "img", "aria-label": `${n.name} (sample).${ownDesc}` });
    const dim = nodeDim(n.id);
    if (dim) g.setAttribute("opacity", dim);
    g.appendChild(s("rect", { x: n.x, y: top, width: NODE_W, height: NODE_H, rx: 18, fill: o.fill, stroke: o.stroke || "none", "stroke-width": o.stroke ? "1.5" : "0" }));
    // Owners/controllers show as a header at the TOP of the box — right under the
    // incoming arrow — so what it says about is unmistakable. That pushes the entity's
    // own identity down. A root (nothing points at it) has no header, so it keeps its
    // identity at the top; layer 0 is all roots and every deeper layer is owned, so a
    // row stays vertically consistent.
    const hasOwn = Boolean(cap && cap.length);
    const yoff = hasOwn ? 26 : 0;
    const ax = n.x + 34, avy = top + 30 + yoff;
    g.appendChild(s("circle", { cx: ax, cy: avy, r: 17, fill: o.avFill }));
    g.appendChild(svgText((n.initials || "").slice(0, 2), { x: ax, y: avy + 5, "text-anchor": "middle", "font-size": "13", "font-weight": "800", fill: o.avText, "font-family": FD, class: "k-relav" }));
    g.appendChild(svgText(n.name, { x: ax + 28, y: top + 26 + yoff, "font-size": "13", "font-weight": "700", fill: o.nameFill, "font-family": FD, class: "k-relname" }));
    g.appendChild(svgText(entityMapSub(n), { x: ax + 28, y: top + 41 + yoff, "font-size": "11", "font-weight": "600", fill: o.subFill, "font-family": FS, class: "k-relsub" }));

    // Asset markers: the red type icon for each asset this entity holds — no
    // circle backdrop, full name on hover. Icons flow left→right and wrap onto as
    // many rows as fit inside the box, so we show every asset when there's room;
    // only a genuine overflow (more than the box holds) collapses to a "+N".
    const owned = relView.chips ? (n.assetNames || []) : [];
    const ownedIcons = n.assetIcons || [];
    if (owned.length) {
      const sz = 18, stepX = 21, stepY = 21, x0 = n.x + 24, y0 = top + 66 + yoff;
      const perRow = Math.max(1, Math.floor((NODE_W - 48) / stepX) + 1);
      const maxRows = Math.max(1, Math.floor((NODE_H - 14 - (y0 - top)) / stepY) + 1);
      const capacity = perRow * maxRows;
      const overflow = owned.length > capacity;
      const shown = overflow ? capacity - 1 : owned.length;
      const cellCX = (i) => x0 + (i % perRow) * stepX;
      const cellCY = (i) => y0 + Math.floor(i / perRow) * stepY;
      for (let i = 0; i < shown; i++) {
        const grp = s("g", {});
        const ic = icon(ownedIcons[i] || "shield", { size: sz, class: "k-relassetic" });
        ic.setAttribute("x", cellCX(i) - sz / 2);
        ic.setAttribute("y", cellCY(i) - sz / 2);
        const ti = s("title", {}); ti.textContent = owned[i]; grp.appendChild(ic); grp.appendChild(ti);
        g.appendChild(grp);
      }
      if (overflow) {
        const grp = s("g", {});
        grp.appendChild(svgText("+" + (owned.length - shown), { x: cellCX(shown), y: cellCY(shown) + 4, "text-anchor": "middle", "font-size": "11", "font-weight": "800", "font-family": FS, class: "k-relassetmore" }));
        const ti = s("title", {}); ti.textContent = owned.slice(shown).join(", "); grp.appendChild(ti);
        g.appendChild(grp);
      }
    }

    // Cap-table bar: the entity's ownership split as one bar summing to 100%, each
    // segment coloured by its owner's type and labelled with the owner's initials.
    // Hairline separators keep same-colour neighbours distinct; a shortfall shows
    // as the faint unfilled remainder. Sits in the header, just under the arrow.
    if (capBars[n.id]) {
      // One bar summing to 100%, each segment coloured by its owner's type and
      // labelled with the owner's initials; geometry comes from capBars so the arrows
      // land on the right slices. A shortfall shows as the faint unfilled remainder.
      const { barX, barW, segs } = capBars[n.id];
      const barY = top + 10, barH = 16;
      const clipId = "relcap-" + n.id.replace(/[^a-z0-9]/gi, "");
      g.appendChild(s("defs", {}, [s("clipPath", { id: clipId }, [s("rect", { x: barX, y: barY, width: barW, height: barH, rx: 8 })])]));
      const barG = s("g", { "clip-path": `url(#${clipId})` });
      barG.appendChild(s("rect", { x: barX, y: barY, width: barW, height: barH, fill: "#EEF2FB" }));
      segs.forEach((sg, i) => {
        const owner = byId.get(sg.ownerId);
        const pill = relPill(owner ? owner.sk : "person");
        if (i > 0) barG.appendChild(s("rect", { x: sg.x - 0.75, y: barY, width: 1.5, height: barH, fill: "#ffffff" }));
        const rect = s("rect", { x: sg.x, y: barY, width: sg.w, height: barH, fill: pill.bg });
        const ti = s("title", {}); ti.textContent = `${owner ? owner.name : "Owner"} — ${sg.pct}%`; rect.appendChild(ti);
        barG.appendChild(rect);
        // Prefer the full "II pct%"; when the slice is too narrow keep the OWNER's
        // initials (who owns the slice is the point of the bar — the exact percent is
        // on hover) rather than dropping to a bare, ownerless number.
        const initials = owner ? owner.initials : "?";
        const full = `${initials} ${sg.pct}%`;
        const wide = sg.w >= full.length * 5.4;
        const label = wide ? full : (sg.w >= 16 ? initials : "");
        if (label) barG.appendChild(svgText(label, { x: sg.center, y: barY + 11, "text-anchor": "middle", "font-size": wide ? "9.5" : "9", "font-weight": "800", fill: pill.fg, "font-family": FS }));
      });
      g.appendChild(barG);
    }

    // Opening: a tap/click is resolved by the viewport pan controller via data-href
    // (so a drag never counts as a tap); Enter/Space opens via the keyboard.
    if (interactive) {
      g.setAttribute("data-href", n.href);
      g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); location.hash = n.href; } });
    }

    svg.appendChild(g);
  });

  updateEdges();

  const wrap = el("div", { class: "k-relmap" }, [svg]);
  // On-map zoom control (bottom-right). stopPropagation on the group's pointerdown
  // keeps a button press from also starting a background pan; stopping the click
  // too keeps it from reaching the wrapper's delegated handler, which would
  // otherwise navigate to the last-pressed entity (a stale pressNode) on +/−.
  const zoomOut = el("button", { class: "k-relzoom__b", attrs: { type: "button", "aria-label": "Zoom out" }, text: "−" });
  const zoomIn = el("button", { class: "k-relzoom__b", attrs: { type: "button", "aria-label": "Zoom in" }, text: "+" });
  zoomOut.addEventListener("click", () => { if (wrap.__relzoom) wrap.__relzoom(-1); });
  zoomIn.addEventListener("click", () => { if (wrap.__relzoom) wrap.__relzoom(1); });
  const zoomCtl = el("div", { class: "k-relzoom", attrs: { role: "group", "aria-label": "Zoom" } }, [zoomIn, zoomOut]);
  zoomCtl.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  zoomCtl.addEventListener("click", (ev) => ev.stopPropagation());
  wrap.appendChild(zoomCtl);
  // The true bounding box of the NODES (not the declared canvas, which includes
  // edge-routing overshoot) so the map can open centred on the actual graph.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    const p = pos[n.id]; if (!p) return;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + NODE_W);
    minY = Math.min(minY, p.cy - NODE_H / 2); maxY = Math.max(maxY, p.cy + NODE_H / 2);
  });
  const bounds = isFinite(minX) ? { x: minX - 8, y: minY - 8, w: (maxX - minX) + 16, h: (maxY - minY) + 16 } : null;
  setupRelViewport(wrap, svg, W, H, bounds);
  return wrap;
}

// A segmented toggle: one button per option, the active one pressed. The active
// value is tracked here and every button's is-on/aria-pressed is refreshed on each
// pick, so the control stays reversible even though only the chart (not the
// toolbar) redraws on a change.
function relSeg(current, opts, onPick) {
  const seg = el("div", { class: "k-seg", attrs: { role: "group" } });
  let active = current;
  const btns = opts.map((o) => {
    const b = el("button", { class: "k-seg__b", attrs: { type: "button" } }, [el("span", { text: o.label })]);
    b.addEventListener("click", () => {
      if (o.val === active) return;
      active = o.val; sync(); onPick(o.val);
    });
    return { b, val: o.val };
  });
  const sync = () => btns.forEach(({ b, val }) => {
    const on = val === active;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  btns.forEach(({ b }) => seg.appendChild(b));
  sync();
  return seg;
}
// A labelled checkbox declutter toggle.
function relCheck(labelText, checked, onToggle) {
  const input = el("input", { attrs: Object.assign({ type: "checkbox" }, checked ? { checked: "checked" } : {}) });
  input.addEventListener("change", () => onToggle(input.checked));
  return el("label", { class: "k-relchk" }, [input, el("span", { text: labelText })]);
}
// The perspective toolbar above the map. Each control mutates relView and redraws
// the chart (drawMap); "Fit to screen" recentres the current chart without a redraw.
function relToolbar(drawMap, host) {
  const set = (patch) => { Object.assign(relView, patch); drawMap(); };
  const group = (labelText, control) => el("div", { class: "k-reltool" }, [el("span", { class: "k-reltool__lbl", text: labelText }), control]);

  const orient = relSeg(relView.orient, [{ val: "vertical", label: "Vertical" }, { val: "horizontal", label: "Horizontal" }], (v) => set({ orient: v }));
  const mode = relSeg(relView.mode, [{ val: "ownership", label: "Ownership" }, { val: "type", label: "By type" }], (v) => set({ mode: v }));

  const sel = el("select", { class: "k-relsel", attrs: { "aria-label": "Focus on one entity" } }, [
    el("option", { attrs: { value: "" }, text: "Everyone" }),
    ...getMapData().nodes.slice().sort((a, b) => a.name.localeCompare(b.name)).map((n) =>
      el("option", { attrs: Object.assign({ value: n.id }, relView.focus === n.id ? { selected: "selected" } : {}), text: n.name })),
  ]);
  sel.addEventListener("change", () => set({ focus: sel.value || null }));

  const fit = el("button", { class: "k-relbtn", attrs: { type: "button" } }, [el("span", { text: "Fit to screen" })]);
  fit.addEventListener("click", () => { const w = host.querySelector(".k-relmap"); if (w && w.__relfit) w.__relfit(); });

  return el("div", { class: "k-reltools", attrs: { role: "toolbar", "aria-label": "Chart view controls" } }, [
    group("Layout", orient),
    group("Arrange", mode),
    group("Focus", sel),
    group("Show", el("div", { class: "k-relchks" }, [
      relCheck("Assets", relView.chips, (v) => set({ chips: v })),
    ])),
    fit,
  ]);
}

export { relationshipMap, relToolbar };
