// views/keep.js — "The Keep" authenticated portal (Direction C, demo/stub).
// Renders login, dashboard (entities + nested assets), entity detail, add-asset,
// and the asset coverage-analysis page. STUB: sample data, no real auth — a
// demo ribbon makes that explicit. Routing lives in main.js (#/keep/*).

import { el, mount } from "../dom.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { getRuleDefaults } from "../content.js";
import { SAMPLE, getEntity, findAsset, findPolicy, ASSET_META } from "../keep/data.js";
import { analyzeAsset, assetStatus, entitySummary } from "../keep/analysis.js";
import { policyKind, reminderInfo, REMINDER_SCHEDULE } from "../keep/policies.js";

// In-memory reminder preferences (STUB — persisted to the user's profile once the
// backend is wired). Module singleton, so changes survive navigation in-session.
const reminderPrefs = { email: true, schedule: [...REMINDER_SCHEDULE] };
function activeSchedule() {
  return REMINDER_SCHEDULE.filter((d) => reminderPrefs.schedule.includes(d));
}

// Status banner shown on the policies list — reflects the saved preference and
// links to Settings (the controls live there, not here).
function reminderBanner() {
  if (!reminderPrefs.email || !activeSchedule().length) {
    return el("div", { class: "k-remind" }, [
      el("span", { class: "k-cic" }, [icon("bell", { size: 22 })]),
      el("p", {}, [el("b", { text: "Renewal reminders are off. " }), el("span", { text: "Turn them on in " }), el("a", { attrs: { href: "#/keep/account" }, text: "Settings" }), el("span", { text: "." })]),
    ]);
  }
  return el("div", { class: "k-remind" }, [
    el("span", { class: "k-cic" }, [icon("bell", { size: 22 })]),
    el("p", {}, [
      el("b", { text: "Renewal reminders are on. " }),
      el("span", { text: `We email ${SAMPLE.user.name.split(" ")[0]} ${activeSchedule().join(", ")} days before each renewal · ` }),
      el("a", { attrs: { href: "#/keep/account" }, text: "Manage" }),
    ]),
  ]);
}

// Interactive reminder-preference controls for the Account page.
function buildReminderSettings() {
  const chips = REMINDER_SCHEDULE.map((d) => {
    const chip = el("button", { class: `k-chiptog${reminderPrefs.schedule.includes(d) ? " on" : ""}`, attrs: { type: "button", "aria-pressed": String(reminderPrefs.schedule.includes(d)) } }, [el("span", { text: `${d} day${d === 1 ? "" : "s"}` })]);
    chip.addEventListener("click", () => {
      if (!reminderPrefs.email) return;
      const i = reminderPrefs.schedule.indexOf(d);
      if (i >= 0) reminderPrefs.schedule.splice(i, 1); else reminderPrefs.schedule.push(d);
      const on = reminderPrefs.schedule.includes(d);
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", String(on));
    });
    return chip;
  });
  const setChipsEnabled = (enabled) => chips.forEach((c) => { if (enabled) c.removeAttribute("disabled"); else c.setAttribute("disabled", "disabled"); });
  setChipsEnabled(reminderPrefs.email);

  const sw = el("button", { class: `k-switch${reminderPrefs.email ? " on" : ""}`, attrs: { type: "button", role: "switch", "aria-checked": String(reminderPrefs.email), "aria-label": "Email reminders" } }, [
    el("span", { class: "k-switch__track" }),
    el("span", { class: "k-switch__label", text: reminderPrefs.email ? "On" : "Off" }),
  ]);
  sw.addEventListener("click", () => {
    reminderPrefs.email = !reminderPrefs.email;
    sw.classList.toggle("on", reminderPrefs.email);
    sw.setAttribute("aria-checked", String(reminderPrefs.email));
    sw.querySelector(".k-switch__label").textContent = reminderPrefs.email ? "On" : "Off";
    setChipsEnabled(reminderPrefs.email);
  });

  return el("div", { class: "k-grp" }, [
    el("div", { class: "k-grp__h" }, [icon("bell", { size: 15 }), el("span", { text: "Renewal reminders" })]),
    el("div", { class: "k-setrow" }, [
      el("div", {}, [el("div", { class: "k-setrow__t", text: "Email reminders" }), el("div", { class: "k-setrow__s", text: "Get an email before each policy renews" })]),
      sw,
    ]),
    el("div", { class: "k-setlabel", text: "Remind me before each renewal at:" }),
    el("div", { class: "k-chiprow" }, chips),
    el("div", { class: "k-setrow" }, [
      el("div", {}, [el("div", { class: "k-setrow__t", text: "Send to" }), el("div", { class: "k-setrow__s", text: "jordan.m@example.com" })]),
    ]),
    el("p", { class: "k-setnote", text: "Changes apply across all your policies. (Saved to your profile once your account is live.)" }),
  ]);
}

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

// ── App-bar menus (click-to-open popovers) ───────────────────────────────────
function closeKeepMenus() {
  document.querySelectorAll(".k-pop.is-open").forEach((p) => {
    p.classList.remove("is-open");
    const t = p.querySelector("[aria-expanded]");
    if (t) t.setAttribute("aria-expanded", "false");
  });
}
if (typeof document !== "undefined" && !document.__keepMenusInit) {
  document.__keepMenusInit = true;
  document.addEventListener("click", (e) => { if (!e.target.closest(".k-pop")) closeKeepMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeKeepMenus(); });
}

function popover(trigger, panel, alignRight) {
  const wrap = el("div", { class: `k-pop${alignRight ? " k-pop--right" : ""}` });
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = !wrap.classList.contains("is-open");
    closeKeepMenus();
    if (open) { wrap.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true"); }
  });
  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  return wrap;
}

// Notifications come from policies that are expiring or lapsed (the renewal signal).
function buildNotifications() {
  const out = [];
  for (const ent of SAMPLE.entities)
    for (const a of ent.assets)
      for (const p of a.policies || []) {
        const k = policyKind(p.renewalInDays);
        if (k === "warn") out.push({ kind: "warn", text: `${p.line} expires in ${p.renewalInDays} days`, sub: `${a.name} · renew soon`, href: `#/keep/policy/${p.id}` });
        else if (k === "exp") out.push({ kind: "exp", text: `${p.line} has lapsed`, sub: `${a.name} · action needed`, href: `#/keep/policy/${p.id}` });
      }
  return out;
}

function notifMenu() {
  const items = buildNotifications();
  const trigger = el("button", { class: "k-iconbtn", attrs: { type: "button", "aria-label": `Notifications${items.length ? ` (${items.length})` : ""}` } },
    [icon("bell", { size: 20 }), items.length ? el("span", { class: "k-dot" }) : null]);
  const panel = el("div", { class: "k-menu k-notif" }, [
    el("div", { class: "k-notif__title", text: `Notifications${items.length ? ` · ${items.length}` : ""}` }),
    ...(items.length
      ? items.map((n) => el("a", { class: "k-notif__item", attrs: { href: n.href } }, [
          el("span", { class: `k-notif__dot k-notif__dot--${n.kind}` }, [icon("alert", { size: 16 })]),
          el("div", {}, [el("div", { class: "k-notif__txt", text: n.text }), el("div", { class: "k-notif__sub", text: n.sub })]),
        ]))
      : [el("div", { class: "k-notif__empty", text: "You're all caught up." })]),
  ]);
  return popover(trigger, panel, true);
}

function accountMenu() {
  const trigger = el("button", { class: "k-av k-av--btn", attrs: { type: "button", "aria-label": "Account menu" } }, [el("span", { text: SAMPLE.user.initials })]);
  const panel = el("div", { class: "k-menu" }, [
    el("div", { class: "k-menu__head" }, [
      el("span", { class: "k-av" }, [el("span", { text: SAMPLE.user.initials })]),
      el("div", {}, [
        el("div", { class: "k-menu__name", text: SAMPLE.user.name }),
        el("div", { class: "k-menu__email", text: "jordan.m@example.com" }),
      ]),
    ]),
    el("a", { attrs: { href: "#/keep/account" } }, [icon("user", { size: 18 }), el("span", { text: "Account settings" })]),
    el("a", { attrs: { href: "#/keep/security" } }, [icon("shield", { size: 18 }), el("span", { text: "Security & privacy" })]),
    el("a", { attrs: { href: "#/keep/documents" } }, [icon("doc", { size: 18 }), el("span", { text: "Documents" })]),
    el("div", { class: "k-menu__sep" }),
    el("button", { class: "k-menu__item k-menu__danger", attrs: { type: "button", "data-go": "/keep/login" } }, [icon("lock", { size: 18 }), el("span", { text: "Sign out" })]),
  ]);
  return popover(trigger, panel, true);
}

function appBar(active) {
  const link = (label, href, key) => el("a", { class: key === active ? "on" : "", attrs: { href } }, [el("span", { text: label })]);
  return el("header", { class: "k-bar" }, [
    el("div", { class: "k-bar__in" }, [
      el("a", { class: "k-brand", attrs: { href: "#/keep", "aria-label": "The Keep — dashboard" } }, [
        icon("shield", { size: 26, class: "k-mark" }),
        el("span", { text: "Harborline" }),
        el("span", { class: "k-tag", text: "The Keep" }),
      ]),
      el("nav", { class: "k-nav", attrs: { "aria-label": "Portal" } }, [
        link("Dashboard", "#/keep", "dashboard"),
        link("Entities", "#/keep/entities", "entities"),
        link("Documents", "#/keep/documents", "documents"),
      ]),
      el("div", { class: "k-bar__rt" }, [notifMenu(), accountMenu()]),
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
    reminderBanner(),
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
        el("p", { class: "k-secure" }, [icon("lock", { size: 16 }), el("span", { text: "Encrypted · invite-only · private to you" })]),
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
    el("div", { class: "k-privacy" }, [
      icon("lock", { size: 16 }),
      el("span", { text: "Encrypted and private — only you and your broker can see this." }),
      el("a", { attrs: { href: "#/keep/security" }, text: "How we protect you" }),
    ]),
    ...SAMPLE.entities.map((e) => entityPanel(e, settings)),
    el("button", { class: "k-addtile", attrs: { type: "button", "data-go": "/keep/add-asset" } }, [icon("plus", { size: 24 }), el("span", { text: "Add a business entity" })]),
  ]);
  mount(view);
}

function svgText(str, attrs) { const t = s("text", attrs); t.textContent = str; return t; }
function initialsOf(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }

// Inline-SVG relationship graph: "Me" hub on the left, each business on the right,
// connected by a labeled edge describing the relationship (role · stake). Nodes
// are keyboard-focusable and navigate to the entity.
// Relationship graph. Nodes positioned for a clean two-column layout (people on
// the left, entities on the right). Real user entities (with href) open their
// detail; the rest are sample related parties shown to illustrate the map.
const REL_NODES = [
  { id: "alex", x: 30, cy: 70, kind: "person", name: "Alex Mercer", sub: "Spouse", initials: "AM" },
  { id: "me", x: 30, cy: 240, kind: "me", name: "Jordan Mercer", sub: "You · personal", initials: "ME", href: "#/keep/entity/me" },
  { id: "childtrust", x: 390, cy: 120, kind: "trust", name: "Children's Trust", sub: "Irrevocable trust", initials: "CT" },
  { id: "famtrust", x: 390, cy: 340, kind: "trust", name: "Family Trust", sub: "Revocable trust", initials: "FT" },
  { id: "cafe", x: 740, cy: 120, kind: "biz", name: "Coastal Cafe LLC", sub: "LLC", initials: "CC", href: "#/keep/entity/coastal-cafe" },
  { id: "holdings", x: 740, cy: 340, kind: "biz", name: "Mercer Holdings", sub: "LLC · real estate", initials: "MH" },
];
const REL_EDGES = [
  { from: "me", to: "cafe", label: "Managing member · 50%" },
  { from: "alex", to: "cafe", label: "Member · 40%" },
  { from: "childtrust", to: "cafe", label: "Holds · 10%" },
  { from: "me", to: "childtrust", label: "Trustee" },
  { from: "me", to: "famtrust", label: "Trustee" },
  { from: "famtrust", to: "holdings", label: "Owns · 100%" },
];
const REL_STYLE = {
  me: { fill: "url(#relme)", avFill: "rgba(255,255,255,.25)", avText: "#fff", nameFill: "#fff", subFill: "rgba(255,255,255,.85)", stroke: null },
  person: { fill: "#fff", avFill: "#efeafe", avText: "#5b3ee6", nameFill: "#231d3a", subFill: "#5f5880", stroke: "#ece7fb" },
  biz: { fill: "#fff", avFill: "#defaef", avText: "#0e8e66", nameFill: "#231d3a", subFill: "#5f5880", stroke: "#ece7fb" },
  trust: { fill: "#fff", avFill: "#fff1de", avText: "#b5660a", nameFill: "#231d3a", subFill: "#5f5880", stroke: "#ece7fb" },
};

function relationshipMap() {
  const W = 970, H = 420, NODE_W = 200, NODE_H = 72, FS = "Nunito, sans-serif", FD = "Quicksand, sans-serif";
  const byId = Object.fromEntries(REL_NODES.map((n) => [n.id, n]));
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Relationship map of your entities", class: "k-relsvg" });
  svg.appendChild(s("defs", {}, [
    s("linearGradient", { id: "relme", x1: "0", y1: "0", x2: "1", y2: "1" }, [
      s("stop", { offset: "0", "stop-color": "#8a6bff" }), s("stop", { offset: "1", "stop-color": "#5b3ee6" }),
    ]),
  ]));

  // Edges + labels (under nodes). All edges run left-column -> right-column.
  REL_EDGES.forEach((e) => {
    const a = byId[e.from], b = byId[e.to];
    const sx = a.x + NODE_W, sy = a.cy, tx = b.x, ty = b.cy, mx = (sx + tx) / 2;
    svg.appendChild(s("path", { d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`, fill: "none", stroke: "#cdbef5", "stroke-width": "2.5" }));
    const lw = e.label.length * 6.4 + 24, ly = (sy + ty) / 2;
    svg.appendChild(s("rect", { x: mx - lw / 2, y: ly - 13, width: lw, height: 26, rx: 13, fill: "#ffffff", stroke: "#ece7fb" }));
    svg.appendChild(svgText(e.label, { x: mx, y: ly + 4, "text-anchor": "middle", "font-size": "12", "font-weight": "700", fill: "#5f5880", "font-family": FS }));
  });

  REL_NODES.forEach((n) => {
    const o = REL_STYLE[n.kind];
    const interactive = Boolean(n.href);
    const g = s("g", interactive
      ? { class: "k-relnode k-relnode--link", tabindex: "0", role: "link", "aria-label": `Open ${n.name}` }
      : { class: "k-relnode k-relnode--static", "aria-label": `${n.name} (sample)` });
    g.appendChild(s("rect", { x: n.x, y: n.cy - NODE_H / 2, width: NODE_W, height: NODE_H, rx: 18, fill: o.fill, stroke: o.stroke || "none", "stroke-width": o.stroke ? "1.5" : "0" }));
    const ax = n.x + 38;
    g.appendChild(s("circle", { cx: ax, cy: n.cy, r: 20, fill: o.avFill }));
    g.appendChild(svgText(n.initials, { x: ax, y: n.cy + 5, "text-anchor": "middle", "font-size": "14", "font-weight": "800", fill: o.avText, "font-family": FD }));
    g.appendChild(svgText(n.name, { x: ax + 30, y: n.cy - 2, "font-size": "13", "font-weight": "700", fill: o.nameFill, "font-family": FD }));
    g.appendChild(svgText(n.sub, { x: ax + 30, y: n.cy + 16, "font-size": "11", "font-weight": "600", fill: o.subFill, "font-family": FS }));
    if (interactive) {
      const go = () => { location.hash = n.href; };
      g.addEventListener("click", go);
      g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } });
    }
    svg.appendChild(g);
  });

  return el("div", { class: "k-relmap" }, [svg]);
}

export function renderKeepEntities() {
  const view = page("entities", [
    el("h1", { class: "k-h1", text: "Entities" }),
    el("p", { class: "k-sub", text: "How you and your businesses connect. Tap a node to open it." }),
    relationshipMap(),
    el("p", { class: "k-relcaption", text: "Sample relationships shown for demonstration. Your own entities (Jordan Mercer, Coastal Cafe LLC) open when tapped." }),
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
  const rinfo = reminderInfo(policy.renewalInDays, activeSchedule());

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
    el("p", { class: "k-maint" }, [icon("lock", { size: 16 }), el("span", { text: `Maintained by your broker (${policy.agent}) · encrypted & private` })]),
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

  const sched = activeSchedule();
  const reminderText = (reminderPrefs.email && sched.length)
    ? ` Renewal reminders: ${sched.join(" / ")} days before ${dateFromDays(policy.renewalInDays)}` + (rinfo.next ? ` · next at ${rinfo.next} days` : " · none upcoming")
    : " Renewal reminders are off — turn them on in Settings.";
  const docs = el("div", {}, [
    el("div", {}, (policy.documents || []).map((d) => el("span", { class: "k-doclink" }, [icon("doc", { size: 15 }), el("span", { text: d })]))),
    el("p", { class: "k-note" }, [el("b", { text: "Claims history: " }), el("span", { text: policy.claims || "None" })]),
    el("p", { class: "k-note" }, [icon("bell", { size: 14 }), el("span", { text: reminderText })]),
  ]);
  sections.push(grp("doc", "Documents & history", docs));

  mount(page("entities", sections, { narrow: true }));
}

export function renderKeepDocuments() {
  // Build the Entity -> Asset -> Policy -> documents hierarchy so a document is
  // found the same way it's filed.
  const entityBlocks = [];
  let total = 0;
  for (const ent of SAMPLE.entities) {
    const assetBlocks = [];
    let entCount = 0;
    for (const a of ent.assets) {
      const policyBlocks = [];
      let assetCount = 0;
      for (const p of a.policies || []) {
        if (!p.documents || !p.documents.length) continue;
        const links = p.documents.map((d) => {
          const match = `${d} ${p.line} ${a.name} ${ent.name}`.toLowerCase();
          return el("a", { class: "k-doclink", attrs: { href: `#/keep/policy/${p.id}`, "data-doc": match } }, [icon("doc", { size: 15 }), el("span", { text: d })]);
        });
        assetCount += p.documents.length;
        policyBlocks.push(el("div", { class: "k-doc-policy" }, [
          el("div", { class: "k-doc-policy__name", text: p.line }),
          el("div", { class: "k-doc-links" }, links),
        ]));
      }
      if (!policyBlocks.length) continue;
      entCount += assetCount;
      const meta = ASSET_META[a.type] || { cic: "home", icon: "shield" };
      assetBlocks.push(el("div", { class: "k-doc-asset" }, [
        el("div", { class: "k-doc-asset__h" }, [
          el("span", { class: `k-cic k-cic--${meta.cic}` }, [icon(meta.icon, { size: 22 })]),
          el("div", {}, [
            el("div", { class: "k-doc-asset__name", text: a.name }),
            el("div", { class: "k-doc-asset__meta", text: `${assetCount} document${assetCount === 1 ? "" : "s"}` }),
          ]),
        ]),
        ...policyBlocks,
      ]));
    }
    if (!assetBlocks.length) continue;
    total += entCount;
    const avatar = ent.kind === "business"
      ? el("span", { class: "k-bigav k-bigav--biz k-bigav--sm" }, [icon(ent.icon || "briefcase", { size: 22 })])
      : el("span", { class: "k-bigav k-bigav--sm", text: ent.initials });
    entityBlocks.push(el("section", { class: "k-doc-entity" }, [
      el("div", { class: "k-doc-entity__h" }, [
        avatar,
        el("div", {}, [
          el("div", { class: "k-doc-entity__name", text: ent.name }),
          el("div", { class: "k-doc-entity__meta", text: `${entCount} document${entCount === 1 ? "" : "s"}` }),
        ]),
      ]),
      ...assetBlocks,
    ]));
  }

  const empty = el("div", { class: "k-docs-empty", attrs: { hidden: "" }, text: "No documents match your search." });
  const search = el("input", { class: "k-docsearch", attrs: { type: "search", placeholder: "Search documents by name, policy, or asset…", "aria-label": "Search documents" } });
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    for (const ent of entityBlocks) {
      let entVis = false;
      ent.querySelectorAll(".k-doc-asset").forEach((as) => {
        let asVis = false;
        as.querySelectorAll(".k-doc-policy").forEach((pol) => {
          let polVis = false;
          pol.querySelectorAll(".k-doclink").forEach((link) => {
            const show = !q || (link.dataset.doc || "").includes(q);
            link.hidden = !show;
            if (show) polVis = true;
          });
          pol.hidden = !polVis;
          if (polVis) asVis = true;
        });
        as.hidden = !asVis;
        if (asVis) entVis = true;
      });
      ent.hidden = !entVis;
      if (entVis) any = true;
    }
    empty.hidden = any;
  });

  const view = page("documents", [
    backLink("#/keep", "dashboard"),
    el("h1", { class: "k-h1", text: "Documents" }),
    el("p", { class: "k-sub", text: "All your documents, filed by entity and asset." }),
    total ? search : null,
    ...(entityBlocks.length ? entityBlocks : [el("div", { class: "k-empty", text: "No documents on file yet." })]),
    empty,
  ], { narrow: true });
  mount(view);
}

export function renderKeepAccount() {
  const pg = (rows) => el("dl", { class: "k-pg" }, rows.map(([dt, dd]) => el("div", {}, [el("dt", { text: dt }), el("dd", { text: dd })])));
  const view = page("account", [
    backLink("#/keep", "dashboard"),
    el("h1", { class: "k-h1", text: "Account" }),
    el("p", { class: "k-sub", text: "Your profile and notification settings." }),
    el("div", { class: "k-grp" }, [
      el("div", { class: "k-grp__h" }, [icon("user", { size: 15 }), el("span", { text: "Profile" })]),
      pg([["Name", SAMPLE.user.name], ["Email", "jordan.m@example.com"], ["Role", "Client"], ["Member since", "Jun 2026"], ["Broker", "Rosa Alvarez"]]),
    ]),
    buildReminderSettings(),
    el("div", { class: "k-btn-row" }, [
      el("button", { class: "k-btn k-btn--ghost", attrs: { type: "button", "data-go": "/keep/login" } }, [icon("lock", { size: 18 }), el("span", { text: "Sign out" })]),
    ]),
  ], { narrow: true });
  mount(view);
}

const SECURITY_CARDS = [
  { ic: "lock", t: "Encrypted in transit", b: "Everything you view and send travels over an encrypted HTTPS/TLS connection — never in the clear." },
  { ic: "shield", t: "Encrypted at rest", b: "Your records are stored in a database that is encrypted on disk, so the underlying files are unreadable if ever accessed." },
  { ic: "user", t: "Private to you", b: "Row-level security means only you — and your licensed broker — can ever read your entities, assets and policies. No other client can see your data." },
  { ic: "mail", t: "Invite-only access", b: "Accounts exist only by broker invitation. There is no public sign-up to your portal." },
  { ic: "check", t: "Least privilege", b: "The public website can only submit a request — it can never read client data. Privileged keys stay on our servers and never reach your browser." },
  { ic: "briefcase", t: "Never sold", b: "Your information is used only to advise you on coverage. We never sell or share it for marketing." },
];

export function renderKeepSecurity() {
  // 2FA is not live on the stub yet — the button reveals an honest explanation
  // rather than pretending to enable it.
  const note = el("div", { class: "twofa-note", text: "Two-factor setup unlocks once your account goes live: you'll scan a QR code with an authenticator app and enter a 6-digit code at login." });
  const twofaBtn = el("button", { class: "k-btn", attrs: { type: "button", "aria-expanded": "false" } }, [
    el("span", { text: "Turn on 2FA" }),
    icon("arrow-right", { size: 18, class: "k-chev" }),
  ]);
  twofaBtn.addEventListener("click", () => {
    const open = note.classList.toggle("is-shown");
    twofaBtn.classList.toggle("is-open", open);
    twofaBtn.setAttribute("aria-expanded", String(open));
    twofaBtn.querySelector("span").textContent = open ? "Hide" : "Turn on 2FA";
  });

  const view = page("security", [
    backLink("#/keep", "dashboard"),
    el("div", { class: "shero" }, [
      el("span", { class: "k-cic" }, [icon("shield", { size: 34 })]),
      el("div", {}, [
        el("h1", { text: "Your data is protected" }),
        el("p", { text: "How the Keep keeps your information private and secure." }),
      ]),
    ]),
    el("div", { class: "twofa" }, [
      el("span", { class: "k-cic" }, [icon("lock", { size: 26 })]),
      el("div", {}, [
        el("h3", {}, [el("span", { text: "Two-factor authentication " }), el("span", { class: "opt", text: "Recommended" })]),
        el("p", { text: "Add a second layer at login — a one-time code from your phone, on top of your password." }),
      ]),
      twofaBtn,
    ]),
    note,
    el("div", { class: "sgrid" }, SECURITY_CARDS.map((c) =>
      el("div", { class: "scard" }, [
        el("span", { class: "k-cic" }, [icon(c.ic, { size: 24 })]),
        el("h3", { text: c.t }),
        el("p", { text: c.b }),
      ]))),
    el("div", { class: "snote" }, [
      icon("shield", { size: 14 }),
      el("span", {}, [el("b", { text: " Questions about how your data is handled? " }), el("span", { text: "Your licensed broker (Rosa Alvarez) can walk you through it, or see our privacy policy." })]),
    ]),
  ], { narrow: true });
  mount(view);
}
