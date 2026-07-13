// keep/shell.js — shared chrome + UI helpers for the Keep portal.
// The app frame (page/appBar), the header menus (notifications, account,
// search/command palette), origin-aware back navigation, the demo ribbon,
// reminder controls, document download helpers, and the small shared
// formatters (money, dates, asset/policy icons, coverage pills, avatars).
// Extracted from views/keep.js so the page-view functions stay separate from
// the chrome they hang in. Pure presentation — no page-specific logic.
import { el } from "../dom.js";
import { go, previousRoute } from "../main.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { ASSET_META } from "./data.js";
import { policyKind, policyType, REMINDER_SCHEDULE } from "./policies.js";
import { KEEP_ACTIONS, matchActions, searchRecords } from "./search.js";
import { buildPdf, docLines, docName } from "./docfile.js";
import { entityColorSuffix as colorSuffix, entityAvatarIcon } from "./entity-display.js";
import { getUser, getEntities, getEntity, getPrefs, savePrefs, signOut } from "../supabase.js";

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

function downloadButton(doc, context) {
  const name = docName(doc); // accepts a string or a { name, kind } record
  const b = el("button", { class: "k-dl", attrs: { type: "button", title: `Download ${name}`, "aria-label": `Download ${name}` } }, [icon("download", { size: 15 })]);
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); downloadDocument(name, context); });
  return b;
}

// A document row: the document (optionally linking to its policy) plus a
// download button. `context` lines are embedded in the generated PDF.
function docItem(doc, href, context, dataDoc) {
  const name = docName(doc); // accepts a string or a { name, kind } record
  const label = href
    ? el("a", { class: "k-doclink", attrs: { href } }, [icon("doc", { size: 15 }), el("span", { text: name })])
    : el("span", { class: "k-doclink" }, [icon("doc", { size: 15 }), el("span", { text: name })]);
  const row = el("div", { class: "k-docrow" }, [label, downloadButton(doc, context)]);
  if (dataDoc) row.setAttribute("data-doc", dataDoc);
  return row;
}

// A single Download control per policy that opens a menu of its documents to
// pick from — keeps rows compact when a policy carries several documents.
// Uses the shared .k-pop popover (closes on outside-click / Escape / scroll);
// the menu is fixed-positioned so the table's overflow container can't clip it.
function docDownloadMenu(policy, asset, entity) {
  const docs = policy.documents || [];
  const context = [policy.line, asset.name, entity.name];
  const caret = el("span", { class: "k-dd__caret" }, [icon("chevron-down", { size: 14 })]);
  const trigger = el("button", {
    class: "k-dd__btn",
    attrs: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", title: "Download a document" },
  }, [icon("download", { size: 15 }), el("span", { text: `${docs.length} document${docs.length === 1 ? "" : "s"}` }), caret]);

  const menu = el("div", { class: "k-dd__menu", attrs: { role: "menu" } }, docs.map((d) => {
    const name = docName(d);
    const item = el("button", { class: "k-dd__item", attrs: { type: "button", role: "menuitem" } }, [
      icon("doc", { size: 15 }), el("span", { class: "k-dd__itxt", text: name }), icon("download", { size: 14 }),
    ]);
    item.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); downloadDocument(name, context); closeKeepMenus(); });
    return item;
  }));

  const pop = el("div", { class: "k-pop k-dd" }, [trigger, menu]);
  const place = () => {
    const r = trigger.getBoundingClientRect();
    menu.style.left = `${Math.round(Math.min(r.left, window.innerWidth - menu.offsetWidth - 12))}px`;
    const below = r.bottom + 6, mh = menu.offsetHeight;
    menu.style.top = `${Math.round(below + mh > window.innerHeight - 8 ? r.top - 6 - mh : below)}px`;
  };
  trigger.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    const isOpen = pop.classList.contains("is-open");
    closeKeepMenus();
    if (!isOpen) { pop.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true"); place(); }
  });
  return pop;
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
  // Fixed-positioned popovers (e.g. the Documents download menu inside a scroll
  // container) don't follow their trigger on scroll — close them instead.
  window.addEventListener("scroll", () => closeKeepMenus(), true);
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

// Detailed, frame-less asset-type picture (drawn straight on the row). Used as
// the leading column in the Assets table; all types share the one red tint.
const ASSET_TYPE_ICON = {
  home: "as-home", auto: "as-auto", watercraft: "as-boat", valuables: "as-gem",
  "commercial-space": "as-commercial", "commercial-auto": "as-truck", business: "as-commercial", other: "as-box",
};
function assetTypeIcon(asset) {
  return el("span", { class: "k-aicon" }, [icon(ASSET_TYPE_ICON[asset.type] || "as-box", { size: 30 })]);
}

// Detailed, frame-less policy-type picture for the leading column in the
// Policies table (mirrors assetTypeIcon; policyType() picks the icon by line).
function policyTypeIcon(policy) {
  return el("span", { class: "k-aicon" }, [icon(policyType(policy).icon, { size: 30 })]);
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
  // Active: no check icon — the subtle green text alone conveys the state.
  return el("span", { class: "k-exp k-exp--ok" }, [el("span", { text: `Active · renews ${dateFromDays(renewalInDays)}` })]);
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

// The client's own "Me" entity (kind personal) — the default landing for the
// Entities tab, which opens straight onto this detail view. Falls back to the
// first managed entity if there's no personal one.
function primaryEntity() {
  const ents = getEntities();
  return ents.find((e) => e.kind === "personal") || ents[0] || null;
}

function entityAvatar(entity) {
  // Detailed line icon + colour, both from the single entity-display source.
  const isPerson = entity.kind === "personal" || entity.kind === "person";
  const suffix = isPerson ? "person" : colorSuffix(entity);
  return el("span", { class: `k-bigav k-bigav--${suffix}` }, [icon(entityAvatarIcon(entity), { size: 30 })]);
}


export {
  BROKER_NAME, sep, loadCardOrder, saveCardOrder, activeSchedule, buildReminderSettings,
  money, downloadButton, docItem, docDownloadMenu, ribbon, landingCommand, page,
  originHref, backLink, originBackRow, cic, assetTypeLabel, assetTypeIcon, policyTypeIcon,
  coveragePill, dateFromDays, dateShort, expiryBadge, policiesSection, primaryEntity,
  entityAvatar, signOutButton,
};
