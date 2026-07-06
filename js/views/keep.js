// views/keep.js — "The Keep" authenticated portal (Direction C).
// Renders login, dashboard (entities + nested assets), entity detail, add-asset,
// and the asset coverage-analysis page. Reads/writes live Supabase data (loaded
// by the route guard in main.js); RLS scopes everything to the signed-in client.

import { el, mount } from "../dom.js";
import { go, previousRoute } from "../main.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { getRuleDefaults } from "../content.js";
import { ASSET_META } from "../keep/data.js";
import {
  getUser, getEntities, getEntity, findAsset, findPolicy, getMapData,
  getAllAssets,
  getPrefs, savePrefs, signIn, signOut, addEntity, addAsset,
  invalidate, ensureData, DEMO_CREDENTIAL, addRelationship,
  addEnhancementRequest, loadEnhancementRequests, notifyEnhancement, approveEnhancement, advanceRequest,
} from "../supabase.js";
import { analyzeAsset, assetStatus, entitySummary } from "../keep/analysis.js";
import { policyKind, reminderInfo, renewalBand, REMINDER_SCHEDULE } from "../keep/policies.js";
import { KEEP_ACTIONS, matchActions, searchRecords } from "../keep/search.js";
import { validateRequest, statusDisplay, defaultSubject, stageInfo, isPending, nextStage, REQUEST_STAGES } from "../keep/requests.js";
import { buildPdf, docLines } from "../keep/docfile.js";
import { OWNERSHIP_ROLES, parsePct, totalStake, validateOwnership, stakeLabel } from "../keep/ownership.js";
import { ENTITY_TYPE_GROUPS, kindForType, isNonprofitType } from "../keep/entity-types.js";
import { capTablesByEntity, typeBands, orchestrate } from "../keep/relmap.js";

// Broker of record (demo). Single source for the name shown across the portal;
// policy-level agent comes from the policy record itself.
const BROKER_NAME = "Rosa Alvarez";

// Breadcrumb separator node (kept as one helper so the glyph isn't duplicated).
function sep() { return el("span", { text: "  ·  " }); }

// The Relationships map is fully auto-laid-out — the user never drags boxes, so
// there are no per-browser saved positions to persist. Every render places nodes
// purely from the orchestrated layout (see keep/relmap.js orchestrate).

// Persist the drag-reordered order of the entity Cards grid (per browser), as an
// array of entity ids. Empty/absent → fall back to the default (name) order.
const CARD_ORDER_KEY = "keep:entity-card-order";
function loadCardOrder() {
  try { const v = JSON.parse(localStorage.getItem(CARD_ORDER_KEY)); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function saveCardOrder(ids) {
  try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(ids)); }
  catch (e) { /* storage unavailable — ignore */ }
}

// Reminder preferences live on the user's profile (loaded with the Keep data).
// activeSchedule reflects the saved set; changes persist via savePrefs().
function activeSchedule() {
  const p = getPrefs();
  return REMINDER_SCHEDULE.filter((d) => p.schedule.includes(d));
}

// Status banner shown on the policies list — reflects the saved preference and
// links to Settings (the controls live there, not here).
function reminderBanner() {
  const p = getPrefs();
  if (!p.email || !activeSchedule().length) {
    return el("div", { class: "k-remind" }, [
      el("span", { class: "k-cic" }, [icon("bell", { size: 22 })]),
      el("p", {}, [el("b", { text: "Renewal reminders are off. " }), el("span", { text: "Turn them on in " }), el("a", { attrs: { href: "#/keep/account" }, text: "Settings" }), el("span", { text: "." })]),
    ]);
  }
  return el("div", { class: "k-remind" }, [
    el("span", { class: "k-cic" }, [icon("bell", { size: 22 })]),
    el("p", {}, [
      el("b", { text: "Renewal reminders are on. " }),
      el("span", { text: `We email ${getUser().name.split(" ")[0]} ${activeSchedule().join(", ")} days before each renewal · ` }),
      el("a", { attrs: { href: "#/keep/account" }, text: "Manage" }),
    ]),
  ]);
}

// Interactive reminder-preference controls for the Account page. Mutates the
// loaded prefs object in place and persists each change to the profile.
function buildReminderSettings() {
  const p = getPrefs();
  const persist = () => { savePrefs({ email: p.email, schedule: p.schedule }); };
  const chips = REMINDER_SCHEDULE.map((d) => {
    const chip = el("button", { class: `k-chiptog${p.schedule.includes(d) ? " on" : ""}`, attrs: { type: "button", "aria-pressed": String(p.schedule.includes(d)) } }, [el("span", { text: `${d} day${d === 1 ? "" : "s"}` })]);
    chip.addEventListener("click", () => {
      if (!p.email) return;
      const i = p.schedule.indexOf(d);
      if (i >= 0) p.schedule.splice(i, 1); else p.schedule.push(d);
      const on = p.schedule.includes(d);
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", String(on));
      persist();
    });
    return chip;
  });
  const setChipsEnabled = (enabled) => chips.forEach((c) => { if (enabled) c.removeAttribute("disabled"); else c.setAttribute("disabled", "disabled"); });
  setChipsEnabled(p.email);

  const sw = el("button", { class: `k-switch${p.email ? " on" : ""}`, attrs: { type: "button", role: "switch", "aria-checked": String(p.email), "aria-label": "Email reminders" } }, [
    el("span", { class: "k-switch__track" }),
    el("span", { class: "k-switch__label", text: p.email ? "On" : "Off" }),
  ]);
  sw.addEventListener("click", () => {
    p.email = !p.email;
    sw.classList.toggle("on", p.email);
    sw.setAttribute("aria-checked", String(p.email));
    sw.querySelector(".k-switch__label").textContent = p.email ? "On" : "Off";
    setChipsEnabled(p.email);
    persist();
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
      el("div", {}, [el("div", { class: "k-setrow__t", text: "Send to" }), el("div", { class: "k-setrow__s", text: getUser().email })]),
    ]),
    el("p", { class: "k-setnote", text: "Changes save to your profile automatically." }),
  ]);
}

// ── small helpers ────────────────────────────────────────────────────────────
function money(v) {
  if (!v) return "";
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(v % 1000000 ? 1 : 0) + "M";
  if (v >= 1000) return "$" + Math.round(v / 1000) + "K";
  return "$" + v;
}

// Generate + download a placeholder PDF for a demo document (no real file is
// stored; see js/keep/docfile.js). Named after the document.
function downloadDocument(name, context) {
  const bytes = buildPdf(docLines(name, context));
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i) & 0xff;
  const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
  const a = el("a", { attrs: { href: url, download: `${name}.pdf` } });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadButton(name, context) {
  const b = el("button", { class: "k-dl", attrs: { type: "button", title: `Download ${name}`, "aria-label": `Download ${name}` } }, [icon("download", { size: 15 })]);
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); downloadDocument(name, context); });
  return b;
}

// A document row: the document (optionally linking to its policy) plus a
// download button. `context` lines are embedded in the generated PDF.
function docItem(name, href, context, dataDoc) {
  const label = href
    ? el("a", { class: "k-doclink", attrs: { href } }, [icon("doc", { size: 15 }), el("span", { text: name })])
    : el("span", { class: "k-doclink" }, [icon("doc", { size: 15 }), el("span", { text: name })]);
  const row = el("div", { class: "k-docrow" }, [label, downloadButton(name, context)]);
  if (dataDoc) row.setAttribute("data-doc", dataDoc);
  return row;
}

function ribbon() {
  return el("div", { class: "k-ribbon" }, [
    icon("lock", { size: 15 }),
    el("span", { text: "Demo account — live data, secured by row-level security" }),
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
// Close any open search/command dropdowns (the nav search and the landing box).
function closeKeepSearch() {
  document.querySelectorAll(".k-search.is-open, .k-cmd.is-open").forEach((s) => s.classList.remove("is-open"));
}
if (typeof document !== "undefined" && !document.__keepMenusInit) {
  document.__keepMenusInit = true;
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".k-pop")) closeKeepMenus();
    if (!e.target.closest(".k-search")) document.querySelectorAll(".k-search.is-open").forEach((s) => s.classList.remove("is-open"));
    if (!e.target.closest(".k-cmd")) document.querySelectorAll(".k-cmd.is-open").forEach((s) => s.classList.remove("is-open"));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeKeepMenus(); closeKeepSearch(); } });
}

// ── Search / command dropdowns ───────────────────────────────────────────────
// One row in a results dropdown (records or actions). Anchors carry the href so
// navigation works natively; the parent clears + closes on click.
function resultRow(r, tag) {
  return el("a", { class: "k-sresult", attrs: { href: r.href } }, [
    el("span", { class: "k-sresult__ic" }, [icon(r.icon, { size: 16 })]),
    el("div", { class: "k-sresult__main" }, [
      el("div", { class: "k-sresult__t", text: r.label }),
      el("div", { class: "k-sresult__s", text: r.sub || r.hint || "" }),
    ]),
    el("span", { class: "k-sresult__tag", text: tag }),
  ]);
}

const RECORD_TAGS = { entity: "Entity", asset: "Asset", policy: "Policy", document: "Document" };

// Top-nav search box: searches the user's records and surfaces matching actions.
function searchBox() {
  const input = el("input", { class: "k-search__in", attrs: { type: "search", placeholder: "Search entities, policies, documents…", "aria-label": "Search the Keep", autocomplete: "off" } });
  const panel = el("div", { class: "k-search__panel" });
  const wrap = el("div", { class: "k-search" }, [el("span", { class: "k-search__ic" }, [icon("search", { size: 18 })]), input, panel]);
  let firstHref = null;

  function render() {
    const q = input.value.trim();
    panel.replaceChildren();
    firstHref = null;
    if (!q) { wrap.classList.remove("is-open"); return; }
    const records = searchRecords(q, getEntities(), 6);
    const actions = matchActions(q, 4);
    if (records.length) {
      panel.appendChild(el("div", { class: "k-search__lbl", text: "Your records" }));
      records.forEach((r) => { if (!firstHref) firstHref = r.href; panel.appendChild(resultRow(r, RECORD_TAGS[r.type] || "")); });
    }
    if (actions.length) {
      panel.appendChild(el("div", { class: "k-search__lbl", text: "Actions" }));
      actions.forEach((a) => { if (!firstHref) firstHref = a.href; panel.appendChild(resultRow(a, "Action")); });
    }
    if (!records.length && !actions.length) {
      panel.appendChild(el("div", { class: "k-search__empty", text: `No matches for “${q}”.` }));
    }
    wrap.classList.add("is-open");
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", () => { if (input.value.trim()) render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (firstHref) { go(firstHref); input.value = ""; wrap.classList.remove("is-open"); input.blur(); } }
  });
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) { input.value = ""; wrap.classList.remove("is-open"); } });
  return wrap;
}

// Landing "command" box: free-text intent → suggested actions (and records),
// with default suggestion chips when empty. Drives the "what would you like to
// accomplish today?" prompt.
const LANDING_SUGGESTIONS = ["request-enhancement", "audit", "documents", "add-entity"];
function landingCommand() {
  const input = el("input", { class: "k-cmd__in", attrs: { type: "text", placeholder: "Try “add an entity”, “audit my policies”, “download a document”…", "aria-label": "What would you like to do?", autocomplete: "off" } });
  const goBtn = el("button", { class: "k-cmd__go", attrs: { type: "button", "aria-label": "Go" } }, [icon("arrow-right", { size: 20 })]);
  const panel = el("div", { class: "k-cmd__panel" });
  const wrap = el("div", { class: "k-cmd" }, [
    el("div", { class: "k-cmd__bar" }, [el("span", { class: "k-cmd__ic" }, [icon("spark", { size: 20 })]), input, goBtn]),
    panel,
  ]);
  let firstHref = null;

  function render() {
    const q = input.value.trim();
    panel.replaceChildren();
    firstHref = null;
    if (!q) { wrap.classList.remove("is-open"); return; }
    const actions = matchActions(q, 5);
    const records = searchRecords(q, getEntities(), 4);
    if (actions.length) {
      panel.appendChild(el("div", { class: "k-search__lbl", text: "Suggested actions" }));
      actions.forEach((a) => { if (!firstHref) firstHref = a.href; panel.appendChild(resultRow(a, "Action")); });
    }
    if (records.length) {
      panel.appendChild(el("div", { class: "k-search__lbl", text: "In your account" }));
      records.forEach((r) => { if (!firstHref) firstHref = r.href; panel.appendChild(resultRow(r, RECORD_TAGS[r.type] || "")); });
    }
    if (!actions.length && !records.length) {
      panel.appendChild(el("div", { class: "k-search__empty", text: `I didn't find anything for “${q}”. Try “add an entity” or “audit my policies”.` }));
    }
    wrap.classList.add("is-open");
  }
  function submit() { if (firstHref) { go(firstHref); } }

  input.addEventListener("input", render);
  input.addEventListener("focus", () => { if (input.value.trim()) render(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  goBtn.addEventListener("click", submit);
  panel.addEventListener("click", (e) => { if (e.target.closest("a")) wrap.classList.remove("is-open"); });

  const chips = LANDING_SUGGESTIONS
    .map((id) => KEEP_ACTIONS.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => el("a", { class: "k-cmd__chip", attrs: { href: a.href } }, [icon(a.icon, { size: 15 }), el("span", { text: a.label })]));

  return el("div", { class: "k-cmd-wrap" }, [wrap, el("div", { class: "k-cmd__chips" }, chips)]);
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
  for (const ent of getEntities())
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
  const user = getUser();
  const trigger = el("button", { class: "k-av k-av--btn", attrs: { type: "button", "aria-label": "Account menu" } }, [el("span", { text: user.initials })]);
  const panel = el("div", { class: "k-menu" }, [
    el("div", { class: "k-menu__head" }, [
      el("span", { class: "k-av" }, [el("span", { text: user.initials })]),
      el("div", {}, [
        el("div", { class: "k-menu__name", text: user.name }),
        el("div", { class: "k-menu__email", text: user.email }),
      ]),
    ]),
    el("a", { attrs: { href: "#/keep/requests" } }, [icon("spark", { size: 18 }), el("span", { text: "My requests" })]),
    el("a", { attrs: { href: "#/keep/account" } }, [icon("user", { size: 18 }), el("span", { text: "Account settings" })]),
    el("a", { attrs: { href: "#/keep/security" } }, [icon("shield", { size: 18 }), el("span", { text: "Security & privacy" })]),
    el("a", { attrs: { href: "#/keep/documents" } }, [icon("doc", { size: 18 }), el("span", { text: "Documents" })]),
    el("div", { class: "k-menu__sep" }),
    signOutButton("k-menu__item k-menu__danger"),
  ]);
  return popover(trigger, panel, true);
}

// Sign out of Supabase Auth, clear the cache, return to login.
function signOutButton(cls) {
  const btn = el("button", { class: cls, attrs: { type: "button" } }, [icon("lock", { size: 18 }), el("span", { text: "Sign out" })]);
  btn.addEventListener("click", async () => { await signOut(); go("#/keep/login"); });
  return btn;
}

function appBar(active) {
  const link = (label, href, key) => el("a", { class: key === active ? "on" : "", attrs: { href } }, [el("span", { text: label })]);
  return el("header", { class: "k-bar" }, [
    el("div", { class: "k-bar__in" }, [
      el("a", { class: "k-brand", attrs: { href: "#/keep", "aria-label": "The Keep — home" } }, [
        icon("shield", { size: 26, class: "k-mark" }),
        el("span", { text: "Harborline" }),
        el("span", { class: "k-tag", text: "The Keep" }),
      ]),
      el("nav", { class: "k-nav", attrs: { "aria-label": "Portal" } }, [
        link("Home", "#/keep", "home"),
        link("Entities", "#/keep/list", "list"),
        link("Assets", "#/keep/assets", "assets"),
        link("Policies", "#/keep/insurance", "insurance"),
        link("Documents", "#/keep/documents", "documents"),
      ]),
      el("div", { class: "k-bar__rt" }, [searchBox(), notifMenu(), accountMenu()]),
    ]),
  ]);
}

function page(active, contentChildren, opts = {}) {
  const wrapClass = `k-wrap${opts.narrow ? " k-wrap--narrow" : ""}`;
  return el("div", {}, [ribbon(), appBar(active), el("div", { class: wrapClass }, contentChildren)]);
}

// Friendly labels for the Keep's static routes (dynamic entity/asset routes
// fall through to a plain "Back").
const KEEP_LABELS = {
  "#/keep": "home",
  "#/keep/list": "entities",
  "#/keep/grid": "entities",
  "#/keep/insurance": "policies",
  "#/keep/entities": "relationships",
  "#/keep/documents": "documents",
  "#/keep/requests": "my requests",
  "#/keep/account": "account",
  "#/keep/security": "security",
};

// The route to return to: where the user actually came from (when it's a Keep
// route), else the hierarchical fallback the caller passes (deep-links/reloads).
function originHref(fallbackHref) {
  const prev = previousRoute();
  return (prev && prev.startsWith("#/keep") && prev !== location.hash) ? prev : fallbackHref;
}

// Origin-aware back affordance (CLAUDE.md coding standard).
function backLink(fallbackHref, fallbackLabel) {
  const href = originHref(fallbackHref);
  let label = fallbackLabel;
  if (href !== fallbackHref) {
    // Came from somewhere other than the parent — use a known route name, or a
    // plain "Back" for dynamic routes (entity/asset).
    label = KEEP_LABELS[href] || null;
  }
  return el("div", { class: "k-backrow" }, [
    el("a", { class: "k-back", attrs: { href } }, [
      icon("arrow-right", { size: 18, class: "icon-flip" }),
      el("span", { text: label ? `Back to ${label}` : "Back" }),
    ]),
  ]);
}

function cic(asset) {
  const meta = ASSET_META[asset.type] || { cic: "home", icon: "shield" };
  return el("span", { class: `k-cic k-cic--${meta.cic}` }, [icon(meta.icon, { size: 28 })]);
}

// Canonical category label for an asset's type (Home, Vehicle, Commercial space…)
// — a fixed vocabulary, so the Type column never echoes freeform meta text.
function assetTypeLabel(asset) {
  const meta = ASSET_META[asset.type];
  return (meta && meta.label) || "Other";
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
    el("p", { class: "k-maint" }, [icon("lock", { size: 16 }), el("span", { text: `Policies maintained by your broker (${BROKER_NAME})` })]),
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

// Per-type colour coordination, consistent across the app:
//   You / People → blue · Business → red · Nonprofit → green · Trust & Estate → yellow.
function colorSuffix(entity) {
  if (entity.kind === "business") return isNonprofitType(entity.subtype || entity.label) ? "np" : "biz";
  if (entity.kind === "trust") return "trust";
  if (entity.kind === "person") return "person";
  return "me";
}
function panelVariant(entity) { return `k-panel--${colorSuffix(entity)}`; }

// The broad entity type shown as the category: Individual (you + people),
// Business, or Trust.
function entityCategory(entity) {
  if (entity.kind === "business") return "Company";
  if (entity.kind === "trust") return "Trust";
  return "Individual"; // personal + person
}

// The specific subtype (Revocable trust, LLC, Spouse…). Seeded rows keep it in
// either `subtype` or `label`, and the other field holds a generic category
// word — so pick the first candidate that isn't generic. "You" for yourself.
const GENERIC_TYPE = new Set(["business", "company", "trust", "individual", "personal", "you · personal", ""]);
function entitySubtype(entity) {
  for (const c of [entity.subtype, entity.label]) {
    if (c && !GENERIC_TYPE.has(c.trim().toLowerCase())) return c;
  }
  return entity.kind === "personal" ? "You" : "—";
}

function entityAvatar(entity) {
  // Businesses (red / nonprofit green) and trusts (yellow) get an icon avatar;
  // you and family members (blue) show their initials.
  if (entity.kind === "business" || entity.kind === "trust") {
    return el("span", { class: `k-bigav k-bigav--${colorSuffix(entity)}` }, [icon(entity.icon || (entity.kind === "trust" ? "doc" : "briefcase"), { size: 30 })]);
  }
  return el("span", { class: `k-bigav${entity.kind === "person" ? " k-bigav--person" : ""}`, text: entity.initials });
}

// ── views ────────────────────────────────────────────────────────────────────
export function renderKeepLogin() {
  const emailInput = el("input", { attrs: { type: "text", value: DEMO_CREDENTIAL.email, autocomplete: "username" } });
  const pwInput = el("input", { attrs: { type: "password", value: DEMO_CREDENTIAL.password, autocomplete: "current-password" } });
  const error = el("p", { class: "k-error", attrs: { role: "alert" } });
  const btn = el("button", { class: "k-btn k-btn--block", attrs: { type: "submit" } }, [el("span", { text: "Log in" }), icon("arrow-right", { size: 20 })]);

  async function submit() {
    error.textContent = "";
    btn.setAttribute("disabled", "disabled");
    btn.querySelector("span").textContent = "Signing in…";
    const res = await signIn(emailInput.value.trim(), pwInput.value);
    if (res.ok) { go("#/keep"); return; }
    error.textContent = res.error || "Could not sign in. Check your email and password.";
    btn.removeAttribute("disabled");
    btn.querySelector("span").textContent = "Log in";
  }

  const form = el("form", { class: "k-authcard" }, [
    el("div", { class: "k-bigshield" }, [icon("shield", { size: 34 })]),
    el("div", { class: "k-abrand" }, [el("span", { text: "Harborline" }), el("span", { class: "k-tag", text: "The Keep" })]),
    el("h1", { class: "k-atitle", text: "Welcome back" }),
    el("p", { class: "k-asub", text: "Log in to your Keep." }),
    el("label", { class: "k-fld" }, [el("span", { text: "Username" }), emailInput]),
    el("label", { class: "k-fld" }, [el("span", { text: "Password" }), pwInput]),
    btn,
    error,
    el("p", { class: "k-ameta" }, [el("b", { text: "Demo logins: " }), el("span", { text: "“user” (client) · “broker” (broker) · “underwriter” (underwriter) — same password (prefilled)." })]),
    el("p", { class: "k-ameta", text: `Forgot your password? Contact your broker (${BROKER_NAME}) to reset it.` }),
    el("p", { class: "k-secure" }, [icon("lock", { size: 16 }), el("span", { text: "Encrypted · invite-only · private to you" })]),
  ]);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

  mount(el("div", {}, [ribbon(), el("div", { class: "k-authwrap" }, [form])]));
}

// Renewal urgency band → display treatment (colour escalates as the date nears).
const RENEWAL_STYLE = {
  lapsed:   { cls: "k-rb--crit", word: "Lapsed" },
  urgent:   { cls: "k-rb--crit", word: "Due now" },
  week:     { cls: "k-rb--high", word: "This week" },
  soon:     { cls: "k-rb--med",  word: "This month" },
  upcoming: { cls: "k-rb--low",  word: "Upcoming" },
};

// Every policy across the user's entities, with its asset/entity context.
function collectPolicies() {
  const out = [];
  for (const ent of getEntities())
    for (const a of ent.assets)
      for (const p of (a.policies || []))
        out.push({ policy: p, asset: a, entity: ent });
  return out;
}

// Shared sortable table. Sorting is driven by clicking the column headers: click
// a header to sort by it (ascending), click again to flip to descending. The
// active column shows a ▲/▼ caret. Columns without a `get` are not sortable.
//   columns: [{ label, get?(row), cell(row) -> node|[nodes], tdClass? }]
//   opts:    { defaultIdx, defaultDir (1 asc / -1 desc), rowClass(row) }
// Returns { wrap, entries } — entries [{ row, tr }] so callers can filter (search).
function sortableTable(columns, rows, opts = {}) {
  const entries = rows.map((row) => {
    // Optional whole-row link: clicking anywhere on the row (except an inner
    // link/button) navigates to opts.rowHref(row). The row keeps its per-cell
    // anchor for keyboard focus + middle-click; this just widens the hit target.
    const href = opts.rowHref ? opts.rowHref(row) : null;
    const cls = [opts.rowClass ? opts.rowClass(row) : "", href ? "k-row--link" : ""].filter(Boolean).join(" ");
    return {
      row, href,
      tr: el("tr", { class: cls },
        columns.map((c) => el("td", c.tdClass ? { class: c.tdClass } : {}, [].concat(c.cell(row)).filter(Boolean)))),
    };
  });
  const tbody = el("tbody", {}, entries.map((e) => e.tr));

  // Delegated row navigation: a plain click on a linked row opens it, but clicks
  // on an inner <a>/<button> are left to the native element.
  if (opts.rowHref) {
    tbody.addEventListener("click", (ev) => {
      if (ev.target.closest("a, button")) return;
      const tr = ev.target.closest("tr");
      const entry = entries.find((e) => e.tr === tr);
      if (entry && entry.href) location.hash = entry.href;
    });
  }

  const firstSortable = columns.findIndex((c) => c.get);
  const state = { idx: opts.defaultIdx != null ? opts.defaultIdx : Math.max(0, firstSortable), dir: opts.defaultDir || 1 };

  const ths = columns.map((c, i) => {
    if (!c.get) return el("th", { text: c.label });
    const caret = el("span", { class: "k-th__caret" });
    const th = el("th", { class: "k-th--sort", attrs: { role: "button", tabindex: "0", title: `Sort by ${c.label}` } }, [el("span", { text: c.label }), caret]);
    const activate = () => {
      if (state.idx === i) state.dir = -state.dir; else { state.idx = i; state.dir = 1; }
      apply();
    };
    th.addEventListener("click", activate);
    th.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(); } });
    th._caret = caret; th._colIdx = i;
    return th;
  });

  function apply() {
    const col = columns[state.idx];
    if (col && col.get) {
      [...entries].sort((A, B) => {
        const av = col.get(A.row), bv = col.get(B.row);
        const d = (typeof av === "number" && typeof bv === "number")
          ? av - bv
          : String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv));
        return d * state.dir;
      }).forEach((e) => tbody.appendChild(e.tr));
    }
    ths.forEach((th) => {
      if (!th._caret) return;
      const on = th._colIdx === state.idx;
      th.classList.toggle("is-sorted", on);
      th.setAttribute("aria-sort", on ? (state.dir === 1 ? "ascending" : "descending") : "none");
      th._caret.textContent = on ? (state.dir === 1 ? "▲" : "▼") : "";
    });
  }
  apply();

  const wrap = el("div", { class: "k-itable-wrap" }, [
    el("table", { class: "k-itable" }, [el("thead", {}, [el("tr", {}, ths)]), tbody]),
  ]);
  return { wrap, entries };
}

function statTile(label, value, sub) {
  return el("div", { class: "k-stat" }, [
    el("div", { class: "k-stat__v", text: String(value) }),
    el("div", { class: "k-stat__l", text: label }),
    sub ? el("div", { class: "k-stat__s", text: sub }) : null,
  ]);
}

// Landing — welcome + "what would you like to do?" + a renewals report and
// at-a-glance boxes. The home of the Keep (#/keep).
// Horizontal progress tracker for a request's lifecycle (Submitted → Broker
// review → Underwriting → Approved). Declined renders as a single off-track step.
function requestStepper(status) {
  const info = stageInfo(status);
  if (info.declined) {
    return el("div", { class: "k-steps k-steps--declined" }, [
      el("div", { class: "k-step is-declined" }, [
        el("span", { class: "k-step__dot" }, [icon("x", { size: 13 })]),
        el("span", { class: "k-step__lbl", text: "Declined" }),
      ]),
    ]);
  }
  return el("div", { class: "k-steps" }, REQUEST_STAGES.map((s, i) => {
    const n = i + 1;
    const cls = n < info.step ? "is-done" : (n === info.step ? "is-current" : "");
    return el("div", { class: `k-step ${cls}` }, [
      el("span", { class: "k-step__dot" }, [n < info.step ? icon("check", { size: 13 }) : el("span", { text: String(n) })]),
      el("span", { class: "k-step__lbl", text: s.track }),
    ]);
  }));
}

// Compact "Request status" window for the landing page — pending requests with
// their live stage. Links through to the full My requests list.
function pendingRequestsReport(requests, role) {
  const pending = requests.filter((r) => isPending(r.status));
  const isStaff = role === "broker" || role === "underwriter";
  const HEAD = { broker: "Requests to action", underwriter: "Underwriting queue", client: "Request status" };
  const EMPTY = {
    broker: "No client requests in progress.",
    underwriter: "No requests awaiting underwriting.",
    client: "No requests in progress — start one from the prompt above.",
  };
  const rows = pending.length
    ? pending.slice(0, 4).map((r) => {
        const info = stageInfo(r.status);
        const stt = statusDisplay(r.status);
        return el("a", { class: "k-prq", attrs: { href: "#/keep/requests" } }, [
          el("div", { class: "k-prq__top" }, [
            el("div", { class: "k-prq__subj", text: r.subject }),
            el("span", { class: `k-pill ${stt.cls}` }, [icon(stt.icon, { size: 14 }), el("span", { text: stt.label })]),
          ]),
          requestStepper(r.status),
          el("div", { class: "k-prq__wait", text: info.wait }),
        ]);
      })
    : [el("div", { class: "k-report__empty", text: EMPTY[role] || EMPTY.client })];

  return el("section", { class: "k-report" }, [
    el("div", { class: "k-report__h" }, [
      el("h2", {}, [icon("spark", { size: 18 }), el("span", { text: HEAD[role] || HEAD.client })]),
      el("a", { class: "k-report__count", attrs: { href: "#/keep/requests" }, text: pending.length ? `${pending.length} in progress →` : "View all →" }),
    ]),
    el("div", { class: "k-report__list" }, rows),
  ]);
}

export async function renderKeepLanding() {
  const settings = await getRuleDefaults();
  const first = getUser().name.split(" ")[0];
  const entities = getEntities();
  const role = (getUser() && getUser().role) || "client";
  const requests = await loadEnhancementRequests();

  // Aggregate at-a-glance numbers.
  let assets = 0, policies = 0, gaps = 0, insured = 0, lapsed = 0;
  for (const e of entities) {
    const sum = entitySummary(e, settings);
    assets += sum.assets; gaps += sum.gaps;
    for (const a of e.assets) {
      insured += a.value || 0;
      for (const p of (a.policies || [])) { policies++; if (p.renewalInDays < 0) lapsed++; }
    }
  }

  // Renewals inside the 60-day window, soonest first.
  const renewals = collectPolicies()
    .map((r) => ({ ...r, band: renewalBand(r.policy.renewalInDays) }))
    .filter((r) => r.band)
    .sort((a, b) => a.policy.renewalInDays - b.policy.renewalInDays);

  const renewalRows = renewals.length
    ? renewals.map(({ policy, asset, band }) => {
        const st = RENEWAL_STYLE[band];
        const d = policy.renewalInDays;
        const when = d < 0 ? `Lapsed ${dateShort(d)}`
          : d === 0 ? "Due today"
          : `${d} day${d === 1 ? "" : "s"} · ${dateShort(d)}`;
        return el("a", { class: `k-rb ${st.cls}`, attrs: { href: `#/keep/policy/${policy.id}` } }, [
          el("span", { class: "k-rb__ic" }, [icon(policy.icon, { size: 18 })]),
          el("div", { class: "k-rb__main" }, [
            el("div", { class: "k-rb__line", text: policy.line }),
            el("div", { class: "k-rb__sub", text: asset.name }),
          ]),
          el("div", { class: "k-rb__r" }, [
            el("span", { class: "k-rb__tag", text: st.word }),
            el("span", { class: "k-rb__when", text: when }),
          ]),
        ]);
      })
    : [el("div", { class: "k-report__empty", text: "No renewals in the next 60 days — you're all set." })];

  const view = page("home", [
    el("section", { class: "k-welcome" }, [
      el("h1", { class: "k-welcome__h", text: `Welcome back, ${first}` }),
      el("p", { class: "k-welcome__p", text: "What would you like to accomplish today?" }),
      landingCommand(),
    ]),
    el("section", {}, [
      el("div", { class: "k-lbl", text: "At a glance" }),
      el("div", { class: "k-stats" }, [
        statTile("Entities", entities.length),
        statTile("Assets", assets),
        statTile("Active policies", policies),
        statTile("Coverage gaps", gaps, gaps ? "review recommended" : "none open"),
        statTile("Total asset value", money(insured) || "$0"),
        statTile("Lapsed", lapsed, lapsed ? "action needed" : "none"),
      ]),
    ]),
    el("section", { class: "k-report" }, [
      el("div", { class: "k-report__h" }, [
        el("h2", {}, [icon("bell", { size: 18 }), el("span", { text: "Renewals coming up" })]),
        el("span", { class: "k-report__count", text: renewals.length ? `${renewals.length} within 60 days` : "All clear" }),
      ]),
      el("div", { class: "k-report__list" }, renewalRows),
    ]),
    pendingRequestsReport(requests, role),
  ]);
  mount(view);
}

// Policies — every policy across all entities in one table, sorted by clicking
// the column headers (defaults to Renewal, soonest first).
export function renderKeepInsurance() {
  const rows = collectPolicies();

  function docCell(policy, asset, entity) {
    const docs = policy.documents || [];
    if (!docs.length) return el("span", { class: "k-imuted", text: "—" });
    return el("div", { class: "k-idocs" }, docs.map((d) =>
      docItem(d, `#/keep/policy/${policy.id}`, [policy.line, asset.name, entity.name])));
  }

  const columns = [
    { label: "Policy", get: (r) => r.policy.line, cell: (r) => [
      el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${r.policy.id}` }, text: r.policy.line }),
      el("div", { class: "k-imuted", text: r.policy.number || "" }),
    ] },
    { label: "Entity", get: (r) => r.entity.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/entity/${r.entity.id}` }, text: r.entity.name }) },
    { label: "Asset", get: (r) => r.asset.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${r.asset.id}` }, text: r.asset.name }) },
    { label: "Carrier", get: (r) => r.policy.carrier || "", cell: (r) => el("span", { text: r.policy.carrier || "—" }) },
    { label: "Renewal", get: (r) => r.policy.renewalInDays, cell: (r) => expiryBadge(r.policy.renewalInDays) },
    { label: "Premium", cell: (r) => el("span", { text: r.policy.premium || "—" }) },
    { label: "Documents", cell: (r) => docCell(r.policy, r.asset, r.entity) },
  ];

  const view = page("insurance", [
    el("h1", { class: "k-h1", text: "Policies" }),
    el("p", { class: "k-sub", text: `Every policy across your entities — ${rows.length} on file.` }),
    rows.length
      ? sortableTable(columns, rows, { defaultIdx: 4, defaultDir: 1 }).wrap  // Renewal, soonest first
      : el("div", { class: "k-empty", text: "No policies on file yet — your broker adds them as they're bound." }),
  ]);
  mount(view);
}

// Assets — every asset across all entities in one table, sorted by clicking the
// column headers (defaults to Entity). Assets whose entity didn't load (true
// orphans) are flagged; the "￿" sort key keeps them last when sorting by
// Entity ascending.
export function renderKeepAssets() {
  const rows = getAllAssets();          // [{ asset, entity|null }]
  const orphanCount = rows.filter((r) => !r.entity).length;

  function entityCell(entity) {
    if (!entity) return el("span", { class: "k-orphanbadge", text: "Orphan · no entity" });
    return el("a", { class: "k-ilink", attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name });
  }

  const columns = [
    { label: "Asset", get: (r) => r.asset.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${r.asset.id}` }, text: r.asset.name }) },
    { label: "Type", get: (r) => assetTypeLabel(r.asset), cell: (r) => el("span", { text: assetTypeLabel(r.asset) }) },
    { label: "Entity", get: (r) => (r.entity ? r.entity.name : "￿"), cell: (r) => entityCell(r.entity) },
    { label: "Value", get: (r) => r.asset.value || 0, cell: (r) => el("span", { text: r.asset.value ? money(r.asset.value) : "—" }) },
    { label: "Policies", get: (r) => (r.asset.policies || []).length, cell: (r) => el("span", { text: String((r.asset.policies || []).length) }) },
  ];

  const view = page("assets", [
    el("div", { class: "k-reqhead" }, [
      el("div", {}, [
        el("h1", { class: "k-h1", text: "Assets" }),
        el("p", { class: "k-sub", text: `Every asset across your entities — ${rows.length} on file${orphanCount ? ` · ${orphanCount} orphan${orphanCount === 1 ? "" : "s"}` : ""}.` }),
      ]),
      el("a", { class: "k-btn", attrs: { href: "#/keep/add-asset" } }, [icon("plus", { size: 18 }), el("span", { text: "Add asset" })]),
    ]),
    rows.length
      ? sortableTable(columns, rows, { defaultIdx: 2, defaultDir: 1, rowClass: (r) => (r.entity ? "" : "k-trorphan") }).wrap  // Entity
      : el("div", { class: "k-empty", text: "No assets yet — use Add asset to add one." }),
  ]);
  mount(view);
}

// Segmented switch across the three views of the same entities: a compact Rows
// list, a Cards grid, and the Relationships map. `active` is "rows" | "cards" |
// "map"; each segment deep-links to its route.
function entitiesToggle(active) {
  const seg = (label, iconName, href, key) => el("a", {
    class: `k-seg__btn${active === key ? " is-on" : ""}`,
    attrs: { href, role: "tab", "aria-selected": String(active === key) },
  }, [icon(iconName, { size: 16 }), el("span", { text: label })]);
  return el("div", { class: "k-seg", attrs: { role: "tablist", "aria-label": "Entities view" } }, [
    seg("Rows", "clipboard", "#/keep/list", "rows"),
    seg("Cards", "book", "#/keep/grid", "cards"),
    seg("Relationships", "swap", "#/keep/entities", "map"),
  ]);
}

function svgText(str, attrs) { const t = s("text", attrs); t.textContent = str; return t; }

// Two-letter initials for an asset name: first letters of the first two words
// that contain a letter (so "123 Marina Way" → "MW", "Ghost Van" → "GV").
function assetInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (String(name || "").replace(/\s/g, "").slice(0, 2) || "?").toUpperCase();
}

// Where the ray from a node centre (cx,cy, half-size hw/hh) toward (tx,ty)
// crosses the node's rectangle border — used to trim edges to the card edge so
// the ownership arrowhead sits in the gap, not hidden under a card.
function nodeBorderPoint(cx, cy, hw, hh, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: cx + dx * t, y: cy + dy * t };
}
// Move point p a distance `d` toward q.
function movePointToward(p, q, d) {
  const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / len) * d, y: p.y + (dy / len) * d };
}

// Inline-SVG relationship graph, built live from the entity_relationships table.
// Owners sit above what they own (top-down layered layout — see keep/relmap.js
// orchestrate); each owned entity shows its ownership split as a cap-table bar,
// and control-only links (a trustee with no stake) are dashed and role-labelled.
// Nodes for entities you manage are keyboard-focusable and open their detail.
const REL_STYLE = {
  me: { fill: "url(#relme)", avFill: "rgba(255,255,255,.25)", avText: "#fff", nameFill: "#fff", subFill: "rgba(255,255,255,.85)", stroke: null },
  person: { fill: "#fff", avFill: "#E7EFFE", avText: "#2F6AF6", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  biz: { fill: "#fff", avFill: "#fbe0e1", avText: "#c42b30", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  np: { fill: "#fff", avFill: "#defaef", avText: "#0e8e66", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
  trust: { fill: "#fff", avFill: "#fff1de", avText: "#b5660a", nameFill: "#1B2540", subFill: "#55607F", stroke: "#E3EBFA" },
};
// Owner-type colours for ownership edges and cap-table segments — the project's
// original palette (blue = people, red = business, amber = trust, green =
// nonprofit), so a colour on the map always reads as an entity type, not a
// per-owner rainbow. Matches the accent/danger/warn/ok tokens in tokens.css.
const REL_TYPE_COLOR = { me: "#2F6AF6", person: "#6E9BF5", biz: "#C42B30", trust: "#B5660A", np: "#0E8E66" };
// Band order for the "by type" perspective: people, trusts, businesses.
const REL_BAND = { me: 0, person: 0, trust: 1, biz: 2, np: 2 };
// View controls for the Relationships map — held across in-view re-renders so the
// toolbar and the chart stay in sync. orient: vertical|horizontal · mode:
// ownership (by depth) | type (by category) · focus: entity id or null · chips /
// trustees: declutter toggles.
const relView = { orient: "vertical", mode: "ownership", focus: null, chips: true, trustees: true };
// DB entity node → REL_STYLE key. Personal renders as the gradient "me" node;
// nonprofit businesses (green) split from for-profit businesses (red) by subtype.
function relStyleKey(node) {
  if (node.kind === "personal") return "me";
  if (node.kind === "business") return isNonprofitType(node.subtype) ? "np" : "biz";
  if (node.kind === "trust") return "trust";
  return "person";
}
// Node geometry and layout spacing. The map lays out top-down by ownership depth
// (owners above what they own) — see keep/relmap.js orchestrate — and sizes the
// canvas to the busiest row and the depth of the deepest chain, so boxes never
// pack tighter than one node + gap.
const REL_NODE_W = 210, REL_NODE_H = 118, REL_HGAP = 30, REL_VGAP = 46, REL_PAD = 34;
const REL_DUMMY_W = 16;   // routing-waypoint slot width on the cross axis
// Below this on-screen box width the map stops shrinking and pans instead.
const REL_MIN_NODE_PX = 150;
// Manual zoom bounds and per-click step (relative to the fit scale's natural 1×).
const REL_ZOOM_MIN = 0.3, REL_ZOOM_MAX = 2.4, REL_ZOOM_STEP = 1.25;
// Lay the graph out per the current relView. Bands (ownership layers, or type
// groups) stack along one axis; members spread along the other. Orientation swaps
// which axis is which — vertical stacks bands top-down, horizontal stacks them
// left-to-right (spreading deep chains across the width). Trustee links are
// dropped from the graph when that declutter toggle is off.
// Cross-axis placement: start each row left-packed, then iterate every node toward
// the average position of its neighbours while preserving row order and a minimum
// separation — so nodes line up under their owners without overlapping.
function alignCross(order, rows, up, down, sepOf) {
  const c = {};
  order.forEach((r) => { let acc = 0; rows[r].forEach((id, i) => { if (i > 0) acc += sepOf(rows[r][i - 1], id); c[id] = acc; }); });
  const place = (ids) => {
    const d = ids.map((id) => { const nb = [...(up[id] || []), ...(down[id] || [])]; return nb.length ? nb.reduce((s, q) => s + c[q], 0) / nb.length : c[id]; });
    for (let i = 1; i < ids.length; i++) d[i] = Math.max(d[i], d[i - 1] + sepOf(ids[i - 1], ids[i]));       // no overlap
    for (let i = ids.length - 2; i >= 0; i--) d[i] = Math.min(d[i], d[i + 1] - sepOf(ids[i], ids[i + 1]));  // pull toward centre
    for (let i = 1; i < ids.length; i++) d[i] = Math.max(d[i], d[i - 1] + sepOf(ids[i - 1], ids[i]));       // re-assert feasibility
    ids.forEach((id, i) => { c[id] = d[i]; });
  };
  for (let p = 0; p < 10; p++) { const seq = p % 2 ? order.slice().reverse() : order; seq.forEach((r) => place(rows[r])); }
  return c;
}
// A smooth path through a list of points, curving along the band axis (down for
// vertical, across for horizontal) so routed edges bow instead of zig-zagging.
function relSpline(pts, horiz) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    if (horiz) { const mx = (p.x + q.x) / 2; d += ` C ${mx} ${p.y}, ${mx} ${q.y}, ${q.x} ${q.y}`; }
    else { const my = (p.y + q.y) / 2; d += ` C ${p.x} ${my}, ${q.x} ${my}, ${q.x} ${q.y}`; }
  }
  return d;
}

function relLayout() {
  const data = getMapData();
  const nodes = data.nodes.map((n) => ({ ...n, sk: relStyleKey(n) }));
  const edges = relView.trustees ? data.edges : data.edges.filter((e) => parsePct(e.stake) != null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const horiz = relView.orient === "horizontal";

  // Ownership uses the orchestrated (crossing-minimized, waypoint-routed) layout;
  // "by type" uses the simple categorical bands.
  let order, rows, dummy = {}, edgePath = {}, up = {}, down = {};
  if (relView.mode === "type") {
    ({ order, rows } = typeBands(nodes, (n) => REL_BAND[n.sk] ?? 2));
    order.forEach((b) => rows[b].forEach((id) => { up[id] = []; down[id] = []; }));
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
function setupRelViewport(wrap, svg, W, H) {
  const MIN_K = REL_MIN_NODE_PX / REL_NODE_W;      // scale at which a node is exactly the floor width
  let k = 1, tx = 0, ty = 0, fitted = false;
  const applyT = () => { svg.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`; };
  // Keep at least a margin of the chart on-screen; centre it on the axes where it fits.
  const clampPan = (vw, vh) => {
    const cw = W * k, ch = H * k, M = 48;
    tx = cw <= vw ? (vw - cw) / 2 : Math.min(M, Math.max(vw - cw - M, tx));
    ty = ch <= vh ? (vh - ch) / 2 : Math.min(M, Math.max(vh - ch - M, ty));
  };
  const fit = () => {
    const vw = wrap.clientWidth || 0, vh = wrap.clientHeight || 0;
    if (!vw || !vh) return;
    k = Math.max(MIN_K, Math.min(vw / W, vh / H, 1));   // fit the whole chart, but not below the node floor
    tx = (vw - W * k) / 2; ty = (vh - H * k) / 2;        // centre it
    clampPan(vw, vh); applyT(); fitted = true;
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!wrap.isConnected) { if (fitted) ro.disconnect(); return; }
      fit();                                              // recompute fit scale + re-centre on every resize
    });
    ro.observe(wrap);
  }
  // Manual zoom: scale around the viewport centre so the focal point stays put,
  // then re-clamp the pan. Exposed for the on-map +/- buttons.
  const zoom = (dir) => {
    const vw = wrap.clientWidth || 0, vh = wrap.clientHeight || 0;
    if (!vw || !vh) return;
    const nk = Math.max(REL_ZOOM_MIN, Math.min(REL_ZOOM_MAX, dir > 0 ? k * REL_ZOOM_STEP : k / REL_ZOOM_STEP));
    if (nk === k) return;
    const cx = (vw / 2 - tx) / k, cy = (vh / 2 - ty) / k;   // content point under the viewport centre
    k = nk; tx = vw / 2 - cx * k; ty = vh / 2 - cy * k;
    clampPan(vw, vh); applyT();
  };
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

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Ownership map of your entities", class: "k-relsvg" });
  svg.appendChild(s("defs", {}, [
    s("linearGradient", { id: "relme", x1: "0", y1: "0", x2: "1", y2: "1" }, [
      s("stop", { offset: "0", "stop-color": "#6F9BFF" }), s("stop", { offset: "1", "stop-color": "#2F6AF6" }),
    ]),
    // Arrowhead pointing from an owner to the entity it owns.
    s("marker", { id: "rel-arrow", viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "9", markerHeight: "9", orient: "auto", markerUnits: "userSpaceOnUse" }, [
      s("path", { d: "M0,0 L10,5 L0,10 L2.5,5 Z", fill: "#b9c4dd" }),
    ]),
  ]));

  // Edges under the nodes. A stake edge is tinted with its owner's type colour
  // (matching that owner's segment in the owned entity's cap-table bar) and carries
  // no label — the percentage lives on the bar. A control-only link (Trustee, no
  // stake) is a dashed grey line labelled with its role.
  const edgeRefs = edges.map((e) => {
    const stake = parsePct(e.stake) != null;
    const owner = byId.get(e.from);
    const color = stake ? (REL_TYPE_COLOR[owner ? owner.sk : "person"] || "#c3b2f0") : "#c7d0e4";
    const op = edgeDim(e) ? "0.08" : (stake ? "0.85" : "0.7");
    const path = s("path", { fill: "none", stroke: color, "stroke-width": stake ? "2.5" : "2", "stroke-linecap": "round", "marker-end": "url(#rel-arrow)", opacity: op, "stroke-dasharray": stake ? "" : "1 6" });
    svg.appendChild(path);
    let lrect = null, ltext = null;
    if (!stake && e.role) {
      const lop = edgeDim(e) ? "0.1" : null;
      lrect = s("rect", Object.assign({ rx: 10, height: 20, fill: "#ffffff", stroke: "#E3EBFA" }, lop ? { opacity: lop } : {}));
      ltext = svgText(e.role, Object.assign({ "text-anchor": "middle", "font-size": "10.5", "font-weight": "700", fill: "#7A85A0", "font-family": FS }, lop ? { opacity: lop } : {}));
    }
    return { ...e, stake, path, lrect, ltext, wp: (waypoints && waypoints[e.from + ">" + e.to]) || [] };
  });
  const HW = NODE_W / 2, HH = NODE_H / 2, GAP = 6;
  const updateEdges = () => {
    edgeRefs.forEach((er) => {
      const a = center(er.from), b = center(er.to);
      // Route the edge from the owner (er.from), through any dummy waypoints, to the
      // arrowhead on what it owns (er.to). Trim the first/last segment to the card
      // borders and draw a smooth spline through the whole run so long edges bend
      // through the layers instead of cutting across.
      const first = er.wp.length ? er.wp[0] : b;
      const last = er.wp.length ? er.wp[er.wp.length - 1] : a;
      const s0 = movePointToward(nodeBorderPoint(a.x, a.y, HW, HH, first.x, first.y), first, GAP);
      const e0 = movePointToward(nodeBorderPoint(b.x, b.y, HW, HH, last.x, last.y), last, GAP);
      const pts = [s0, ...er.wp, e0];
      er.path.setAttribute("d", relSpline(pts, horiz));
      if (er.lrect) {                          // centre the role label on the run's midpoint
        const mid = pts[Math.floor(pts.length / 2)] || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const lw = (er.role.length * 6.1) + 16;
        er.lrect.setAttribute("x", mid.x - lw / 2); er.lrect.setAttribute("y", mid.y - 10); er.lrect.setAttribute("width", lw);
        er.ltext.setAttribute("x", mid.x); er.ltext.setAttribute("y", mid.y + 4);
      }
    });
  };

  nodes.forEach((n) => {
    const o = REL_STYLE[n.sk];
    const top = n.cy - NODE_H / 2;
    const interactive = Boolean(n.href);
    const cap = caps[n.id];
    // Speak the ownership split to assistive tech — the bar's percentages are
    // otherwise only in hover <title>s, which never fire on touch (iPad Safari).
    const ownDesc = cap && cap.length
      ? " Owned by " + cap.map((c) => { const ow = byId.get(c.ownerId); return `${ow ? ow.name : "an owner"} ${c.pct}%`; }).join(", ") + "."
      : "";
    const g = s("g", interactive
      ? { class: "k-relnode k-relnode--link", tabindex: "0", role: "link", "aria-label": `Open ${n.name}.${ownDesc}` }
      : { class: "k-relnode k-relnode--static", role: "img", "aria-label": `${n.name} (sample).${ownDesc}` });
    const dim = nodeDim(n.id);
    if (dim) g.setAttribute("opacity", dim);
    g.appendChild(s("rect", { x: n.x, y: top, width: NODE_W, height: NODE_H, rx: 18, fill: o.fill, stroke: o.stroke || "none", "stroke-width": o.stroke ? "1.5" : "0" }));
    const ax = n.x + 34, avy = top + 30;
    g.appendChild(s("circle", { cx: ax, cy: avy, r: 17, fill: o.avFill }));
    g.appendChild(svgText(n.initials, { x: ax, y: avy + 5, "text-anchor": "middle", "font-size": "13", "font-weight": "800", fill: o.avText, "font-family": FD }));
    g.appendChild(svgText(n.name, { x: ax + 28, y: top + 26, "font-size": "13", "font-weight": "700", fill: o.nameFill, "font-family": FD }));
    g.appendChild(svgText(n.sub, { x: ax + 28, y: top + 41, "font-size": "11", "font-weight": "600", fill: o.subFill, "font-family": FS }));

    // Asset chips: little circles for what this entity holds — initials inside,
    // full name on hover. Overflow collapses to a "+N" chip.
    const owned = relView.chips ? (n.assetNames || []) : [];
    if (owned.length) {
      const dark = n.sk === "me";
      const cFill = dark ? "rgba(255,255,255,.22)" : "#EEF2FB";
      const cText = dark ? "#ffffff" : "#3A4A6B";
      const cStroke = dark ? "rgba(255,255,255,.4)" : "#DCE4F4";
      const MAX = 6, shown = owned.length > MAX ? 5 : owned.length;
      let cx = n.x + 24;
      const chip = (label, tip) => {
        const grp = s("g", {});
        grp.appendChild(s("circle", { cx, cy: top + 66, r: 9, fill: cFill, stroke: cStroke, "stroke-width": "1" }));
        grp.appendChild(svgText(label, { x: cx, y: top + 69, "text-anchor": "middle", "font-size": "8", "font-weight": "800", fill: cText, "font-family": FS }));
        if (tip) { const ti = s("title", {}); ti.textContent = tip; grp.appendChild(ti); }
        g.appendChild(grp);
        cx += 21;
      };
      for (let i = 0; i < shown; i++) chip(assetInitials(owned[i]), owned[i]);
      if (owned.length > MAX) chip("+" + (owned.length - 5), owned.slice(5).join(", "));
    }

    // Cap-table bar: the entity's ownership split as one bar summing to 100%, each
    // segment coloured by its owner's type and labelled with the owner's initials.
    // Hairline separators keep same-colour neighbours distinct; a shortfall shows
    // as the faint unfilled remainder.
    if (cap && cap.length) {
      const total = cap.reduce((t, c) => t + c.pct, 0);
      const barX = n.x + 16, barW = NODE_W - 32, barY = top + NODE_H - 26, barH = 16;
      const clipId = "relcap-" + n.id.replace(/[^a-z0-9]/gi, "");
      g.appendChild(s("defs", {}, [s("clipPath", { id: clipId }, [s("rect", { x: barX, y: barY, width: barW, height: barH, rx: 8 })])]));
      const barG = s("g", { "clip-path": `url(#${clipId})` });
      barG.appendChild(s("rect", { x: barX, y: barY, width: barW, height: barH, fill: "#EEF2FB" }));
      let cx = barX;
      [...cap].sort((a, b) => b.pct - a.pct).forEach((c, i) => {
        const w = barW * (c.pct / Math.max(total, 100));
        const owner = byId.get(c.ownerId);
        if (i > 0) barG.appendChild(s("rect", { x: cx - 0.75, y: barY, width: 1.5, height: barH, fill: "#ffffff" }));
        const seg = s("rect", { x: cx, y: barY, width: w, height: barH, fill: REL_TYPE_COLOR[owner ? owner.sk : "person"] || "#9aa5bd" });
        const ti = s("title", {}); ti.textContent = `${owner ? owner.name : "Owner"} — ${c.pct}%`; seg.appendChild(ti);
        barG.appendChild(seg);
        const lbl = `${owner ? owner.initials : "?"} ${c.pct}%`;
        if (w > 46) barG.appendChild(svgText(lbl, { x: cx + w / 2, y: barY + 11, "text-anchor": "middle", "font-size": "9.5", "font-weight": "800", fill: "#ffffff", "font-family": FS }));
        else if (w > 15) barG.appendChild(svgText(`${c.pct}`, { x: cx + w / 2, y: barY + 11, "text-anchor": "middle", "font-size": "9", "font-weight": "800", fill: "#ffffff", "font-family": FS }));
        cx += w;
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

  // Role labels on top of the nodes, then set initial geometry.
  edgeRefs.forEach((er) => { if (er.lrect) { svg.appendChild(er.lrect); svg.appendChild(er.ltext); } });
  updateEdges();

  const wrap = el("div", { class: "k-relmap" }, [svg]);
  // On-map zoom control (bottom-right). stopPropagation on the group's pointerdown
  // keeps a button press from also starting a background pan.
  const zoomOut = el("button", { class: "k-relzoom__b", attrs: { type: "button", "aria-label": "Zoom out" }, text: "−" });
  const zoomIn = el("button", { class: "k-relzoom__b", attrs: { type: "button", "aria-label": "Zoom in" }, text: "+" });
  zoomOut.addEventListener("click", () => { if (wrap.__relzoom) wrap.__relzoom(-1); });
  zoomIn.addEventListener("click", () => { if (wrap.__relzoom) wrap.__relzoom(1); });
  const zoomCtl = el("div", { class: "k-relzoom", attrs: { role: "group", "aria-label": "Zoom" } }, [zoomIn, zoomOut]);
  zoomCtl.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  wrap.appendChild(zoomCtl);
  setupRelViewport(wrap, svg, W, H);
  return wrap;
}

// Total insured/estimated value across an entity's assets.
function entityValue(entity) {
  return entity.assets.reduce((t, a) => t + (a.value || 0), 0);
}
// Option A — a sortable table: click a column header to sort by it (Entity,
// Type, Subtype, Assets, Gaps or Value); click again to flip direction. Type is
// the broad category (Individual/Business/Trust); Subtype is the specific kind.
function entityTable(entities, settings) {
  const rows = entities.map((e) => ({ e, sum: entitySummary(e, settings), val: entityValue(e) }));
  const columns = [
    { label: "Entity", get: (r) => r.e.name, cell: (r) => el("a", { class: "k-etcell k-ilink", attrs: { href: `#/keep/entity/${r.e.id}` } }, [
      entityAvatar(r.e), el("span", { class: "k-etcell__name", text: r.e.name }),
    ]) },
    { label: "Type", get: (r) => entityCategory(r.e), cell: (r) => el("span", { class: `k-et k-et--${colorSuffix(r.e)}`, text: entityCategory(r.e) }) },
    { label: "Subtype", get: (r) => entitySubtype(r.e), cell: (r) => el("span", { class: "k-etsub", text: entitySubtype(r.e) }) },
    { label: "Assets", get: (r) => r.e.assets.length, cell: (r) => el("span", { text: String(r.e.assets.length) }) },
    { label: "Gaps", get: (r) => r.sum.gaps, cell: (r) => el("span", { text: String(r.sum.gaps) }) },
    { label: "Value", get: (r) => r.val, cell: (r) => el("span", { text: r.val ? money(r.val) : "—" }) },
  ];
  return el("div", { class: "k-enttable" }, [sortableTable(columns, rows, {
    defaultIdx: 0, defaultDir: 1, rowHref: (r) => `#/keep/entity/${r.e.id}`,
  }).wrap]);
}

// Option B — a uniform tile per entity in a responsive grid.
function entityTile(entity, settings) {
  const sum = entitySummary(entity, settings);
  const val = entityValue(entity);
  const suffix = colorSuffix(entity);
  const subtype = entitySubtype(entity);
  const stat = (v, l) => el("div", { class: "k-etile__stat" }, [el("b", { text: String(v) }), el("span", { text: l })]);
  // Landscape tile: colour bar + avatar on the left, name/type in the middle,
  // stats on the right — wider and shorter than a stacked card.
  return el("a", { class: `k-etile k-etile--${suffix}`, attrs: { href: `#/keep/entity/${entity.id}`, draggable: "true", "data-id": entity.id } }, [
    el("span", { class: "k-etile__bar" }),
    entityAvatar(entity),
    el("div", { class: "k-etile__body" }, [
      el("div", { class: "k-etile__name", text: entity.name }),
      el("div", { class: "k-etile__meta" }, [
        el("span", { class: `k-et k-et--${suffix}`, text: entityCategory(entity) }),
        subtype !== "—" ? el("span", { class: "k-etile__sub", text: subtype }) : null,
      ]),
    ]),
    el("div", { class: "k-etile__stats" }, [
      stat(sum.assets, sum.assets === 1 ? "Asset" : "Assets"),
      stat(sum.gaps, sum.gaps === 1 ? "Gap" : "Gaps"),
      stat(val ? money(val) : "—", "Value"),
    ]),
  ]);
}

// Shared Entities collection: the Rows and Cards layouts share the header,
// privacy row and "New entity" button; only the body markup differs.
// Shared privacy line + "New entity" button, shown across all Entities views.
function entitiesPrivacyRow() {
  return el("div", { class: "k-privacyrow" }, [
    el("div", { class: "k-privacy" }, [
      icon("lock", { size: 16 }),
      el("span", { text: "Encrypted & private — only you and your broker." }),
      el("a", { attrs: { href: "#/keep/security" }, text: "How we protect you" }),
    ]),
    el("button", { class: "k-btn k-btn--sm", attrs: { type: "button", "data-go": "/keep/add-entity" } }, [icon("plus", { size: 16 }), el("span", { text: "New entity" })]),
  ]);
}

// Order entities for the Cards grid: the saved drag order first, then any
// entity not in the saved order (new ones) appended in name order.
function orderedForCards(entities) {
  const order = loadCardOrder();
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...entities].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
    return ra - rb || a.name.localeCompare(b.name);
  });
}

// Which tile the dragged card should be inserted before, given the cursor — the
// nearest tile whose center is after the cursor in reading order (null = end).
function tileBefore(container, x, y) {
  let best = null, bestDist = Infinity;
  for (const t of container.querySelectorAll(".k-etile:not(.k-etile--drag)")) {
    const r = t.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const after = (y < cy - r.height / 2) || (Math.abs(y - cy) <= r.height / 2 && x < cx);
    if (!after) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

// FLIP: run `mutate()` (which reorders tiles) then animate every tile from its
// old box to its new one so the grid glides into place instead of snapping.
function flipReorder(grid, mutate) {
  const before = new Map([...grid.querySelectorAll(".k-etile")].map((t) => [t, t.getBoundingClientRect()]));
  mutate();
  for (const t of grid.querySelectorAll(".k-etile")) {
    const a = before.get(t); if (!a) continue;
    const b = t.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    t.style.transition = "none";
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      t.style.transition = "transform .2s ease";
      t.style.transform = "";
    });
    setTimeout(() => { t.style.transition = ""; t.style.transform = ""; }, 240);
  }
}

// Drag-to-reorder within a card strip (HTML5 DnD). A drop-bar shows where the
// card will land (no reflow while dragging); the reorder animates on drop.
// `saveRoot` is the element whose full tile order is persisted (defaults to the
// strip itself; for type-grouped strips it's the wrapper spanning all groups).
function enableCardDrag(grid, saveRoot) {
  const root = saveRoot || grid;
  let dragEl = null;
  const bar = el("div", { class: "k-dropbar", attrs: { "aria-hidden": "true" } });
  bar.hidden = true;
  grid.appendChild(bar);

  function showBar(before) {
    const g = grid.getBoundingClientRect();
    let r, x;
    if (before) { r = before.getBoundingClientRect(); x = r.left - g.left - 8; }
    else {
      const tiles = grid.querySelectorAll(".k-etile");
      const last = tiles[tiles.length - 1];
      if (!last) { bar.hidden = true; return; }
      r = last.getBoundingClientRect(); x = r.right - g.left + 4;
    }
    bar.style.transform = `translate(${x}px, ${r.top - g.top}px)`;
    bar.style.height = `${r.height}px`;
    bar.hidden = false;
  }

  grid.addEventListener("dragstart", (e) => {
    const tile = e.target.closest(".k-etile");
    if (!tile) return;
    dragEl = tile;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", tile.dataset.id); } catch (_) { /* Safari */ }
    requestAnimationFrame(() => tile.classList.add("k-etile--drag"));
  });
  grid.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    showBar(tileBefore(grid, e.clientX, e.clientY));   // only move the indicator
  });
  grid.addEventListener("drop", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const before = tileBefore(grid, e.clientX, e.clientY);
    const el2 = dragEl;
    flipReorder(grid, () => {
      if (before) grid.insertBefore(el2, before); else grid.appendChild(el2);
      grid.appendChild(bar);   // keep the (absolute) bar out of the tile order
    });
    bar.hidden = true;
    el2.classList.remove("k-etile--drag");
    dragEl = null;
    saveCardOrder([...root.querySelectorAll(".k-etile")].map((t) => t.dataset.id));
  });
  grid.addEventListener("dragend", () => {
    bar.hidden = true;
    if (dragEl) { dragEl.classList.remove("k-etile--drag"); dragEl = null; }
  });
}

// Cards are grouped into type rows in a fixed order: Individuals, then
// Businesses, then Trusts. Each row scrolls horizontally if it overflows.
const CARD_GROUPS = [
  { title: "Individuals", match: (e) => e.kind === "personal" || e.kind === "person" },
  { title: "Companies", match: (e) => e.kind === "business" },
  { title: "Trusts", match: (e) => e.kind === "trust" },
];

async function renderEntityCollection(layout) {
  const settings = await getRuleDefaults();
  const entities = getEntities();
  let body;
  if (layout === "cards") {
    const ordered = orderedForCards(entities);
    const groupsWrap = el("div", { class: "k-etgroups" });
    for (const g of CARD_GROUPS) {
      const items = ordered.filter(g.match);
      if (!items.length) continue;                 // hide empty type rows
      const strip = el("div", { class: "k-etstrip" }, items.map((e) => entityTile(e, settings)));
      enableCardDrag(strip, groupsWrap);            // reorder within the row; persist the full order
      groupsWrap.appendChild(el("section", { class: "k-etgroup" }, [
        el("div", { class: "k-etgroup__h" }, [el("h2", { text: g.title }), el("span", { class: "k-etgroup__count", text: String(items.length) })]),
        strip,
      ]));
    }
    body = el("div", {}, [
      el("p", { class: "k-relcaption k-relcaption--top", text: "Grouped by type. Drag cards to rearrange — your order is saved on this device." }),
      groupsWrap,
    ]);
  } else {
    body = entityTable(entities, settings);
  }
  const view = page("list", [
    el("h1", { class: "k-h1", text: "Entities" }),
    entitiesToggle(layout),
    entitiesPrivacyRow(),
    entities.length ? body : el("div", { class: "k-empty", text: "No entities yet — use New entity to add one." }),
  ]);
  mount(view);
}

export function renderKeepEntityList() { return renderEntityCollection("rows"); }
export function renderKeepEntityGrid() { return renderEntityCollection("cards"); }

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
      relCheck("Control links", relView.trustees, (v) => set({ trustees: v })),
    ])),
    fit,
  ]);
}

export function renderKeepEntities() {
  // Redraw only the chart on a control change; the toolbar keeps its own state.
  const host = el("div", { class: "k-relhost" });
  const drawMap = () => { host.textContent = ""; host.appendChild(relationshipMap()); };
  const tools = relToolbar(drawMap, host);
  drawMap();
  const view = page("list", [
    el("h1", { class: "k-h1", text: "Entities" }),
    entitiesToggle("map"),
    entitiesPrivacyRow(),
    tools,
    host,
    el("p", { class: "k-relcaption", text: "Each arrow points from an owner to what it owns; the bar on an entity shows its ownership split, coloured by owner type (blue people, red businesses, amber trusts). Use the controls above to re-orient, regroup, focus on one entity, or declutter. Drag anywhere to move the map; tap an entity you manage to open it." }),
  ]);
  mount(view);
}

export async function renderKeepEntity(params, id) {
  const entity = getEntity(id);
  if (!entity) return renderKeepEntityList();
  const settings = await getRuleDefaults();
  const suffix = colorSuffix(entity);
  const sum = entitySummary(entity, settings);
  const value = entityValue(entity);
  const subtype = entitySubtype(entity);

  // Compact identity header (avatar + name + category) with the primary action.
  const header = el("div", { class: "k-ehero" }, [
    entityAvatar(entity),
    el("div", { class: "k-ehero__id" }, [
      el("div", { class: "k-ehero__top" }, [
        el("h1", { text: entity.name }),
        el("span", { class: `k-et k-et--${suffix}`, text: entityCategory(entity) }),
      ]),
      subtype !== "—" ? el("div", { class: "k-ehero__sub", text: subtype }) : null,
    ]),
    el("a", { class: "k-btn", attrs: { href: `#/keep/add-asset/${entity.id}` } }, [icon("plus", { size: 18 }), el("span", { text: "Add asset" })]),
  ]);

  // At-a-glance parameters, each in its own block — fills the panel tidily
  // instead of leaving one large empty box.
  const paramList = [
    { l: "Category", v: entityCategory(entity) },
    { l: "Subtype", v: subtype === "—" ? "Not set" : subtype },
    { l: "Assets", v: String(sum.assets) },
    { l: "Coverage in place", v: String(sum.inPlace) },
    { l: "Open gaps", v: String(sum.gaps), tone: sum.gaps > 0 ? "warn" : null },
    { l: "Insured value", v: value ? money(value) : "—" },
  ];
  const paramGrid = el("div", { class: "k-params" }, paramList.map((p) =>
    el("div", { class: `k-param${p.tone ? ` k-param--${p.tone}` : ""}` }, [
      el("div", { class: "k-param__l", text: p.l }),
      el("div", { class: "k-param__v", text: p.v }),
    ])));

  const view = page("list", [
    backLink("#/keep/list", "entities"),
    el("nav", { class: "k-crumbs" }, [el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(), el("span", { text: entity.name })]),
    el("section", { class: `k-epanel k-panel--${suffix}` }, [header, paramGrid]),
    el("section", { class: "k-eassets" }, [
      el("div", { class: "k-lbl", text: "Assets in this entity" }),
      entity.assets.length
        ? el("div", { class: "k-agrid" }, entity.assets.map((a) => assetCard(a, settings)))
        : el("p", { class: "k-setnote", text: "No assets yet — use Add asset above." }),
    ]),
  ]);
  mount(view);
}

export async function renderKeepAsset(params, id) {
  const found = findAsset(id);
  if (!found) return renderKeepEntityList();
  const { entity, asset } = found;
  const settings = await getRuleDefaults();
  const { mustHave, recommended, gaps } = analyzeAsset(asset, settings);
  // Fall back to a neutral marker for any asset type not in ASSET_META (e.g. a
  // freshly-added "other"/land asset) so the detail page never blanks out.
  const assetMeta = ASSET_META[asset.type] || { cic: "home", icon: "shield" };

  const covRow = (c) => el("div", { class: `k-crow${c.status === "gap" ? " gap" : ""}` }, [
    el("span", { class: `k-cic k-cic--${assetMeta.cic}` }, [icon(c.icon, { size: 26 })]),
    el("div", { class: "k-crow__main" }, [
      el("div", { class: "k-crow__name", text: c.title }),
      el("div", { class: "k-crow__why", text: c.why }),
    ]),
    el("div", { class: "k-crow__r" }, [
      coveragePill(c.status),
    ]),
  ]);

  const sections = [
    backLink(`#/keep/entity/${entity.id}`, entity.name),
    el("nav", { class: "k-crumbs" }, [
      el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(),
      el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), sep(),
      el("span", { text: asset.name }),
    ]),
    el("div", { class: "k-ahero" }, [
      el("span", { class: `k-cic k-cic--${assetMeta.cic}` }, [icon(assetMeta.icon, { size: 34 })]),
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
        el("p", { text: `Recommended coverage that isn't in place yet. Bring these to your next review with ${BROKER_NAME} to close the gaps.` }),
      ]),
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

  mount(page("list", sections, { narrow: true }));
}

// Asset choices grouped by section. `type` is the underlying category that
// drives icon + coverage analysis (home/auto/watercraft/valuables/commercial-*/
// other); `label` is the specific kind stored on the asset and shown in lists.
// `entity: true` diverts to the add-entity flow (a company is an entity).
const ASSET_GROUPS = [
  { title: "Property", items: [
    { type: "home", label: "Home", sub: "Single-family you own & live in", icon: "home" },
    { type: "home", label: "Condo", sub: "Condominium unit", icon: "home" },
    { type: "home", label: "Townhouse", sub: "Attached home you own", icon: "home" },
    { type: "home", label: "Rental property", sub: "You rent it to others", icon: "commercial-property" },
    { type: "home", label: "Vacation / second home", sub: "A home you don't live in full-time", icon: "home" },
    { type: "home", label: "Mobile / manufactured home", sub: "Manufactured housing", icon: "home" },
    { type: "other", label: "Land / vacant lot", sub: "Undeveloped land you own", icon: "shield" },
    { type: "commercial-space", label: "Commercial property", sub: "Office, retail or space you own", icon: "commercial-property" },
  ] },
  { title: "Vehicles", items: [
    { type: "auto", label: "Car, truck or SUV", sub: "Personal vehicle", icon: "auto" },
    { type: "auto", label: "Motorcycle", sub: "Motorcycle or scooter", icon: "auto" },
    { type: "auto", label: "RV / motorhome", sub: "Recreational vehicle", icon: "auto" },
    { type: "auto", label: "ATV / off-road", sub: "ATV, UTV or dirt bike", icon: "auto" },
    { type: "watercraft", label: "Boat / watercraft", sub: "Boat, yacht or jet ski", icon: "boat" },
    { type: "commercial-auto", label: "Commercial vehicle", sub: "Van or truck used for business", icon: "commercial-auto" },
  ] },
  { title: "Valuables & belongings", items: [
    { type: "valuables", label: "Jewelry & watches", sub: "Rings, watches, fine jewelry", icon: "gem" },
    { type: "valuables", label: "Fine art", sub: "Paintings, sculpture", icon: "gem" },
    { type: "valuables", label: "Collectibles", sub: "Wine, coins, memorabilia", icon: "gem" },
    { type: "valuables", label: "Firearms", sub: "Guns & related equipment", icon: "gem" },
    { type: "valuables", label: "Electronics & equipment", sub: "High-value gear", icon: "gem" },
    { type: "commercial-space", label: "Commercial equipment", sub: "Tools, machinery, inventory", icon: "briefcase" },
  ] },
  { title: "Business", items: [
    { type: "business", label: "Restaurant", sub: "Full-service or fast casual", icon: "briefcase" },
    { type: "business", label: "Café / coffee shop", sub: "Coffee, bakery, quick-serve", icon: "briefcase" },
    { type: "business", label: "Bar / nightclub", sub: "Tavern, brewery, lounge", icon: "briefcase" },
    { type: "business", label: "Hotel / hospitality", sub: "Hotel, motel, B&B", icon: "briefcase" },
    { type: "business", label: "Retail store", sub: "Shop, boutique, showroom", icon: "briefcase" },
    { type: "business", label: "Grocery / convenience", sub: "Market, deli, convenience", icon: "briefcase" },
    { type: "business", label: "E-commerce / online", sub: "Online store or marketplace", icon: "briefcase" },
    { type: "business", label: "Salon / spa / barber", sub: "Beauty & personal care", icon: "briefcase" },
    { type: "business", label: "Gym / fitness", sub: "Studio, gym, wellness", icon: "briefcase" },
    { type: "business", label: "Auto service", sub: "Repair, body, detailing", icon: "briefcase" },
    { type: "business", label: "Medical / dental practice", sub: "Clinic, dental, therapy", icon: "briefcase" },
    { type: "business", label: "Professional services", sub: "Law, accounting, consulting", icon: "briefcase" },
    { type: "business", label: "Real estate / property mgmt", sub: "Brokerage, landlord, PM", icon: "briefcase" },
    { type: "business", label: "Construction / contractor", sub: "GC, remodeler, developer", icon: "briefcase" },
    { type: "business", label: "Trades", sub: "Electrical, plumbing, HVAC", icon: "briefcase" },
    { type: "business", label: "Manufacturing", sub: "Production or fabrication", icon: "briefcase" },
    { type: "business", label: "Warehouse / distribution", sub: "Storage, wholesale, 3PL", icon: "briefcase" },
    { type: "business", label: "Transportation / logistics", sub: "Trucking, delivery, rideshare", icon: "briefcase" },
    { type: "business", label: "Farm / agriculture", sub: "Farm, ranch, vineyard", icon: "briefcase" },
    { type: "business", label: "Childcare / education", sub: "Daycare, school, tutoring", icon: "briefcase" },
    { type: "business", label: "Nonprofit / charity", sub: "Charitable or member org", icon: "briefcase" },
    { type: "business", label: "Other business", sub: "Any other operating business", icon: "briefcase" },
  ] },
  { title: "Other", items: [
    { type: "other", label: "Other asset", sub: "Anything else of value", icon: "shield" },
  ] },
];

// Progress header with a working Back control (onBack is a callback).
function kProgress(stepNum, totalSteps, onBack) {
  const back = el("button", { class: "k-back", attrs: { type: "button" } }, [icon("arrow-right", { size: 18, class: "icon-flip" }), el("span", { text: "Back" })]);
  back.addEventListener("click", onBack);
  return el("div", { class: "k-progress" }, [
    el("div", { class: "k-progress__top" }, [back, el("span", { class: "k-progress__text", text: `Step ${stepNum} of ${totalSteps}` })]),
    el("div", { class: "k-track" }, [el("i", { attrs: { style: `width:${Math.round((stepNum / totalSteps) * 100)}%` } })]),
  ]);
}

// Add asset: step 1 pick a type, step 2 name it + pick the entity, then write.
export function renderKeepAddAsset(preselectEntityId) {
  const entities = getEntities();
  // When launched from an entity's page (#/keep/add-asset/:id) the new asset
  // should belong to that entity, not silently default to the first one.
  const preselect = entities.some((e) => e.id === preselectEntityId) ? preselectEntityId : null;
  const state = { step: 1, type: null, label: null };

  function chooseType(c) {
    if (c.entity) { go("#/keep/add-entity"); return; }
    state.type = c.type; state.label = c.label; state.step = 2; render();
  }

  function choiceBtn(c) {
    const btn = el("button", { class: "k-choice", attrs: { type: "button" } }, [
      el("span", { class: "k-cic" }, [icon(c.icon, { size: 26 })]),
      el("span", { class: "k-choice__label" }, [el("span", { text: c.label }), el("small", { text: c.sub })]),
      icon("arrow-right", { size: 22, class: "k-choice__arrow" }),
    ]);
    btn.addEventListener("click", () => chooseType(c));
    return btn;
  }

  function stepOne() {
    const groups = ASSET_GROUPS.flatMap((g) => [
      el("div", { class: "k-choicegroup", text: g.title }),
      el("div", { class: "k-choices" }, g.items.map(choiceBtn)),
    ]);
    return page("list", [
      kProgress(1, 2, () => go(originHref("#/keep"))),
      el("h1", { class: "k-h1", text: "What would you like to add?" }),
      el("p", { class: "k-sub", text: "Pick a type and we'll ask only what's needed, then analyze the coverage it should carry." }),
      ...groups,
      // A company/LLC is the legal entity that holds assets; the operating
      // business itself (restaurant, shop…) is one of those assets.
      el("p", { class: "k-choicenote" }, [
        el("span", { text: "A company or LLC is a legal " }),
        el("a", { attrs: { href: "#/keep/add-entity" }, text: "entity" }),
        el("span", { text: " — create it first, then add its operating business and assets to it." }),
      ]),
    ]);
  }

  function stepTwo() {
    const lower = state.label.toLowerCase();
    const nameInput = el("input", { attrs: { type: "text", placeholder: "e.g. 123 Marina Way" } });
    const valueInput = el("input", { attrs: { type: "number", min: "0", placeholder: "Estimated value (optional)" } });
    // With no entity context and more than one entity to choose from, force an
    // explicit pick instead of silently defaulting to the first entity ("Me") —
    // otherwise assets quietly land on the wrong entity.
    const needsPick = !preselect && entities.length > 1;
    const entSelect = el("select", {}, [
      needsPick ? el("option", { attrs: { value: "", disabled: "disabled", selected: "selected" }, text: "Select an entity…" }) : null,
      ...entities.map((e) => el("option", { attrs: { value: e.id }, text: e.name })),
    ].filter(Boolean));
    if (preselect) entSelect.value = preselect;
    const error = el("p", { class: "k-error", attrs: { role: "alert" } });
    const submit = el("button", { class: "k-btn k-btn--block", attrs: { type: "submit" } }, [el("span", { text: `Add ${lower}` }), icon("arrow-right", { size: 20 })]);

    async function create() {
      const name = nameInput.value.trim();
      if (!name) { error.textContent = "Give this asset a name."; return; }
      if (!entSelect.value) { error.textContent = "Choose which entity this belongs to."; return; }
      submit.setAttribute("disabled", "disabled"); submit.querySelector("span").textContent = "Adding…";
      const res = await addAsset({
        entityId: entSelect.value, type: state.type, name,
        meta: state.label, value: valueInput.value ? Number(valueInput.value) : null,
      });
      if (!res.ok) {
        error.textContent = res.error || "Could not add the asset.";
        submit.removeAttribute("disabled"); submit.querySelector("span").textContent = `Add ${lower}`;
        return;
      }
      await ensureData();
      go(`#/keep/asset/${res.id}`);
    }

    const form = el("form", {}, [
      el("h1", { class: "k-h1", text: `Add a ${lower}` }),
      el("p", { class: "k-sub", text: "Just the basics for now — your broker fills in the policy details." }),
      el("label", { class: "k-fld" }, [el("span", { text: "Name" }), nameInput]),
      el("label", { class: "k-fld" }, [el("span", { text: "Estimated value" }), valueInput]),
      entities.length > 1 ? el("label", { class: "k-fld" }, [el("span", { text: "Belongs to" }), entSelect]) : null,
      submit, error,
    ]);
    form.addEventListener("submit", (e) => { e.preventDefault(); create(); });
    return page("list", [kProgress(2, 2, () => { state.step = 1; render(); }), form], { narrow: true });
  }

  function render() { mount(state.step === 1 ? stepOne() : stepTwo()); }
  render();
}

// Add entity: a small form to create a business or trust you manage.
export function renderKeepAddEntity() {
  const nameInput = el("input", { attrs: { type: "text", placeholder: "e.g. Coastal Cafe LLC" } });
  // Type picker: specific US entity types grouped by colour category.
  const typeSelect = el("select", {}, ENTITY_TYPE_GROUPS.map((g) =>
    el("optgroup", { attrs: { label: g.category } }, g.types.map((t) => el("option", { attrs: { value: t }, text: t })))));
  const error = el("p", { class: "k-error", attrs: { role: "alert" } });
  const submit = el("button", { class: "k-btn k-btn--block", attrs: { type: "submit" } }, [el("span", { text: "Add entity" }), icon("arrow-right", { size: 20 })]);

  // ── Ownership: who owns this new entity, and at what stake ──────────────────
  const owners = getEntities(); // existing entities the client manages (You, businesses, trusts)
  const ownRows = el("div", { class: "k-own" });
  const ownTotal = el("div", { class: "k-own__total" });

  function readRows() {
    return [...ownRows.querySelectorAll(".k-own__row")].map((r) => ({
      ownerId: r.querySelector(".k-own__owner").value,
      role: r.querySelector(".k-own__role").value,
      pct: r.querySelector(".k-own__pct").value,
    }));
  }
  function refreshTotal() {
    const t = totalStake(readRows());
    ownTotal.textContent = `Total stake: ${t}%`;
    ownTotal.classList.toggle("over", t > 100);
  }
  function addRow(ownerId, role, pct) {
    const ownerSel = el("select", { class: "k-own__owner" }, owners.map((e) => el("option", { attrs: { value: e.id }, text: e.name })));
    if (ownerId) ownerSel.value = ownerId;
    const roleSel = el("select", { class: "k-own__role" }, OWNERSHIP_ROLES.map((r) => el("option", { attrs: { value: r }, text: r })));
    if (role) roleSel.value = role;
    const pctInput = el("input", { class: "k-own__pct", attrs: { type: "number", min: "1", max: "100", placeholder: "%", value: pct != null ? String(pct) : "" } });
    const rm = el("button", { class: "k-own__rm", attrs: { type: "button", "aria-label": "Remove owner" } }, [icon("x", { size: 16 })]);
    const row = el("div", { class: "k-own__row" }, [ownerSel, roleSel, pctInput, rm]);
    rm.addEventListener("click", () => { row.remove(); refreshTotal(); });
    pctInput.addEventListener("input", refreshTotal);
    ownRows.appendChild(row);
    refreshTotal();
  }
  const addOwnerBtn = el("button", { class: "k-own__add", attrs: { type: "button" } }, [icon("plus", { size: 16 }), el("span", { text: "Add owner" })]);
  addOwnerBtn.addEventListener("click", () => addRow());
  const me = owners.find((e) => e.kind === "personal") || owners[0];
  if (me) addRow(me.id, "Owner", 100); else refreshTotal();

  const ownEditor = el("div", {}, [
    ownRows,
    el("div", { class: "k-own__foot" }, [addOwnerBtn, ownTotal]),
  ]);
  // A person is a whole individual — they aren't split into ownership stakes, so
  // the stake editor is replaced by a fixed 100% note when the type is a person.
  const personNote = el("p", { class: "k-setnote", attrs: { hidden: "hidden" }, text: "A person is a whole individual — they're always 100% themselves and can't be split into ownership stakes." });
  const ownership = el("div", { class: "k-grp" }, [
    el("div", { class: "k-grp__h" }, [icon("handshake", { size: 15 }), el("span", { text: "Ownership" })]),
    el("p", { class: "k-setnote", text: "Who owns this entity? Add owners from your existing entities and give each a stake. Stakes can total up to 100%." }),
    ownEditor,
    personNote,
  ]);

  // Toggle the ownership editor off for people (100%, not divisible).
  function isPersonType() { return kindForType(typeSelect.value) === "person"; }
  function syncType() {
    const person = isPersonType();
    ownEditor.hidden = person;
    personNote.hidden = !person;
    nameInput.setAttribute("placeholder", person ? "e.g. Jordan Mercer" : "e.g. Coastal Cafe LLC");
  }
  typeSelect.addEventListener("change", syncType);
  syncType();

  async function create() {
    error.textContent = "";
    const name = nameInput.value.trim();
    if (!name) { error.textContent = "Give this entity a name."; return; }
    // People aren't split into stakes; everyone else records ownership rows.
    const rows = isPersonType() ? [] : readRows().filter((r) => r.ownerId);
    const v = validateOwnership(rows);
    if (!v.ok) { error.textContent = v.error; return; }

    submit.setAttribute("disabled", "disabled"); submit.querySelector("span").textContent = "Adding…";
    const typeLabel = typeSelect.value;
    const res = await addEntity({ kind: kindForType(typeLabel), name, typeLabel });
    if (!res.ok) {
      error.textContent = res.error || "Could not add the entity.";
      submit.removeAttribute("disabled"); submit.querySelector("span").textContent = "Add entity";
      return;
    }
    // Record ownership edges (best-effort; the entity is already created).
    for (const r of rows) {
      await addRelationship({ fromEntity: r.ownerId, toEntity: res.id, role: r.role || "Owner", stake: stakeLabel(r.pct) });
    }
    await ensureData();
    go(res.id ? `#/keep/entity/${res.id}` : "#/keep/list");
  }

  const form = el("form", {}, [
    el("h1", { class: "k-h1", text: "Add a business entity" }),
    el("p", { class: "k-sub", text: "Create a company or trust to organize its assets and coverage." }),
    el("label", { class: "k-fld" }, [el("span", { text: "Name" }), nameInput]),
    el("label", { class: "k-fld" }, [el("span", { text: "Type" }), typeSelect]),
    ownership,
    submit, error,
  ]);
  form.addEventListener("submit", (e) => { e.preventDefault(); create(); });
  mount(page("list", [
    backLink("#/keep", "home"),
    form,
  ], { narrow: true }));
}

export function renderKeepPolicy(params, id) {
  const found = findPolicy(id);
  if (!found) return renderKeepEntityList();
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
      el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(),
      el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), sep(),
      el("a", { attrs: { href: `#/keep/asset/${asset.id}` }, text: asset.name }), sep(),
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
    el("div", { class: "k-pactions" }, [
      el("a", { class: "k-btn", attrs: { href: `#/keep/request/${policy.id}` } }, [icon("spark", { size: 18 }), el("span", { text: "Request enhancement" })]),
      el("span", { class: "k-pactions__hint", text: "Ask your broker to add or change coverage on this policy." }),
    ]),
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
  const reminderText = (getPrefs().email && sched.length)
    ? ` Renewal reminders: ${sched.join(", ")} days before ${dateFromDays(policy.renewalInDays)}` + (rinfo.next ? ` · next at ${rinfo.next} days` : " · none upcoming")
    : " Renewal reminders are off — turn them on in Settings.";
  const docs = el("div", {}, [
    el("div", { class: "k-doclist" }, (policy.documents || []).map((d) => docItem(d, null, [policy.line, asset.name, policy.number ? `Policy ${policy.number}` : ""]))),
    el("p", { class: "k-note" }, [el("b", { text: "Claims history: " }), el("span", { text: policy.claims || "None" })]),
    el("p", { class: "k-note" }, [icon("bell", { size: 14 }), el("span", { text: reminderText })]),
  ]);
  sections.push(grp("doc", "Documents & history", docs));

  mount(page("list", sections, { narrow: true }));
}

// Request a policy enhancement. Optional policyId pre-fills the context from a
// specific policy (the "Modify" button on a policy page); without it, it's a
// general request (e.g. from the home smart prompt).
export function renderKeepRequest(policyId) {
  const found = policyId ? findPolicy(policyId) : null;
  const ctx = found
    ? { policyId: found.policy.id, assetId: found.asset.id, entityId: found.entity.id,
        label: `${found.policy.line} · ${found.asset.name}`, line: found.policy.line }
    : { policyId: null, assetId: null, entityId: null, label: "", line: "" };

  const subjectInput = el("input", { attrs: { type: "text", value: defaultSubject(ctx.line), maxlength: "200" } });
  const messageInput = el("textarea", { attrs: { rows: "5", placeholder: "Describe the change you'd like — e.g. raise liability to $500K, add flood coverage, schedule a new appraisal…", maxlength: "4000" } });
  const error = el("p", { class: "k-error", attrs: { role: "alert" } });
  const submit = el("button", { class: "k-btn k-btn--block", attrs: { type: "submit" } }, [el("span", { text: "Send request to broker" }), icon("arrow-right", { size: 20 })]);

  async function create() {
    error.textContent = "";
    const subject = subjectInput.value.trim();
    const message = messageInput.value.trim();
    const v = validateRequest({ subject, message });
    if (!v.ok) { error.textContent = v.error; return; }
    submit.setAttribute("disabled", "disabled"); submit.querySelector("span").textContent = "Sending…";
    const res = await addEnhancementRequest({ subject, message, policyId: ctx.policyId, assetId: ctx.assetId, entityId: ctx.entityId, context: ctx.label || null });
    if (!res.ok) {
      error.textContent = res.error || "Could not send your request. Please try again.";
      submit.removeAttribute("disabled"); submit.querySelector("span").textContent = "Send request to broker";
      return;
    }
    // Best-effort email to broker + client; the request is already saved.
    await notifyEnhancement(res.id, "requested");
    go("#/keep/requests");
  }

  const form = el("form", {}, [
    el("h1", { class: "k-h1", text: "Request a policy enhancement" }),
    el("p", { class: "k-sub", text: "Tell your broker what you'd like to add or change. They review every request and give final approval — you'll be emailed at each step." }),
    found ? el("div", { class: "k-reqctx" }, [
      el("span", { class: `k-cic k-cic--${found.policy.cic}` }, [icon(found.policy.icon, { size: 22 })]),
      el("div", {}, [
        el("div", { class: "k-reqctx__t", text: found.policy.line }),
        el("div", { class: "k-reqctx__s", text: `${found.asset.name}${found.policy.carrier ? ` · ${found.policy.carrier}` : ""}` }),
      ]),
    ]) : null,
    el("label", { class: "k-fld" }, [el("span", { text: "Subject" }), subjectInput]),
    el("label", { class: "k-fld" }, [el("span", { text: "What would you like to change?" }), messageInput]),
    submit, error,
    el("p", { class: "k-setnote" }, [icon("lock", { size: 14 }), el("span", { text: " This sends a request only — your broker confirms what's available and binds any change." })]),
  ]);
  form.addEventListener("submit", (e) => { e.preventDefault(); create(); });

  mount(page("requests", [backLink(found ? `#/keep/policy/${found.policy.id}` : "#/keep", found ? found.policy.line : "home"), form], { narrow: true }));
}

// The client's enhancement requests, newest first, with live status. Brokers
// additionally see an Approve control on pending requests.
export async function renderKeepRequests() {
  const requests = await loadEnhancementRequests();
  const role = (getUser() && getUser().role) || "client";
  const isStaff = role === "broker" || role === "underwriter";

  const when = (days) => days == null ? "" : (days === 0 ? "Today" : days === -1 ? "Yesterday" : `${Math.abs(days)} days ago`);

  // Role-aware stage controls. Broker moves a request up to underwriting; the
  // underwriter owns the underwriting → approved/declined decision. Approve
  // routes through approveEnhancement (status flip + best-effort email).
  const NEXT_LABEL = { broker_review: "Mark received", underwriting: "Send to underwriter" };
  function stageButton(label, ic, run) {
    const b = el("button", { class: "k-btn k-btn--sm", attrs: { type: "button" } }, [el("span", { text: label }), icon(ic, { size: 16 })]);
    b.addEventListener("click", async () => { b.setAttribute("disabled", "disabled"); b.querySelector("span").textContent = "Saving…"; await run(); renderKeepRequests(); });
    return b;
  }
  function declineButton(r) {
    const b = el("button", { class: "k-btn k-btn--ghost k-btn--sm", attrs: { type: "button" } }, [el("span", { text: "Decline" })]);
    b.addEventListener("click", async () => { b.setAttribute("disabled", "disabled"); b.querySelector("span").textContent = "…"; await advanceRequest(r.id, "declined"); renderKeepRequests(); });
    return b;
  }
  function stageControls(r) {
    if (r.status === "approved" || r.status === "declined") return [];
    if (role === "broker" && (r.status === "requested" || r.status === "broker_review")) {
      const nx = nextStage(r.status); // broker_review | underwriting
      return [stageButton(NEXT_LABEL[nx], "arrow-right", () => advanceRequest(r.id, nx)), declineButton(r)];
    }
    if (role === "underwriter" && r.status === "underwriting") {
      return [stageButton("Approve", "check", () => approveEnhancement(r.id)), declineButton(r)];
    }
    return [];
  }

  function card(r) {
    const st = statusDisplay(r.status);
    const info = stageInfo(r.status);
    return el("div", { class: "k-reqcard" }, [
      el("div", { class: "k-reqcard__top" }, [
        el("div", { class: "k-reqcard__main" }, [
          el("div", { class: "k-reqcard__subj", text: r.subject }),
          r.context ? el("div", { class: "k-reqcard__ctx", text: r.context }) : null,
        ]),
        el("span", { class: `k-pill ${st.cls}` }, [icon(st.icon, { size: 15 }), el("span", { text: st.label })]),
      ]),
      requestStepper(r.status),
      el("div", { class: "k-reqcard__stage" }, [icon(info.declined ? "alert" : "spark", { size: 14 }), el("span", { text: info.wait })]),
      el("p", { class: "k-reqcard__msg", text: r.message }),
      el("div", { class: "k-reqcard__foot" }, [
        el("span", { class: "k-reqcard__when", text: when(r.createdInDays) }),
        ...stageControls(r),
      ]),
    ]);
  }

  const HEAD = {
    broker: { h: "Requests to action", s: "Client requests — review and send to underwriting." },
    underwriter: { h: "Underwriting queue", s: "Requests submitted for underwriting approval." },
    client: { h: "My requests", s: "Policy enhancements you've asked your broker for." },
  };
  const head = HEAD[role] || HEAD.client;
  const emptyText = isStaff ? "No requests to action right now." : "No requests yet. Use “New request” or the home prompt to ask your broker for a coverage change.";

  const view = page("requests", [
    backLink("#/keep", "home"),
    el("div", { class: "k-reqhead" }, [
      el("div", {}, [
        el("h1", { class: "k-h1", text: head.h }),
        el("p", { class: "k-sub", text: head.s }),
      ]),
      isStaff ? null : el("a", { class: "k-btn", attrs: { href: "#/keep/request" } }, [icon("plus", { size: 18 }), el("span", { text: "New request" })]),
    ]),
    requests.length
      ? el("div", { class: "k-reqlist" }, requests.map(card))
      : el("div", { class: "k-empty", text: emptyText }),
  ], { narrow: true });
  mount(view);
}

// Every document flattened to one row, with its policy/asset/entity context.
function collectDocuments() {
  const out = [];
  for (const ent of getEntities())
    for (const a of ent.assets)
      for (const p of (a.policies || []))
        for (const d of (p.documents || []))
          out.push({ doc: d, entity: ent, asset: a, policy: p, hay: `${d} ${p.line} ${a.name} ${ent.name}`.toLowerCase() });
  return out;
}

// Documents — a flat table: one row per document, with the entity, asset and
// policy it belongs to, plus a download button. Sort by clicking the columns.
export function renderKeepDocuments() {
  const rows = collectDocuments();

  const columns = [
    { label: "Document", get: (r) => r.doc, cell: (r) => [
      el("span", { class: "k-doc-ic" }, [icon("doc", { size: 15 })]),
      el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${r.policy.id}` }, text: r.doc }),
    ] },
    { label: "Entity", get: (r) => r.entity.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/entity/${r.entity.id}` }, text: r.entity.name }) },
    { label: "Asset", get: (r) => r.asset.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${r.asset.id}` }, text: r.asset.name }) },
    { label: "Policy", get: (r) => r.policy.line, cell: (r) => [
      el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${r.policy.id}` }, text: r.policy.line }),
      el("div", { class: "k-imuted", text: r.policy.number || "" }),
    ] },
    { label: "Download", cell: (r) => downloadButton(r.doc, [r.policy.line, r.asset.name, r.entity.name]) },
  ];

  const table = rows.length ? sortableTable(columns, rows, { defaultIdx: 1, defaultDir: 1 }) : null;  // Entity
  const empty = el("div", { class: "k-docs-empty", attrs: { hidden: "" }, text: "No documents match your search." });

  const search = el("input", { class: "k-docsearch", attrs: { type: "search", placeholder: "Search documents by name, policy, asset or entity…", "aria-label": "Search documents" } });
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    table.entries.forEach((e) => { const show = !q || e.row.hay.includes(q); e.tr.hidden = !show; if (show) any = true; });
    empty.hidden = any;
  });

  const view = page("documents", [
    backLink("#/keep", "home"),
    el("h1", { class: "k-h1", text: "Documents" }),
    el("p", { class: "k-sub", text: rows.length ? `Every document across your policies — ${rows.length} on file.` : "Your documents will appear here." }),
    rows.length ? search : null,
    rows.length ? table.wrap : el("div", { class: "k-empty", text: "No documents on file yet." }),
    empty,
  ]);
  mount(view);
}

export function renderKeepAccount() {
  const pg = (rows) => el("dl", { class: "k-pg" }, rows.map(([dt, dd]) => el("div", {}, [el("dt", { text: dt }), el("dd", { text: dd })])));
  const user = getUser();
  const view = page("account", [
    backLink("#/keep", "home"),
    el("h1", { class: "k-h1", text: "Account" }),
    el("p", { class: "k-sub", text: "Your profile and notification settings." }),
    el("div", { class: "k-grp" }, [
      el("div", { class: "k-grp__h" }, [icon("user", { size: 15 }), el("span", { text: "Profile" })]),
      pg([["Name", user.name], ["Email", user.email], ["Role", "Client"], ["Member since", "Jun 2026"], ["Broker", BROKER_NAME]]),
    ]),
    buildReminderSettings(),
    el("div", { class: "k-btn-row" }, [signOutButton("k-btn k-btn--ghost")]),
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
    backLink("#/keep", "home"),
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
      el("span", {}, [el("b", { text: " Questions about how your data is handled? " }), el("span", { text: `Your licensed broker (${BROKER_NAME}) can walk you through it, or see our privacy policy.` })]),
    ]),
  ], { narrow: true });
  mount(view);
}
