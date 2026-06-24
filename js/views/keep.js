// views/keep.js — "The Keep" authenticated portal (Direction C, demo/stub).
// Renders login, dashboard (entities + nested assets), entity detail, add-asset,
// and the asset coverage-analysis page. STUB: sample data, no real auth — a
// demo ribbon makes that explicit. Routing lives in main.js (#/keep/*).

import { el, mount } from "../dom.js";
import { icon } from "../icons.js";
import { getRuleDefaults } from "../content.js";
import { SAMPLE, getEntity, findAsset, ASSET_META } from "../keep/data.js";
import { analyzeAsset, assetStatus, entitySummary } from "../keep/analysis.js";

// ── small helpers ────────────────────────────────────────────────────────────
function money(v) {
  if (!v) return "";
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(v % 1000000 ? 1 : 0) + "M";
  if (v >= 1000) return "$" + Math.round(v / 1000) + "K";
  return "$" + v;
}

function ribbon() {
  return el("div", { class: "k-ribbon" }, [
    icon("lock", { size: 15 }),
    el("span", { text: "Demo — sample data, no real login" }),
  ]);
}

function appBar(active) {
  const link = (label, href, key) =>
    el("a", { class: key === active ? "on" : "", attrs: { href } }, [el("span", { text: label })]);
  return el("header", { class: "k-bar" }, [
    el("div", { class: "k-bar__in" }, [
      el("a", { class: "k-brand", attrs: { href: "#/keep", "aria-label": "The Keep — dashboard" } }, [
        icon("shield", { size: 26, class: "k-mark" }),
        el("span", { text: "Harborline" }),
        el("span", { class: "k-tag", text: "The Keep" }),
      ]),
      el("nav", { class: "k-nav", attrs: { "aria-label": "Portal" } }, [
        link("Dashboard", "#/keep", "dashboard"),
        link("Entities", "#/keep", "entities"),
        link("Documents", "#/keep", "documents"),
      ]),
      el("div", { class: "k-bar__rt" }, [
        el("button", { class: "k-iconbtn", attrs: { type: "button", "aria-label": "Notifications" } }, [
          icon("bell", { size: 20 }), el("span", { class: "k-dot" }),
        ]),
        el("span", { class: "k-av", text: SAMPLE.user.initials }),
      ]),
    ]),
  ]);
}

function page(active, contentChildren, opts = {}) {
  const wrapClass = `k-wrap${opts.narrow ? " k-wrap--narrow" : ""}`;
  return el("div", {}, [ribbon(), appBar(active), el("div", { class: wrapClass }, contentChildren)]);
}

function cic(asset) {
  const meta = ASSET_META[asset.type] || { cic: "home", icon: "shield" };
  return el("span", { class: `k-cic k-cic--${meta.cic}` }, [icon(meta.icon, { size: 28 })]);
}

function statusPill(st) {
  return el("span", { class: `k-pill k-pill--${st.cls}` }, [icon(st.icon, { size: 15 }), el("span", { text: st.label })]);
}

function coveragePill(status) {
  if (status === "in-place") return el("span", { class: "k-pill k-pill--ok" }, [icon("check", { size: 15 }), el("span", { text: "In place" })]);
  if (status === "gap") return el("span", { class: "k-pill k-pill--gap" }, [icon("alert", { size: 15 }), el("span", { text: "Gap" })]);
  return el("span", { class: "k-pill k-pill--rec" }, [icon("spark", { size: 15 }), el("span", { text: "Suggested" })]);
}

function assetCard(asset, settings) {
  const st = assetStatus(asset, settings);
  return el("a", { class: "k-cc", attrs: { href: `#/keep/asset/${asset.id}` } }, [
    cic(asset),
    el("div", { class: "k-cc__main" }, [
      el("div", { class: "k-cc__name", text: asset.name }),
      el("div", { class: "k-cc__meta", text: asset.meta }),
      statusPill(st),
    ]),
    el("div", { class: "k-cc__val", text: money(asset.value) }),
  ]);
}

function entityAvatar(entity) {
  if (entity.kind === "business") {
    return el("span", { class: "k-bigav k-bigav--biz" }, [icon(entity.icon || "briefcase", { size: 30 })]);
  }
  return el("span", { class: "k-bigav", text: entity.initials });
}

function entityHead(entity, settings, addHref) {
  const sum = entitySummary(entity, settings);
  const metaBits = entity.kind === "business"
    ? [entity.meta || "", `${sum.assets} assets`, `${sum.gaps} gap${sum.gaps === 1 ? "" : "s"}`]
    : [`${sum.assets} assets`, `${sum.inPlace} coverages in place`, `${sum.gaps} gap${sum.gaps === 1 ? "" : "s"}`];
  return el("div", { class: "k-ehead" }, [
    entityAvatar(entity),
    el("div", {}, [
      el("div", {}, [
        el("h1", { text: entity.name }),
        el("span", { class: `k-et${entity.kind === "business" ? " k-et--biz" : ""}`, text: entity.label }),
      ]),
      el("div", { class: "k-emeta" }, joinDots(metaBits)),
    ]),
    el("a", { class: "k-btn", attrs: { href: addHref } }, [icon("plus", { size: 18 }), el("span", { text: "Add asset" })]),
  ]);
}

// Interleave " · " separators as text nodes between meta spans.
function joinDots(bits) {
  const out = [];
  bits.filter(Boolean).forEach((b, i) => {
    if (i) out.push(el("span", { text: "  ·  " }));
    out.push(el("span", { text: b }));
  });
  return out;
}

function entityPanel(entity, settings) {
  const variant = entity.kind === "business" ? "k-panel--biz" : "k-panel--me";
  return el("section", { class: `k-panel ${variant}` }, [
    entityHead(entity, settings, "#/keep/add-asset"),
    el("div", { class: "k-lbl", text: "Assets in this entity" }),
    el("div", { class: "k-grid2" }, entity.assets.map((a) => assetCard(a, settings))),
  ]);
}

// ── views ────────────────────────────────────────────────────────────────────
export function renderKeepLogin() {
  const view = el("div", {}, [
    ribbon(),
    el("div", { class: "k-authwrap" }, [
      el("div", { class: "k-authcard" }, [
        el("div", { class: "k-bigshield" }, [icon("shield", { size: 34 })]),
        el("div", { class: "k-abrand" }, [el("span", { text: "Harborline" }), el("span", { class: "k-tag", text: "The Keep" })]),
        el("h1", { class: "k-atitle", text: "Welcome back" }),
        el("p", { class: "k-asub", text: "Log in to your Keep." }),
        el("label", { class: "k-fld" }, [el("span", { text: "Email" }), el("input", { attrs: { type: "email", value: "jordan.m@example.com" } })]),
        el("label", { class: "k-fld" }, [el("span", { text: "Password" }), el("input", { attrs: { type: "password", value: "demo-password" } })]),
        el("button", { class: "k-btn k-btn--block", attrs: { type: "button", "data-go": "/keep" } }, [el("span", { text: "Log in" }), icon("arrow-right", { size: 20 })]),
        el("p", { class: "k-ameta" }, [el("a", { text: "Forgot your password?" })]),
        el("p", { class: "k-secure" }, [icon("lock", { size: 16 }), el("span", { text: "Invite-only · accounts come from a broker invitation" })]),
      ]),
    ]),
  ]);
  mount(view);
}

export async function renderKeepDashboard() {
  const settings = await getRuleDefaults();
  const view = page("dashboard", [
    el("h1", { class: "k-h1", text: `Welcome back, ${SAMPLE.user.name.split(" ")[0]}` }),
    el("p", { class: "k-sub", text: "Your coverage, organized by entity." }),
    ...SAMPLE.entities.map((e) => entityPanel(e, settings)),
    el("button", { class: "k-addtile", attrs: { type: "button", "data-go": "/keep/add-asset" } }, [icon("plus", { size: 24 }), el("span", { text: "Add a business entity" })]),
  ]);
  mount(view);
}

export async function renderKeepEntity(params, id) {
  const entity = getEntity(id);
  if (!entity) return renderKeepDashboard();
  const settings = await getRuleDefaults();
  const variant = entity.kind === "business" ? "k-panel--biz" : "k-panel--me";
  const view = page("entities", [
    el("nav", { class: "k-crumbs" }, [el("a", { attrs: { href: "#/keep" }, text: "Entities" }), el("span", { text: "  ·  " }), el("span", { text: entity.name })]),
    el("section", { class: `k-panel ${variant}` }, [
      entityHead(entity, settings, "#/keep/add-asset"),
      el("div", { class: "k-lbl", text: "Assets in this entity" }),
      el("div", { class: "k-grid2" }, [
        ...entity.assets.map((a) => assetCard(a, settings)),
        el("button", { class: "k-addtile", attrs: { type: "button", "data-go": "/keep/add-asset" } }, [icon("plus", { size: 24 }), el("span", { text: "Add asset" })]),
      ]),
    ]),
  ]);
  mount(view);
}

export async function renderKeepAsset(params, id) {
  const found = findAsset(id);
  if (!found) return renderKeepDashboard();
  const { entity, asset } = found;
  const settings = await getRuleDefaults();
  const { mustHave, recommended, gaps } = analyzeAsset(asset, settings);

  const covRow = (c) => el("div", { class: `k-crow${c.status === "gap" ? " gap" : ""}` }, [
    el("span", { class: `k-cic k-cic--${ASSET_META[asset.type] ? ASSET_META[asset.type].cic : "home"}` }, [icon(c.icon, { size: 26 })]),
    el("div", { class: "k-crow__main" }, [
      el("div", { class: "k-crow__name", text: c.title }),
      el("div", { class: "k-crow__why", text: c.why }),
    ]),
    el("div", { class: "k-crow__r" }, [
      coveragePill(c.status),
      c.status === "gap" ? el("span", { class: "k-linklike", text: "Add to review →" }) : null,
    ]),
  ]);

  const sections = [
    el("nav", { class: "k-crumbs" }, [
      el("a", { attrs: { href: "#/keep" }, text: "Entities" }), el("span", { text: "  ·  " }),
      el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), el("span", { text: "  ·  " }),
      el("span", { text: asset.name }),
    ]),
    el("div", { class: "k-ahero" }, [
      el("span", { class: `k-cic k-cic--${ASSET_META[asset.type].cic}` }, [icon(ASSET_META[asset.type].icon, { size: 34 })]),
      el("div", {}, [
        el("h1", { text: asset.name }),
        el("div", { class: "k-facts" }, asset.facts.map((f) => el("span", { text: f })).concat(asset.value ? [el("span", {}, [el("span", { text: "Est. " }), el("b", { text: money(asset.value) })])] : [])),
      ]),
    ]),
  ];

  if (gaps > 0) {
    sections.push(el("div", { class: "k-banner k-banner--gap" }, [
      el("span", { class: "k-cic" }, [icon("alert", { size: 26 })]),
      el("div", {}, [
        el("h3", { text: `${gaps} gap${gaps > 1 ? "s" : ""} found on this asset` }),
        el("p", { text: "Recommended coverage that isn't in place yet. Share it with your broker to close the gaps." }),
      ]),
      el("button", { class: "k-btn", attrs: { type: "button" } }, [icon("chat", { size: 18 }), el("span", { text: "Share with broker" })]),
    ]));
  }

  if (mustHave.length) {
    sections.push(el("section", { class: "k-sec" }, [
      el("h2", { text: "Must have" }),
      el("p", { class: "k-sub2", text: "Core coverage this asset should carry" }),
      el("div", { class: "k-list" }, mustHave.map(covRow)),
    ]));
  }
  if (recommended.length) {
    sections.push(el("section", { class: "k-sec" }, [
      el("h2", { text: "Recommended" }),
      el("p", { class: "k-sub2", text: "Based on value, location and risk" }),
      el("div", { class: "k-list" }, recommended.map(covRow)),
    ]));
  }
  sections.push(el("div", { class: "k-disc" }, [
    el("span", { text: "This is educational guidance, " }),
    el("b", { text: "not a quote, price or bound policy" }),
    el("span", { text: ". Your licensed broker confirms what's available and what it costs." }),
  ]));

  mount(page("entities", sections, { narrow: true }));
}

const ASSET_CHOICES = [
  { type: "home", label: "Home or condo", sub: "You own and live here", icon: "home" },
  { type: "rental", label: "Rental property", sub: "You rent it to others", icon: "commercial-property" },
  { type: "vehicle", label: "Vehicle", sub: "Car, truck or motorcycle", icon: "auto" },
  { type: "watercraft", label: "Watercraft", sub: "Boat, jet ski or yacht", icon: "boat" },
  { type: "valuables", label: "Jewelry & valuables", sub: "Art, jewelry, collectibles", icon: "gem" },
  { type: "business", label: "Business", sub: "A company you own or run", icon: "briefcase" },
];

export function renderKeepAddAsset() {
  const view = page("entities", [
    el("div", { class: "k-progress" }, [
      el("div", { class: "k-progress__top" }, [
        el("a", { class: "k-back", attrs: { href: "#/keep" } }, [icon("arrow-right", { size: 18, class: "icon-flip" }), el("span", { text: "Back" })]),
        el("span", { class: "k-progress__text", text: "Step 1 of 3" }),
      ]),
      el("div", { class: "k-track" }, [el("i", { attrs: { style: "width:33%" } })]),
    ]),
    el("h1", { class: "k-h1", text: "What would you like to add?" }),
    el("p", { class: "k-sub", text: "Pick a type and we'll ask only what's needed, then analyze the coverage it should carry." }),
    el("div", { class: "k-choices" }, ASSET_CHOICES.map((c) =>
      el("button", { class: "k-choice", attrs: { type: "button", "data-go": "/keep" } }, [
        el("span", { class: "k-cic" }, [icon(c.icon, { size: 26 })]),
        el("span", { class: "k-choice__label" }, [el("span", { text: c.label }), el("small", { text: c.sub })]),
        icon("arrow-right", { size: 22, class: "k-choice__arrow" }),
      ])
    )),
  ], { narrow: true });
  mount(view);
}
