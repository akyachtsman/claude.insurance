// svg.js — tiny helpers for building inline SVG via createElementNS.
// Keeps the no-innerHTML rule (global.md) intact for author-owned vector art.

export const SVGNS = "http://www.w3.org/2000/svg";

// Build an SVG element node. attrs are set verbatim; children appended in order.
export function s(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}
