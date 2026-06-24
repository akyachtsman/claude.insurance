// views/keep.js — "The Keep" authenticated portal (Direction C, demo/stub).
// Renders login, dashboard (entities + nested assets), entity detail, add-asset,
// and the asset coverage-analysis page. STUB: sample data, no real auth — a
// demo ribbon makes that explicit. Routing lives in main.js (#/keep/*).

import { el, mount } from "../dom.js";
import { icon } from "../icons.js";
import { getRuleDefaults } from "../content.js";
import { SAMPLE, getEntity, findAsset, findPolicy, ASSET_META } from "../keep/data.js";
import { analyzeAsset, assetStatus, entitySummary } from "../keep/analysis.js";
import { policyKind, reminderInfo, REMINDER_SCHEDULE } from "../keep/policies.js";

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

// One-level-up affordance shown at the top of each drill-down level.
function backLink(href, label) {
  return el("div", { class: "k-backrow" }, [
    el("a", { class: "k-back", attrs: { href } }, [
      icon("arrow-right", { size: 18, class: "icon-flip" }),
      el("span", { text: `Back to ${label}` }),
    ]),
  ]);
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateFromDays(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function dateShort(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function expiryBadge(renewalInDays) {
  const kind = policyKind(renewalInDays);
  if (kind === "exp") return el("span", { class: "k-exp k-exp--exp" }, [icon("x", { size: 14 }), el("span", { text: `Expired ${dateShort(renewalInDays)}` })]);
  if (kind === "warn") return el("span", { class: "k-exp k-exp--warn" }, [icon("alert", { size: 14 }), el("span", { text: `Expires in ${renewalInDays} day${renewalInDays === 1 ? "" : "s"} · ${dateShort(renewalInDays)}` })]);
  return el("span", { class: "k-exp k-exp--ok" }, [icon("check", { size: 14 }), el("span", { text: `Active · renews ${dateFromDays(renewalInDays)}` })]);
}

function policySummaryCard(policy) {
  const kind = policyKind(policy.renewalInDays);
  const cls = kind === "exp" ? " lapsed" : (kind === "warn" ? " exp" : "");
  const chips = policy.coverages.slice(0, 3).map((c) => el("span", { class: "pill", text: `${c.label} ${c.limit}` }));
  return el("a", { class: `k-pcard${cls}`, attrs: { href: `#/keep/policy/${policy.id}` } }, [
    el("div", { class: "k-pcard__head" }, [
      el("span", { class: `k-cic k-cic--${policy.cic}` }, [icon(policy.icon, { size: 24 })]),
      el("div", { class: "k-pcard__t" }, [
        el("div", { class: "k-pcard__line", text: policy.line }),
        el("div", { class: "k-pcard__sub", text: `${policy.carrier} · ${policy.number}` }),
      ]),
      expiryBadge(policy.renewalInDays),
    ]),
    el("div", { class: "k-pcard__foot" }, [
      el("div", { class: "k-pcard__chips" }, chips),
      el("span", { class: "k-pcard__view", text: "View policy →" }),
    ]),
  ]);
}

function policiesSection(asset) {
  const items = [
    el("div", { class: "k-remind" }, [
      el("span", { class: "k-cic" }, [icon("bell", { size: 22 })]),
      el("p", {}, [el("b", { text: "Renewal reminders are on. " }), el("span", { text: `We email ${SAMPLE.user.name.split(" ")[0]} ${REMINDER_SCHEDULE.join(", ")} days before each policy's renewal date.` })]),
    ]),
    el("p", { class: "k-maint" }, [icon("lock", { size: 16 }), el("span", { text: "Policies maintained by your broker (Rosa Alvarez)" })]),
  ];
  if (!asset.policies || !asset.policies.length) {
    items.push(el("div", { class: "k-empty", text: "No policies on file — ask your broker to add one." }));
  } else {
    asset.policies.forEach((p) => items.push(policySummaryCard(p)));
  }
  return el("section", { class: "k-sec" }, [
    el("h2", { text: "Policies on file" }),
    el("p", { class: "k-sub2", text: "What's on record, with limits and renewal dates" }),
    ...items,
  ]);
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
    backLink("#/keep", "dashboard"),
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
    backLink(`#/keep/entity/${entity.id}`, entity.name),
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

  sections.push(policiesSection(asset));

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

export function renderKeepPolicy(params, id) {
  const found = findPolicy(id);
  if (!found) return renderKeepDashboard();
  const { entity, asset, policy } = found;
  const kind = policyKind(policy.renewalInDays);
  const statusLabel = kind === "exp" ? (policy.billingStatus === "Lapsed" ? "Lapsed" : "Expired")
    : (kind === "warn" ? "Expiring soon" : "Active");
  const rinfo = reminderInfo(policy.renewalInDays);

  const grp = (ic, title, inner) => el("div", { class: "k-grp" }, [
    el("div", { class: "k-grp__h" }, [icon(ic, { size: 15 }), el("span", { text: title })]),
    inner,
  ]);
  const pg = (rows) => el("dl", { class: "k-pg" }, rows.map(([dt, dd]) =>
    el("div", {}, [el("dt", { text: dt }), el("dd", { text: dd })])));
  const chips = (items) => el("div", { class: "k-pcard__chips" }, items.map((c) => el("span", { class: "pill", text: c })));

  const covt = el("div", { class: "k-covt" }, policy.coverages.map((c) => {
    const amt = c.recommended
      ? el("span", { class: "amt" }, [el("span", { text: c.limit }), el("small", { text: `Recommended ${c.recommended} — underinsured` })])
      : el("span", { class: "amt", text: c.limit });
    return el("div", { class: "r" }, [
      el("span", { class: "lbl" }, [c.tag && c.tag !== "—" ? el("b", { text: c.tag }) : null, el("span", { text: c.label })]),
      amt,
    ]);
  }));

  const sections = [
    backLink(`#/keep/asset/${asset.id}`, asset.name),
    el("nav", { class: "k-crumbs" }, [
      el("a", { attrs: { href: "#/keep" }, text: "Entities" }), el("span", { text: "  ·  " }),
      el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), el("span", { text: "  ·  " }),
      el("a", { attrs: { href: `#/keep/asset/${asset.id}` }, text: asset.name }), el("span", { text: "  ·  " }),
      el("span", { text: "Policy" }),
    ]),
    el("div", { class: "k-phead" }, [
      el("span", { class: `k-cic k-cic--${policy.cic}` }, [icon(policy.icon, { size: 30 })]),
      el("div", { class: "k-phead__t" }, [
        el("h1", { text: policy.line }),
        el("div", { class: "sub", text: `${policy.carrier} · NAIC ${policy.naic}` }),
      ]),
      expiryBadge(policy.renewalInDays),
    ]),
    el("p", { class: "k-maint" }, [icon("lock", { size: 16 }), el("span", { text: `Maintained by your broker (${policy.agent})` })]),
    grp("clipboard", "Policy", pg([
      ["Policy number", policy.number], ["Policy form", policy.form], ["Status", statusLabel],
      ["Effective", dateFromDays(policy.effectiveInDays)], ["Expires / renews", dateFromDays(policy.renewalInDays)], ["Auto-renew", policy.autoRenew ? "On" : "Off"],
      ["Named insured", policy.namedInsured], ["Agent of record", policy.agent], ["Agent contact", policy.agentContact],
    ])),
  ];

  if (policy.details && policy.details.length) {
    sections.push(grp(ASSET_META[asset.type] ? ASSET_META[asset.type].icon : "home", "Insured item", pg(policy.details)));
  }

  const covInner = el("div", {}, [covt]);
  if (policy.endorsements && policy.endorsements.length) {
    covInner.appendChild(el("div", { class: "k-grp__h mt" }, [icon("spark", { size: 15 }), el("span", { text: "Endorsements / riders" })]));
    covInner.appendChild(chips(policy.endorsements));
  }
  sections.push(grp("shield", "Coverages & limits", covInner));

  if (policy.deductibles && policy.deductibles.length) {
    sections.push(grp("flood", "Deductibles", pg(policy.deductibles)));
  }

  const billInner = el("div", {}, [pg([["Annual premium", policy.premium], ["Payment plan", policy.paymentPlan], ["Billing status", policy.billingStatus]])]);
  if (policy.discounts && policy.discounts.length) {
    billInner.appendChild(el("div", { class: "k-grp__h mt" }, [icon("spark", { size: 15 }), el("span", { text: "Discounts applied" })]));
    billInner.appendChild(chips(policy.discounts));
  }
  sections.push(grp("briefcase", "Premium & billing", billInner));

  if (policy.interests && policy.interests.length) {
    sections.push(grp("handshake", "Mortgagee & interests", pg(policy.interests)));
  }

  const reminderText = ` Renewal reminders: ${REMINDER_SCHEDULE.join(" / ")} days before ${dateFromDays(policy.renewalInDays)}` +
    (rinfo.next ? ` · next at ${rinfo.next} days` : " · none upcoming");
  const docs = el("div", {}, [
    el("div", {}, (policy.documents || []).map((d) => el("span", { class: "k-doclink" }, [icon("doc", { size: 15 }), el("span", { text: d })]))),
    el("p", { class: "k-note" }, [el("b", { text: "Claims history: " }), el("span", { text: policy.claims || "None" })]),
    el("p", { class: "k-note" }, [icon("bell", { size: 14 }), el("span", { text: reminderText })]),
  ]);
  sections.push(grp("doc", "Documents & history", docs));

  mount(page("entities", sections, { narrow: true }));
}
