// icons.js — reference inline-SVG symbols from the sprite in index.html via <use>.
// One symbol per concept; coverage ids map 1:1 to symbol ids. No innerHTML.

import { s } from "./svg.js";

// Coverage ids that have a matching <symbol id="icon-{id}"> in the sprite.
const COVERAGE_ICONS = new Set([
  "home", "auto", "renters", "umbrella", "life", "flood",
  "bop", "general-liability", "commercial-property", "professional-liability",
  "workers-comp", "cyber", "commercial-auto", "commercial-umbrella",
]);

// Return an <svg> referencing #icon-<name>. Falls back to the shield mark.
export function icon(name, opts = {}) {
  const id = name || "shield";
  const size = opts.size || 24;
  const svg = s("svg", {
    class: ["icon", opts.class].filter(Boolean).join(" "),
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    focusable: "false",
  });
  const use = s("use");
  use.setAttribute("href", `#icon-${id}`);
  svg.appendChild(use);
  return svg;
}

// An icon wrapped in a rounded badge (the recurring concept marker).
export function iconBadge(name, opts = {}) {
  const wrap = document.createElement("span");
  wrap.className = ["icon-badge", opts.class].filter(Boolean).join(" ");
  wrap.appendChild(icon(name, { size: opts.iconSize || (opts.lg ? 30 : 24) }));
  return wrap;
}

export function coverageIcon(coverageId) {
  return COVERAGE_ICONS.has(coverageId) ? coverageId : "shield";
}
