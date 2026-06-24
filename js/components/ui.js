// ui.js — shared Expressive-Mode building blocks used across views.
// All text via el()/textContent; vector art via the s() SVG helper. No innerHTML.

import { el } from "../dom.js";
import { icon, iconBadge } from "../icons.js";
import { s } from "../svg.js";

// Eyebrow label with optional leading icon.
export function eyebrow(text, iconName) {
  return el("p", { class: "eyebrow" }, [
    iconName ? icon(iconName, { size: 16 }) : null,
    el("span", { text }),
  ]);
}

// Section header: eyebrow + title + optional lede. opts.center centers it.
export function sectionHead({ eyebrow: eb, ebIcon, title, lede, center } = {}) {
  return el("header", { class: `section-head${center ? " section-head--center" : ""} reveal` }, [
    eb ? eyebrow(eb, ebIcon) : null,
    el("h2", { class: "section-head__title", text: title }),
    lede ? el("p", { class: "lede", text: lede }) : null,
  ]);
}

// Primary CTA anchor with a trailing arrow.
export function ctaLink(text, href, opts = {}) {
  return el("a", {
    class: `btn ${opts.variant || "btn-primary"}${opts.size ? " " + opts.size : ""}`,
    attrs: { href },
  }, [el("span", { text }), opts.noArrow ? null : icon("arrow-right", { size: 20 })]);
}

// The recurring trust strip: anonymous · no data sale · lead not a quote.
export function trustStrip() {
  return el("div", { class: "trust-strip reveal" }, [
    iconBadge("lock", { lg: true }),
    el("p", {}, [
      el("strong", { text: "Anonymous, and a lead — not a quote. " }),
      el("span", {
        text:
          "Browse and answer without signing in. We never sell your data. Finishing the " +
          "guide creates a summary for a licensed broker to follow up — not a price or a bound policy.",
      }),
    ]),
  ]);
}

// A closing call-to-action band (deep variant).
export function ctaBand({ title, body, cta, href }) {
  return el("section", { class: "band band--deep" }, [
    el("div", { class: "container cta-band__inner reveal" }, [
      el("div", { class: "cta-band__copy" }, [
        el("h2", { class: "cta-band__title", text: title }),
        body ? el("p", { class: "u-mt-sm", text: body }) : null,
      ]),
      ctaLink(cta, href, { size: "btn-lg" }),
    ]),
  ]);
}

// Hero illustration — an owned, geometric inline-SVG composition (shield + home +
// floating covered-items), colored from the slate-blue palette.
export function heroArt() {
  const svg = s("svg", { viewBox: "0 0 480 420", role: "img", "aria-label": "Illustration of protected home and belongings" });

  const defs = s("defs", {}, [
    s("linearGradient", { id: "g-shield", x1: "0", y1: "0", x2: "0", y2: "1" }, [
      s("stop", { offset: "0", "stop-color": "#6C4BF5" }),
      s("stop", { offset: "1", "stop-color": "#46C2FF" }),
    ]),
    s("linearGradient", { id: "g-blob", x1: "0", y1: "0", x2: "1", y2: "1" }, [
      s("stop", { offset: "0", "stop-color": "#EFEAFE" }),
      s("stop", { offset: "1", "stop-color": "#FBEAF5" }),
    ]),
  ]);
  svg.appendChild(defs);

  // Soft background blob.
  svg.appendChild(s("path", {
    d: "M250 30c80 0 150 40 178 110 28 70 6 150-44 196-50 46-140 64-214 40C96 352 40 300 30 232 18 150 60 70 132 42c40-15 78-12 118-12z",
    fill: "url(#g-blob)",
  }));

  // Floating "covered item" chips (rounded rects with check marks).
  const chip = (x, y, name) => s("g", { transform: `translate(${x} ${y})` }, [
    s("rect", { x: 0, y: 0, width: 96, height: 40, rx: 14, fill: "#FFFFFF", stroke: "#ECE7FB", "stroke-width": "1.5" }),
    s("circle", { cx: 22, cy: 20, r: 11, fill: "#EFEAFE" }),
    useIcon(name, 14, 15, 13, "#5B3EE6"),
    s("rect", { x: 40, y: 13, width: 44, height: 5, rx: 2.5, fill: "#D7CEF6" }),
    s("rect", { x: 40, y: 23, width: 30, height: 5, rx: 2.5, fill: "#ECE7FB" }),
  ]);
  svg.appendChild(chip(20, 92, "auto"));
  svg.appendChild(chip(360, 150, "umbrella"));
  svg.appendChild(chip(338, 300, "life"));

  // Central shield.
  svg.appendChild(s("path", {
    d: "M240 96l84 34v58c0 56-37 96-84 110-47-14-84-54-84-110v-58z",
    fill: "url(#g-shield)",
  }));
  svg.appendChild(s("path", {
    d: "M240 96l84 34v58c0 56-37 96-84 110z",
    fill: "#4A2CC9", opacity: "0.35",
  }));

  // House inside the shield.
  svg.appendChild(s("g", { fill: "none", stroke: "#FFFFFF", "stroke-width": "6", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
    s("path", { d: "M204 196l36-30 36 30" }),
    s("path", { d: "M212 192v44h56v-44" }),
    s("path", { d: "M230 236v-22h20v22" }),
  ]));
  // Check seal.
  svg.appendChild(s("circle", { cx: 296, cy: 232, r: 22, fill: "#FFFFFF" }));
  svg.appendChild(s("path", { d: "M286 232l7 7 13-14", fill: "none", stroke: "#5B3EE6", "stroke-width": "5", "stroke-linecap": "round", "stroke-linejoin": "round" }));

  return svg;
}

// Small icon glyph drawn inline (for use inside the hero composition where <use>
// to the sprite would inherit the wrong color context). Minimal duplicate set.
function useIcon(name, x, y, size, color) {
  const g = s("g", { transform: `translate(${x} ${y})`, fill: "none", stroke: color, "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" });
  const paths = {
    auto: ["M1 8l1-3.4A1.6 1.6 0 0 1 3.6 3.4h5.8A1.6 1.6 0 0 1 11 4.6L12 8", "M1 8h12v2.4H1z"],
    umbrella: ["M6.5 1.5v1.6", "M2 6a4.5 4.5 0 0 1 9 0z", "M6.5 6v4.4a1.4 1.4 0 0 0 2.2 0"],
    life: ["M6.5 11S1 7.6 1 4.6A2.6 2.6 0 0 1 6.5 3a2.6 2.6 0 0 1 5.5 1.6C12 7.6 6.5 11 6.5 11z"],
  };
  for (const d of paths[name] || []) g.appendChild(s("path", { d }));
  return g;
}
