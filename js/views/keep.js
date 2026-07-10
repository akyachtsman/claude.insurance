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
import { capTablesByEntity, controlsByEntity, orchestrate } from "../keep/relmap.js";

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
        link("Entities", "#/keep/entity", "list"),
        link("Assets", "#/keep/assets", "assets"),
        link("Policies", "#/keep/insurance", "insurance"),
        link("Documents", "#/keep/documents", "documents"),
      ]),
      el("div", { class: "k-bar__rt" }, [searchBox(), notifMenu(), accountMenu()]),
    ]),
  ]);
}

function page(active, contentChildren, opts = {}) {
  const wrapClass = `k-wrap${opts.narrow ? " k-wrap--narrow" : opts.mid ? " k-wrap--mid" : opts.split ? " k-wrap--split" : ""}`;
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

// Friendly label for a route, resolving a dynamic entity route to its name so a
// back control reads "Back to Jordan Mercer" rather than a bare "Back".
function routeLabel(hash) {
  if (KEEP_LABELS[hash]) return KEEP_LABELS[hash];
  const m = hash.match(/^#\/keep\/entity(?:\/([^/]+))?$/);
  if (m) { const e = m[1] ? getEntity(m[1]) : primaryEntity(); return e ? e.name : "entity"; }
  return null;
}
// Back row shown only when you arrived from another in-app Keep page (e.g. an
// entity detail via its Relationships / All entities control) — so a top-level
// nav visit to a list/map page doesn't get a spurious back control.
function originBackRow() {
  const prev = previousRoute();
  if (!prev || !prev.startsWith("#/keep") || prev === location.hash) return null;
  const label = routeLabel(prev);
  return el("div", { class: "k-backrow" }, [
    el("a", { class: "k-back", attrs: { href: prev } }, [
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

// The client's own "Me" entity (kind personal) — the default landing for the
// Entities tab, which opens straight onto this detail view. Falls back to the
// first managed entity if there's no personal one.
function primaryEntity() {
  const ents = getEntities();
  return ents.find((e) => e.kind === "personal") || ents[0] || null;
}

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
const REL_NODE_W = 210, REL_NODE_H = 118, REL_HGAP = 30, REL_VGAP = 78, REL_PAD = 34;
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
  const edges = relView.trustees ? data.edges : data.edges.filter((e) => parsePct(e.stake) != null);
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
function setupRelViewport(wrap, svg, W, H, anchor) {
  const MIN_K = REL_MIN_NODE_PX / REL_NODE_W;      // scale at which a node is exactly the floor width
  const TOPM = 28;                                 // top margin when the chart is top-aligned
  let k = 1, tx = 0, ty = 0, fitted = false;
  const applyT = () => { svg.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`; };
  // Keep the chart on-screen: centre horizontally where it fits, else clamp the
  // pan. Vertically, top-align with a small margin (rather than centre) so the
  // root sits near the top and there's no dead space floating above it.
  const clampPan = (vw, vh) => {
    const cw = W * k, ch = H * k, M = 48;
    tx = cw <= vw ? (vw - cw) / 2 : Math.min(M, Math.max(vw - cw - M, tx));
    ty = ch <= vh ? TOPM : Math.min(M, Math.max(vh - ch - M, ty));
  };
  const fit = () => {
    const vw = wrap.clientWidth || 0, vh = wrap.clientHeight || 0;
    if (!vw || !vh) return;
    k = Math.max(MIN_K, Math.min(vw / W, vh / H, 1));   // fit the whole chart, but not below the node floor
    // Anchor on the root ("Me") node — centred horizontally, near the top — so a
    // large graph opens focused on you, not on its geometric middle. clampPan
    // then centres/top-aligns when the whole chart fits, or clamps when it pans.
    if (anchor) { tx = vw / 2 - anchor.cx * k; ty = TOPM - anchor.top * k; }
    else { tx = (vw - W * k) / 2; ty = (vh - H * k) / 2; }
    clampPan(vw, vh); applyT(); fitted = true;
  };
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!wrap.isConnected) { if (fitted) ro.disconnect(); return; }
      fit();                                              // recompute fit scale + re-centre on every resize
    });
    ro.observe(wrap);
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
  const ctrls = controlsByEntity(edges);
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
    s("linearGradient", { id: "relme", x1: "0", y1: "0", x2: "1", y2: "1" }, [
      s("stop", { offset: "0", "stop-color": "#6F9BFF" }), s("stop", { offset: "1", "stop-color": "#2F6AF6" }),
    ]),
    // Arrowhead pointing from an owner to the entity it owns.
    s("marker", { id: "rel-arrow", viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "9", markerHeight: "9", orient: "auto", markerUnits: "userSpaceOnUse" }, [
      s("path", { d: "M0,0 L10,5 L0,10 L2.5,5 Z", fill: "#b9c4dd" }),
    ]),
  ]));

  // Edges under the nodes. A stake edge is tinted with its owner's type colour
  // (matching that owner's segment in the owned entity's cap-table bar); a
  // control-only link (Trustee, no stake) is a dashed grey line. Neither carries a
  // label — the stake lives on the owned entity's cap-table bar and the control role
  // lives on a pill inside the controlled entity's box.
  const edgeRefs = edges.map((e) => {
    const stake = parsePct(e.stake) != null;
    const owner = byId.get(e.from);
    const color = stake ? (REL_TYPE_COLOR[owner ? owner.sk : "person"] || "#c3b2f0") : "#c7d0e4";
    const op = edgeDim(e) ? "0.08" : (stake ? "0.85" : "0.7");
    const path = s("path", { fill: "none", stroke: color, "stroke-width": stake ? "2.5" : "2", "stroke-linecap": "round", "marker-end": "url(#rel-arrow)", opacity: op, "stroke-dasharray": stake ? "" : "1 6" });
    svg.appendChild(path);
    return { ...e, stake, path, wp: (waypoints && waypoints[e.from + ">" + e.to]) || [] };
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
    const ctrl = ctrls[n.id];
    // Speak the ownership split + control roles to assistive tech — otherwise only in
    // hover <title>s, which never fire on touch (iPad Safari).
    const ownDesc = (cap && cap.length
      ? " Owned by " + cap.map((c) => { const ow = byId.get(c.ownerId); return `${ow ? ow.name : "an owner"} ${c.pct}%`; }).join(", ") + "."
      : "")
      + (ctrl && ctrl.length
        ? " " + ctrl.map((c) => { const ow = byId.get(c.ownerId); return `${ow ? ow.name : "Someone"} ${c.role}`; }).join(", ") + "."
        : "");
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
    const hasOwn = Boolean((cap && cap.length) || (ctrl && ctrl.length));
    const yoff = hasOwn ? 26 : 0;
    const ax = n.x + 34, avy = top + 30 + yoff;
    g.appendChild(s("circle", { cx: ax, cy: avy, r: 17, fill: o.avFill }));
    g.appendChild(svgText(n.initials, { x: ax, y: avy + 5, "text-anchor": "middle", "font-size": "13", "font-weight": "800", fill: o.avText, "font-family": FD }));
    g.appendChild(svgText(n.name, { x: ax + 28, y: top + 26 + yoff, "font-size": "13", "font-weight": "700", fill: o.nameFill, "font-family": FD }));
    g.appendChild(svgText(n.sub, { x: ax + 28, y: top + 41 + yoff, "font-size": "11", "font-weight": "600", fill: o.subFill, "font-family": FS }));

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
        grp.appendChild(s("circle", { cx, cy: top + 66 + yoff, r: 9, fill: cFill, stroke: cStroke, "stroke-width": "1" }));
        grp.appendChild(svgText(label, { x: cx, y: top + 69 + yoff, "text-anchor": "middle", "font-size": "8", "font-weight": "800", fill: cText, "font-family": FS }));
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
        if (i > 0) barG.appendChild(s("rect", { x: sg.x - 0.75, y: barY, width: 1.5, height: barH, fill: "#ffffff" }));
        const rect = s("rect", { x: sg.x, y: barY, width: sg.w, height: barH, fill: REL_TYPE_COLOR[owner ? owner.sk : "person"] || "#9aa5bd" });
        const ti = s("title", {}); ti.textContent = `${owner ? owner.name : "Owner"} — ${sg.pct}%`; rect.appendChild(ti);
        barG.appendChild(rect);
        // Prefer the full "II pct%"; when the slice is too narrow keep the OWNER's
        // initials (who owns the slice is the point of the bar — the exact percent is
        // on hover) rather than dropping to a bare, ownerless number.
        const initials = owner ? owner.initials : "?";
        const full = `${initials} ${sg.pct}%`;
        const wide = sg.w >= full.length * 5.4;
        const label = wide ? full : (sg.w >= 16 ? initials : "");
        if (label) barG.appendChild(svgText(label, { x: sg.center, y: barY + 11, "text-anchor": "middle", "font-size": wide ? "9.5" : "9", "font-weight": "800", fill: "#ffffff", "font-family": FS }));
      });
      g.appendChild(barG);
    }

    // Control-only relationships (a trustee, a manager with no equity) show as a
    // pill inside the controlled entity's box — "<initials> <role>", coloured by the
    // controller's type. It sits in the header just under the arrow (below the cap
    // bar in the rare case an entity has both a stake and a control link).
    if (ctrl && ctrl.length) {
      const py = (cap && cap.length) ? top + 30 : top + 9;
      const shownC = ctrl.length > 2 ? 1 : ctrl.length;
      const items = [];
      for (let i = 0; i < shownC; i++) {
        const c = ctrl[i], ow = byId.get(c.ownerId);
        items.push({ label: `${ow ? ow.initials : "?"} ${c.role}`, fill: REL_TYPE_COLOR[ow ? ow.sk : "person"] || "#9aa5bd", tip: `${ow ? ow.name : "Someone"} — ${c.role}` });
      }
      if (ctrl.length > shownC) {
        items.push({ label: `+${ctrl.length - shownC}`, fill: "#9aa5bd", tip: ctrl.slice(shownC).map((c) => { const ow = byId.get(c.ownerId); return `${ow ? ow.name : "Someone"} — ${c.role}`; }).join(", ") });
      }
      const ws = items.map((it) => Math.min(it.label.length * 5.7 + 16, NODE_W - 32));
      const totalW = ws.reduce((a, b) => a + b, 0) + (items.length - 1) * 6;
      let px = n.x + (NODE_W - totalW) / 2;                 // centre the group under the arrow
      items.forEach((it, i) => {
        const w = ws[i];
        const grp = s("g", {});
        grp.appendChild(s("rect", { x: px, y: py, width: w, height: 18, rx: 9, fill: it.fill }));
        grp.appendChild(svgText(it.label, { x: px + w / 2, y: py + 12.5, "text-anchor": "middle", "font-size": "9.5", "font-weight": "800", fill: "#ffffff", "font-family": FS }));
        if (it.tip) { const ti = s("title", {}); ti.textContent = it.tip; grp.appendChild(ti); }
        g.appendChild(grp);
        px += w + 6;
      });
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
  // Anchor the initial view on the root ("Me") node so the map opens centred on it.
  const rootN = nodes.find((n) => n.kind === "personal") || nodes[0];
  const anchor = rootN && pos[rootN.id]
    ? { cx: pos[rootN.id].x + NODE_W / 2, top: pos[rootN.id].cy - NODE_H / 2 }
    : null;
  setupRelViewport(wrap, svg, W, H, anchor);
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
    originBackRow(),
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
    originBackRow(),
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
  // No id (the Entities tab lands here) → open the client's own "Me" entity.
  const entity = getEntity(id) || primaryEntity();
  if (!entity) return renderKeepEntityList();
  const settings = await getRuleDefaults();
  const suffix = colorSuffix(entity);
  const sum = entitySummary(entity, settings);
  const value = entityValue(entity);
  const subtype = entitySubtype(entity);

  // Entities this one owns — the out-edges of the ownership graph, each with its
  // stake — so the page shows the holdings, not just what this entity is made of.
  const map = getMapData();
  const owned = map.edges
    .filter((e) => e.from === entity.id && parsePct(e.stake) != null)
    .map((e) => ({ ent: getEntity(e.to), name: (map.nodes.find((n) => n.id === e.to) || {}).name, pct: parsePct(e.stake), stake: e.stake }))
    .filter((o) => o.ent || o.name)
    .sort((a, b) => b.pct - a.pct);

  // Overview band: identity on the left, the headline insured value on the right,
  // the primary action at the end. The at-a-glance figure leads the page.
  // People show their name's initials (e.g. "JM"); businesses/trusts keep their icon.
  const nameInitials = (entity.name || "").split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const isPersonKind = entity.kind === "personal" || entity.kind === "person";
  const bandAvatar = isPersonKind
    ? el("span", { class: "k-bigav k-bigav--person", text: nameInitials })
    : entityAvatar(entity);
  const band = el("div", { class: "k-eband" }, [
    bandAvatar,
    el("div", { class: "k-eband__who" }, [
      el("div", { class: "k-eband__eyebrow", text: "Entity" }),
      el("div", { class: "k-eband__name" }, [
        el("h1", { text: entity.name }),
        el("span", { class: `k-et k-et--${suffix}`, text: entityCategory(entity) }),
      ]),
      subtype !== "—" ? el("div", { class: "k-eband__sub", text: subtype }) : null,
    ]),
    el("div", { class: "k-eband__hero" }, [
      el("div", { class: "k-eband__herok", text: "Insured value" }),
      el("div", { class: "k-eband__herov", text: value ? money(value) : "—" }),
    ]),
  ]);

  // Inline metric row (no boxes) — the secondary figures read as one scannable line.
  const metric = (k, v, warn) => el("div", { class: "k-emetric" }, [
    el("div", { class: "k-emetric__k", text: k }),
    el("div", { class: `k-emetric__v${warn ? " k-emetric__v--warn" : ""}`, text: v }),
  ]);
  const metrics = el("div", { class: "k-emetrics" }, [
    metric("Assets", String(sum.assets)),
    metric("Coverage in place", String(sum.inPlace)),
    metric("Open gaps", String(sum.gaps), sum.gaps > 0),
    metric("Entities owned", String(owned.length)),
  ]);

  // Coverage allocation bar: how much of what this entity needs is in place vs open —
  // so the open-gap risk reads at a glance. Only shown once needs are analysed.
  const covTotal = sum.inPlace + sum.gaps;
  const coveredPct = covTotal ? (sum.inPlace / covTotal) * 100 : 0;
  const alloc = covTotal ? el("div", { class: "k-ealloc" }, [
    el("div", { class: "k-ealloc__lbl" }, [
      el("span", { text: "Coverage across needs" }),
      el("span", { class: "k-ealloc__sum", text: `${sum.inPlace} in place · ${sum.gaps} open` }),
    ]),
    el("div", { class: "k-etrack" }, [
      el("span", { class: "k-eseg k-eseg--ok", attrs: { style: `width:${coveredPct}%` } }),
      el("span", { class: "k-eseg k-eseg--gap", attrs: { style: `width:${100 - coveredPct}%` } }),
    ]),
    el("div", { class: "k-ekey" }, [
      el("span", { class: "k-ekey__i" }, [el("i", { class: "k-edot k-edot--ok" }), el("span", { text: "In place" })]),
      el("span", { class: "k-ekey__i" }, [el("i", { class: "k-edot k-edot--gap" }), el("span", { text: "Open gap" })]),
    ]),
  ]) : null;

  // Entities owned — kept nested INSIDE the entity frame (divided by a rule), so the
  // entity and what it owns stay one connected card, exactly as before.
  const ownedBlock = owned.length ? el("div", { class: "k-eowned" }, [
    el("div", { class: "k-lbl", text: "Entities owned" }),
    el("div", { class: "k-owned" }, owned.map((o) => {
      const e = o.ent, managed = e && e._managed;
      const tone = e ? ` k-ownrow--${colorSuffix(e)}` : "";
      const kids = [
        e ? entityAvatar(e) : null,
        el("span", { class: "k-ownrow__name", text: o.name || (e && e.name) || "Entity" }),
        el("span", { class: "k-ownrow__pct", text: `${o.stake || `${o.pct}%`} owned` }),
      ];
      return managed
        ? el("a", { class: `k-ownrow${tone} k-ilink`, attrs: { href: `#/keep/entity/${e.id}` } }, kids)
        : el("div", { class: `k-ownrow${tone}` }, kids);
    })),
  ]) : null;
  // The whole entity frame, unchanged: identity, metrics, coverage bar, entities owned.
  const entityFrame = el("section", { class: `k-epanel k-eoverview k-panel--${suffix}` }, [band, metrics, alloc, ownedBlock]);

  // The assets frame — Option B, grouped by protection — placed NEXT TO the entity
  // frame. Needs attention (gaps / uninsured, tinted) first, then protected.
  const rated = entity.assets.map((a) => ({ a, st: assetStatus(a, settings) }));
  const attention = rated.filter((x) => x.st.cls !== "ok");
  const covered = rated.filter((x) => x.st.cls === "ok");
  const assetRow = ({ a, st }) => el("a", { class: `k-arow k-arow--${st.cls === "ok" ? "ok" : "attn"}`, attrs: { href: `#/keep/asset/${a.id}` } }, [
    cic(a),
    el("div", { class: "k-arow__main" }, [
      el("div", { class: "k-arow__name", text: a.name }),
      el("div", { class: "k-arow__meta", text: `${a.meta} · ${money(a.value)}` }),
    ]),
    el("span", { class: `k-arow__st k-arow__st--${st.cls}`, text: st.label }),
  ]);
  const group = (title, items, tone) => items.length ? el("div", { class: "k-agroup" }, [
    el("div", { class: "k-agroup__h" }, [el("i", { class: `k-agroup__dot k-agroup__dot--${tone}` }), el("span", { text: title }), el("span", { class: "k-agroup__c", text: String(items.length) })]),
    el("div", { class: "k-agroup__list" }, items.map(assetRow)),
  ]) : null;
  const assetsFrame = el("section", { class: "k-ecol k-eassetframe" }, [
    el("div", { class: "k-ecol__h" }, [
      el("div", { class: "k-ecol__ht" }, [el("div", { class: "k-lbl", text: "Assets in this entity" }), entity.assets.length ? el("span", { class: "k-ecol__cnt", text: String(entity.assets.length) }) : null]),
      el("a", { class: "k-btn k-btn--sm", attrs: { href: `#/keep/add-asset/${entity.id}` } }, [el("span", { text: "Add asset" })]),
    ]),
    entity.assets.length
      ? el("div", { class: "k-agroups" }, [group("Needs attention", attention, "gap"), group("Protected", covered, "ok")].filter(Boolean))
      : el("p", { class: "k-setnote", text: "No assets yet — use Add asset above." }),
  ]);

  // The "Me" entity is the Entities-tab landing (a top-level page), so it drops
  // the back affordance; drilled-in entities keep the origin-aware back. Every
  // detail page carries clear controls back out to the full list and the map.
  const isLanding = entity.kind === "personal";
  const detActions = el("div", { class: "k-edetnav" }, [
    el("a", { class: "k-detbtn", attrs: { href: "#/keep/list" } }, [icon("clipboard", { size: 15 }), el("span", { text: "All entities" })]),
    el("a", { class: "k-detbtn", attrs: { href: "#/keep/entities" } }, [icon("swap", { size: 15 }), el("span", { text: "Relationships" })]),
  ]);
  const header = el("div", { class: "k-edethead" }, [
    el("nav", { class: "k-crumbs" }, [el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(), el("span", { text: entity.name })]),
    detActions,
  ]);
  const view = page("list", [
    isLanding ? null : backLink("#/keep/list", "entities"),
    header,
    el("div", { class: "k-esplit" }, [entityFrame, assetsFrame]),
  ].filter(Boolean), { split: true });
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
