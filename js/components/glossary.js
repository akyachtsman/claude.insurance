// glossary.js — inline term explanations. Renders text with known glossary terms
// wrapped as accessible, tap/focus-toggle buttons that reveal a small definition.
// textContent only (no innerHTML).

import { el } from "../dom.js";

let openPopover = null;

// Build a text fragment where any glossary term (case-insensitive, whole word) is
// wrapped in a .glossary-term button. `glossary` is { term: definition }.
export function withGlossary(text, glossary) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const terms = Object.keys(glossary || {});
  if (!terms.length) { frag.appendChild(document.createTextNode(text)); return frag; }

  // Match the longest terms first to avoid partial overlaps.
  const sorted = terms.sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp(`\\b(${sorted.join("|")})\\b`, "gi");

  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const key = lookupKey(glossary, m[0]);
    frag.appendChild(key ? termButton(m[0], glossary[key]) : document.createTextNode(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function termButton(label, definition) {
  const wrap = el("span", { class: "glossary" });
  const btn = el("button", {
    class: "glossary-term",
    text: label,
    attrs: { type: "button", "aria-expanded": "false" },
  });
  const pop = el("span", { class: "glossary-pop", text: definition, attrs: { role: "tooltip" } });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains("is-open");
    closeOpen();
    if (!isOpen) {
      wrap.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      openPopover = wrap;
    }
  });
  wrap.appendChild(btn);
  wrap.appendChild(pop);
  return wrap;
}

function closeOpen() {
  if (openPopover) {
    openPopover.classList.remove("is-open");
    const b = openPopover.querySelector(".glossary-term");
    if (b) b.setAttribute("aria-expanded", "false");
    openPopover = null;
  }
}

// Dismiss on outside click / Escape (registered once).
if (typeof document !== "undefined") {
  document.addEventListener("click", closeOpen);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOpen(); });
}

function lookupKey(glossary, word) {
  const lower = word.toLowerCase();
  return Object.keys(glossary).find((k) => k.toLowerCase() === lower);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
