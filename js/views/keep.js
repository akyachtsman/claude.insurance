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

// Broker of record (demo). Single source for the name shown across the portal;
// policy-level agent comes from the policy record itself.
const BROKER_NAME = "Rosa Alvarez";

// Breadcrumb separator node (kept as one helper so the glyph isn't duplicated).
function sep() { return el("span", { text: "  ·  " }); }

// Persist Relationships-map node positions (per browser) so dragged layouts survive
// re-renders, navigation and reloads. Keyed by entity id → {x, cy}.
const REL_POS_KEY = "keep:relmap-positions";
function loadRelPositions() {
  try { return JSON.parse(localStorage.getItem(REL_POS_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveRelPositions(state) {
  try { localStorage.setItem(REL_POS_KEY, JSON.stringify(Object.assign(loadRelPositions(), state))); }
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
        link("Policies", "#/keep/insurance", "insurance"),
        link("Entities", "#/keep/list", "list"),
        el("span", { class: "k-navswap", attrs: { "aria-hidden": "true", title: "Entities and Relationships are two views of the same thing" } }, [icon("swap", { size: 22 })]),
        link("Relationships", "#/keep/entities", "entities"),
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

function entityAvatar(entity) {
  // Businesses and trusts get an icon avatar (trust on the violet base, business
  // on the green one); people show their initials.
  if (entity.kind === "business" || entity.kind === "trust") {
    const cls = entity.kind === "business" ? "k-bigav k-bigav--biz" : "k-bigav";
    return el("span", { class: cls }, [icon(entity.icon || (entity.kind === "trust" ? "doc" : "briefcase"), { size: 30 })]);
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
    if (i) out.push(sep());
    out.push(el("span", { text: b }));
  });
  return out;
}

function entityPanel(entity, settings) {
  const variant = entity.kind === "business" ? "k-panel--biz" : "k-panel--me";
  const body = entity.assets.length
    ? el("div", { class: "k-grid2" }, entity.assets.map((a) => assetCard(a, settings)))
    : el("p", { class: "k-setnote", text: "No assets yet — use Add asset above." });
  return el("section", { class: `k-panel ${variant}` }, [
    entityHead(entity, settings, "#/keep/add-asset"),
    el("div", { class: "k-lbl", text: "Assets in this entity" }),
    body,
  ]);
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

// My Entities — the entities-with-assets view (formerly the dashboard).
// Insurance — every policy across all entities in one sortable table.
export function renderKeepInsurance() {
  const rows = collectPolicies();
  const state = { sort: "due" };

  function sorted() {
    const r = [...rows];
    if (state.sort === "entity") return r.sort((a, b) => a.entity.name.localeCompare(b.entity.name) || a.policy.line.localeCompare(b.policy.line));
    if (state.sort === "policy") return r.sort((a, b) => a.policy.line.localeCompare(b.policy.line));
    return r.sort((a, b) => a.policy.renewalInDays - b.policy.renewalInDays); // due date (soonest/most overdue first)
  }

  function docCell(policy, asset, entity) {
    const docs = policy.documents || [];
    if (!docs.length) return el("span", { class: "k-imuted", text: "—" });
    return el("div", { class: "k-idocs" }, docs.map((d) =>
      docItem(d, `#/keep/policy/${policy.id}`, [policy.line, asset.name, entity.name])));
  }

  function sortBtn(key, label) {
    const b = el("button", { class: `k-sortbtn${state.sort === key ? " on" : ""}`, attrs: { type: "button", "aria-pressed": String(state.sort === key) } }, [el("span", { text: label })]);
    b.addEventListener("click", () => { state.sort = key; render(); });
    return b;
  }

  function render() {
    const headers = ["Policy", "Entity", "Asset", "Carrier", "Renewal", "Premium", "Documents"];
    const body = sorted().map(({ policy, asset, entity }) => el("tr", {}, [
      el("td", {}, [
        el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${policy.id}` }, text: policy.line }),
        el("div", { class: "k-imuted", text: policy.number || "" }),
      ]),
      el("td", {}, [el("a", { class: "k-ilink", attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name })]),
      el("td", {}, [el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${asset.id}` }, text: asset.name })]),
      el("td", { text: policy.carrier || "—" }),
      el("td", {}, [expiryBadge(policy.renewalInDays)]),
      el("td", { text: policy.premium || "—" }),
      el("td", {}, [docCell(policy, asset, entity)]),
    ]));

    const view = page("insurance", [
      el("h1", { class: "k-h1", text: "Policies" }),
      el("p", { class: "k-sub", text: `Every policy across your entities — ${rows.length} on file.` }),
      el("div", { class: "k-sortrow" }, [
        el("span", { class: "k-sortlbl", text: "Sort" }),
        sortBtn("due", "Due date"), sortBtn("entity", "Entity"), sortBtn("policy", "Policy"),
      ]),
      rows.length
        ? el("div", { class: "k-itable-wrap" }, [
            el("table", { class: "k-itable" }, [
              el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { text: h })))]),
              el("tbody", {}, body),
            ]),
          ])
        : el("div", { class: "k-empty", text: "No policies on file yet — your broker adds them as they're bound." }),
    ]);
    mount(view);
  }
  render();
}

export async function renderKeepEntityList() {
  const settings = await getRuleDefaults();
  const view = page("list", [
    el("h1", { class: "k-h1", text: "My entities" }),
    el("p", { class: "k-sub", text: "Your coverage, organized by entity." }),
    el("div", { class: "k-privacy" }, [
      icon("lock", { size: 16 }),
      el("span", { text: "Encrypted and private — only you and your broker can see this." }),
      el("a", { attrs: { href: "#/keep/security" }, text: "How we protect you" }),
    ]),
    el("div", { class: "k-listactions" }, [
      el("button", { class: "k-btn k-btn--sm", attrs: { type: "button", "data-go": "/keep/add-entity" } }, [icon("plus", { size: 16 }), el("span", { text: "New entity" })]),
    ]),
    ...getEntities().map((e) => entityPanel(e, settings)),
  ]);
  mount(view);
}

function svgText(str, attrs) { const t = s("text", attrs); t.textContent = str; return t; }

// Inline-SVG relationship graph, built live from the entity_relationships table.
// People (you + related individuals) sit on the left, trusts in the middle,
// businesses on the right; each edge is labeled with the role (and stake). Nodes
// for entities you manage are keyboard-focusable and open their detail.
const REL_STYLE = {
  me: { fill: "url(#relme)", avFill: "rgba(255,255,255,.25)", avText: "#fff", nameFill: "#fff", subFill: "rgba(255,255,255,.85)", stroke: null },
  person: { fill: "#fff", avFill: "#efeafe", avText: "#5b3ee6", nameFill: "#231d3a", subFill: "#5f5880", stroke: "#ece7fb" },
  biz: { fill: "#fff", avFill: "#defaef", avText: "#0e8e66", nameFill: "#231d3a", subFill: "#5f5880", stroke: "#ece7fb" },
  trust: { fill: "#fff", avFill: "#fff1de", avText: "#b5660a", nameFill: "#231d3a", subFill: "#5f5880", stroke: "#ece7fb" },
};
// DB entity kind → REL_STYLE key (personal renders as the gradient "me" node).
function relStyleKey(kind) {
  return kind === "personal" ? "me" : kind === "business" ? "biz" : kind === "trust" ? "trust" : "person";
}
// Column-based auto-layout: people col 0, trusts col 1, businesses col 2.
const REL_COL = { me: 0, person: 0, trust: 1, biz: 2 };
const REL_X = [30, 390, 740];
function relLayout(H) {
  const data = getMapData();
  const nodes = data.nodes.map((n) => ({ ...n, sk: relStyleKey(n.kind) }));
  const cols = [[], [], []];
  nodes.forEach((n) => cols[REL_COL[n.sk]].push(n));
  cols.forEach((list, c) => {
    const k = list.length || 1;
    list.forEach((n, i) => { n.x = REL_X[c]; n.cy = Math.round(70 + (i + 0.5) * ((H - 140) / k)); });
  });
  return { nodes, edges: data.edges };
}

function relationshipMap() {
  const W = 970, H = 420, NODE_W = 200, NODE_H = 72, FS = "Nunito, sans-serif", FD = "Quicksand, sans-serif";
  const { nodes, edges } = relLayout(H);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Restore any saved positions over the default auto-layout (clamped to canvas).
  const saved = loadRelPositions();
  nodes.forEach((n) => {
    if (saved[n.id]) {
      n.x = clamp(saved[n.id].x, 0, W - NODE_W);
      n.cy = clamp(saved[n.id].cy, NODE_H / 2, H - NODE_H / 2);
    }
  });
  const state = {};
  nodes.forEach((n) => { state[n.id] = { x: n.x, cy: n.cy }; });
  const center = (id) => ({ x: state[id].x + NODE_W / 2, y: state[id].cy });

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Relationship map of your entities", class: "k-relsvg" });
  svg.appendChild(s("defs", {}, [
    s("linearGradient", { id: "relme", x1: "0", y1: "0", x2: "1", y2: "1" }, [
      s("stop", { offset: "0", "stop-color": "#8a6bff" }), s("stop", { offset: "1", "stop-color": "#5b3ee6" }),
    ]),
  ]));

  // Edge paths first (drawn under the nodes); labels are appended after the nodes
  // so they stay readable on top. Keep refs to reposition during drag.
  const edgeRefs = edges.map((e) => {
    const path = s("path", { fill: "none", stroke: "#cdbef5", "stroke-width": "2.5" });
    svg.appendChild(path);
    const lrect = s("rect", { rx: 13, height: 26, fill: "#ffffff", stroke: "#ece7fb" });
    const ltext = svgText(e.label, { "text-anchor": "middle", "font-size": "12", "font-weight": "700", fill: "#5f5880", "font-family": FS });
    return { ...e, path, lrect, ltext };
  });
  const updateEdges = () => {
    edgeRefs.forEach((er) => {
      const a = center(er.from), b = center(er.to);
      er.path.setAttribute("d", `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, lw = er.label.length * 6.4 + 24;
      er.lrect.setAttribute("x", mx - lw / 2); er.lrect.setAttribute("y", my - 13); er.lrect.setAttribute("width", lw);
      er.ltext.setAttribute("x", mx); er.ltext.setAttribute("y", my + 4);
    });
  };

  nodes.forEach((n) => {
    const o = REL_STYLE[n.sk];
    const interactive = Boolean(n.href);
    const g = s("g", interactive
      ? { class: "k-relnode k-relnode--link", tabindex: "0", role: "link", "aria-label": `Open ${n.name}` }
      : { class: "k-relnode k-relnode--static", role: "img", "aria-label": `${n.name} (sample)` });
    g.appendChild(s("rect", { x: n.x, y: n.cy - NODE_H / 2, width: NODE_W, height: NODE_H, rx: 18, fill: o.fill, stroke: o.stroke || "none", "stroke-width": o.stroke ? "1.5" : "0" }));
    const ax = n.x + 38;
    g.appendChild(s("circle", { cx: ax, cy: n.cy, r: 20, fill: o.avFill }));
    g.appendChild(svgText(n.initials, { x: ax, y: n.cy + 5, "text-anchor": "middle", "font-size": "14", "font-weight": "800", fill: o.avText, "font-family": FD }));
    g.appendChild(svgText(n.name, { x: ax + 30, y: n.cy - 2, "font-size": "13", "font-weight": "700", fill: o.nameFill, "font-family": FD }));
    g.appendChild(svgText(n.sub, { x: ax + 30, y: n.cy + 16, "font-size": "11", "font-weight": "600", fill: o.subFill, "font-family": FS }));

    // Pointer-drag (mouse + touch): move the node, edges follow. A press with no
    // real movement counts as a tap → open (for real entities).
    let dragging = false, moved = false, sx = 0, sy = 0, bx = 0, by = 0, pid = null;
    g.addEventListener("pointerdown", (ev) => {
      dragging = true; moved = false; pid = ev.pointerId;
      sx = ev.clientX; sy = ev.clientY; bx = state[n.id].x; by = state[n.id].cy;
      try { g.setPointerCapture(pid); } catch (e) { /* ignore */ }
      ev.preventDefault();
    });
    g.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width ? W / rect.width : 1;
      const dxc = ev.clientX - sx, dyc = ev.clientY - sy;
      if (Math.abs(dxc) + Math.abs(dyc) > 4) moved = true;
      const nx = clamp(bx + dxc * scale, 0, W - NODE_W);
      const ny = clamp(by + dyc * scale, NODE_H / 2, H - NODE_H / 2);
      state[n.id] = { x: nx, cy: ny };
      g.setAttribute("transform", `translate(${nx - n.x} ${ny - n.cy})`);
      updateEdges();
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      try { g.releasePointerCapture(pid); } catch (e) { /* ignore */ }
      if (moved) saveRelPositions(state);          // remember the new layout
      else if (interactive) location.hash = n.href; // a tap → open
    };
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    if (interactive) g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); location.hash = n.href; } });

    svg.appendChild(g);
  });

  // Labels on top of the nodes, then set initial geometry.
  edgeRefs.forEach((er) => { svg.appendChild(er.lrect); svg.appendChild(er.ltext); });
  updateEdges();

  return el("div", { class: "k-relmap" }, [svg]);
}

export function renderKeepEntities() {
  const view = page("entities", [
    el("h1", { class: "k-h1", text: "Relationships" }),
    el("p", { class: "k-sub", text: "How you, your businesses and trusts connect. Drag any node to rearrange; tap your own entities to open them." }),
    relationshipMap(),
    el("p", { class: "k-relcaption", text: "Drag nodes to rearrange the map. Entities you manage open when tapped; related parties are shown for context." }),
  ]);
  mount(view);
}

export async function renderKeepEntity(params, id) {
  const entity = getEntity(id);
  if (!entity) return renderKeepEntityList();
  const settings = await getRuleDefaults();
  const variant = entity.kind === "business" ? "k-panel--biz" : "k-panel--me";
  const view = page("entities", [
    backLink("#/keep/entities", "entities"),
    el("nav", { class: "k-crumbs" }, [el("a", { attrs: { href: "#/keep/entities" }, text: "Relationships" }), sep(), el("span", { text: entity.name })]),
    el("section", { class: `k-panel ${variant}` }, [
      entityHead(entity, settings, "#/keep/add-asset"),
      el("div", { class: "k-lbl", text: "Assets in this entity" }),
      entity.assets.length
        ? el("div", { class: "k-grid2" }, entity.assets.map((a) => assetCard(a, settings)))
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

  const covRow = (c) => el("div", { class: `k-crow${c.status === "gap" ? " gap" : ""}` }, [
    el("span", { class: `k-cic k-cic--${ASSET_META[asset.type] ? ASSET_META[asset.type].cic : "home"}` }, [icon(c.icon, { size: 26 })]),
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
      el("a", { attrs: { href: "#/keep/entities" }, text: "Relationships" }), sep(),
      el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), sep(),
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

  mount(page("entities", sections, { narrow: true }));
}

const ASSET_CHOICES = [
  { type: "home", label: "Home or condo", sub: "You own and live here", icon: "home" },
  { type: "home", label: "Rental property", sub: "You rent it to others", icon: "commercial-property" },
  { type: "auto", label: "Vehicle", sub: "Car, truck or motorcycle", icon: "auto" },
  { type: "watercraft", label: "Watercraft", sub: "Boat, jet ski or yacht", icon: "boat" },
  { type: "valuables", label: "Jewelry & valuables", sub: "Art, jewelry, collectibles", icon: "gem" },
  { type: "business", label: "Business", sub: "A company you own or run", icon: "briefcase" },
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
export function renderKeepAddAsset() {
  const entities = getEntities();
  const state = { step: 1, type: null, label: null };

  function chooseType(c) {
    if (c.type === "business") { go("#/keep/add-entity"); return; }
    state.type = c.type; state.label = c.label; state.step = 2; render();
  }

  function stepOne() {
    return page("entities", [
      kProgress(1, 2, () => go(originHref("#/keep"))),
      el("h1", { class: "k-h1", text: "What would you like to add?" }),
      el("p", { class: "k-sub", text: "Pick a type and we'll ask only what's needed, then analyze the coverage it should carry." }),
      el("div", { class: "k-choices" }, ASSET_CHOICES.map((c) => {
        const btn = el("button", { class: "k-choice", attrs: { type: "button" } }, [
          el("span", { class: "k-cic" }, [icon(c.icon, { size: 26 })]),
          el("span", { class: "k-choice__label" }, [el("span", { text: c.label }), el("small", { text: c.sub })]),
          icon("arrow-right", { size: 22, class: "k-choice__arrow" }),
        ]);
        btn.addEventListener("click", () => chooseType(c));
        return btn;
      })),
    ], { narrow: true });
  }

  function stepTwo() {
    const lower = state.label.toLowerCase();
    const nameInput = el("input", { attrs: { type: "text", placeholder: "e.g. 123 Marina Way" } });
    const valueInput = el("input", { attrs: { type: "number", min: "0", placeholder: "Estimated value (optional)" } });
    const entSelect = el("select", {}, entities.map((e) => el("option", { attrs: { value: e.id }, text: e.name })));
    const error = el("p", { class: "k-error", attrs: { role: "alert" } });
    const submit = el("button", { class: "k-btn k-btn--block", attrs: { type: "submit" } }, [el("span", { text: `Add ${lower}` }), icon("arrow-right", { size: 20 })]);

    async function create() {
      const name = nameInput.value.trim();
      if (!name) { error.textContent = "Give this asset a name."; return; }
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
    return page("entities", [kProgress(2, 2, () => { state.step = 1; render(); }), form], { narrow: true });
  }

  function render() { mount(state.step === 1 ? stepOne() : stepTwo()); }
  render();
}

// Add entity: a small form to create a business or trust you manage.
export function renderKeepAddEntity() {
  const nameInput = el("input", { attrs: { type: "text", placeholder: "e.g. Coastal Cafe LLC" } });
  const kindSelect = el("select", {}, [
    el("option", { attrs: { value: "business" }, text: "Business (LLC, Corp, etc.)" }),
    el("option", { attrs: { value: "trust" }, text: "Trust" }),
  ]);
  const subInput = el("input", { attrs: { type: "text", placeholder: "e.g. LLC (optional)" } });
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

  const ownership = el("div", { class: "k-grp" }, [
    el("div", { class: "k-grp__h" }, [icon("handshake", { size: 15 }), el("span", { text: "Ownership" })]),
    el("p", { class: "k-setnote", text: "Who owns this entity? Add owners from your existing entities and give each a stake. Stakes can total up to 100%." }),
    ownRows,
    el("div", { class: "k-own__foot" }, [addOwnerBtn, ownTotal]),
  ]);

  async function create() {
    error.textContent = "";
    const name = nameInput.value.trim();
    if (!name) { error.textContent = "Give this entity a name."; return; }
    const rows = readRows().filter((r) => r.ownerId);
    const v = validateOwnership(rows);
    if (!v.ok) { error.textContent = v.error; return; }

    submit.setAttribute("disabled", "disabled"); submit.querySelector("span").textContent = "Adding…";
    const res = await addEntity({ kind: kindSelect.value, name, subtype: subInput.value.trim() || null });
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
    el("label", { class: "k-fld" }, [el("span", { text: "Type" }), kindSelect]),
    el("label", { class: "k-fld" }, [el("span", { text: "Subtype" }), subInput]),
    ownership,
    submit, error,
  ]);
  form.addEventListener("submit", (e) => { e.preventDefault(); create(); });
  mount(page("entities", [
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
      el("a", { attrs: { href: "#/keep/entities" }, text: "Relationships" }), sep(),
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

  mount(page("entities", sections, { narrow: true }));
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

// Documents — a flat, sortable table: one row per document, with the entity,
// asset and policy it belongs to, plus a download button.
export function renderKeepDocuments() {
  const rows = collectDocuments();

  const CMP = {
    document: (a, b) => a.doc.localeCompare(b.doc),
    policy: (a, b) => a.policy.line.localeCompare(b.policy.line) || a.doc.localeCompare(b.doc),
    entity: (a, b) => a.entity.name.localeCompare(b.entity.name) || a.asset.name.localeCompare(b.asset.name) || a.doc.localeCompare(b.doc),
  };

  // One <tr> per document (built once; sort re-orders, search toggles hidden).
  const entries = rows.map((x) => ({
    x,
    tr: el("tr", {}, [
      el("td", {}, [el("span", { class: "k-doc-ic" }, [icon("doc", { size: 15 })]), el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${x.policy.id}` }, text: x.doc })]),
      el("td", {}, [el("a", { class: "k-ilink", attrs: { href: `#/keep/entity/${x.entity.id}` }, text: x.entity.name })]),
      el("td", {}, [el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${x.asset.id}` }, text: x.asset.name })]),
      el("td", {}, [el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${x.policy.id}` }, text: x.policy.line }), el("div", { class: "k-imuted", text: x.policy.number || "" })]),
      el("td", {}, [downloadButton(x.doc, [x.policy.line, x.asset.name, x.entity.name])]),
    ]),
  }));

  const tbody = el("tbody", {}, entries.map((e) => e.tr));
  const empty = el("div", { class: "k-docs-empty", attrs: { hidden: "" }, text: "No documents match your search." });

  const state = { sort: "entity" };
  const sortButtons = [];
  function applySort(key) {
    state.sort = key;
    [...entries].sort((A, B) => CMP[key](A.x, B.x)).forEach((e) => tbody.appendChild(e.tr));
    sortButtons.forEach((b) => { const on = b.dataset.key === key; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  function sortBtn(key, label) {
    const b = el("button", { class: "k-sortbtn", attrs: { type: "button", "aria-pressed": "false" } }, [el("span", { text: label })]);
    b.dataset.key = key;
    b.addEventListener("click", () => applySort(key));
    sortButtons.push(b);
    return b;
  }

  const search = el("input", { class: "k-docsearch", attrs: { type: "search", placeholder: "Search documents by name, policy, asset or entity…", "aria-label": "Search documents" } });
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let any = false;
    entries.forEach((e) => { const show = !q || e.x.hay.includes(q); e.tr.hidden = !show; if (show) any = true; });
    empty.hidden = any;
  });

  const headers = ["Document", "Entity", "Asset", "Policy", "Download"];
  const view = page("documents", [
    backLink("#/keep", "home"),
    el("h1", { class: "k-h1", text: "Documents" }),
    el("p", { class: "k-sub", text: rows.length ? `Every document across your policies — ${rows.length} on file.` : "Your documents will appear here." }),
    rows.length ? search : null,
    rows.length ? el("div", { class: "k-sortrow" }, [
      el("span", { class: "k-sortlbl", text: "Sort" }),
      sortBtn("entity", "Entity"), sortBtn("document", "Document"), sortBtn("policy", "Policy"),
    ]) : null,
    rows.length
      ? el("div", { class: "k-itable-wrap" }, [
          el("table", { class: "k-itable" }, [
            el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { text: h })))]),
            tbody,
          ]),
        ])
      : el("div", { class: "k-empty", text: "No documents on file yet." }),
    empty,
  ]);
  if (rows.length) applySort("entity");
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
