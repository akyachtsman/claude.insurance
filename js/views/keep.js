// views/keep.js — "The Keep" authenticated portal (Direction C).
// Renders login, dashboard (entities + nested assets), entity detail, add-asset,
// and the asset coverage-analysis page. Reads/writes live Supabase data (loaded
// by the route guard in main.js); RLS scopes everything to the signed-in client.

import { el, mount } from "../dom.js";
import { go } from "../main.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { getRuleDefaults } from "../content.js";
import { ASSET_META } from "../keep/data.js";
import {
  getUser, getEntities, getEntity, findAsset, findPolicy, getMapData,
  getAllAssets,
  getPrefs, signIn, addEntity, addAsset,
  ensureData, DEMO_CREDENTIAL, addRelationship,
  addEnhancementRequest, loadEnhancementRequests, notifyEnhancement, approveEnhancement, advanceRequest,
} from "../supabase.js";
import { analyzeAsset, assetStatus, entitySummary } from "../keep/analysis.js";
import { depreciationFor, depreciationMilestones } from "../keep/depreciation.js";
import { policyKind, reminderInfo, renewalBand, annualPremium, formatPremium } from "../keep/policies.js";
import { validateRequest, statusDisplay, defaultSubject, stageInfo, isPending, nextStage, REQUEST_STAGES } from "../keep/requests.js";
import { docName } from "../keep/docfile.js";
import { OWNERSHIP_ROLES, parsePct, totalStake, validateOwnership, stakeLabel } from "../keep/ownership.js";
import { ENTITY_TYPE_GROUPS, kindForType } from "../keep/entity-types.js";
import { entityCategory, entitySubtype, entityColorSuffix as colorSuffix, entityIndustry } from "../keep/entity-display.js";
import { relationshipMap, relToolbar } from "../keep/relmap-view.js";
import {
  BROKER_NAME, sep, loadCardOrder, saveCardOrder, activeSchedule, buildReminderSettings,
  money, downloadButton, docItem, docDownloadMenu, ribbon, landingCommand, page,
  originHref, backLink, originBackRow, cic, assetTypeLabel, assetTypeIcon, policyTypeIcon,
  coveragePill, dateFromDays, dateShort, expiryBadge, policiesSection, primaryEntity,
  entityAvatar, signOutButton,
} from "../keep/shell.js";

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
    return docDownloadMenu(policy, asset, entity);
  }

  const columns = [
    // Leading column: the detailed, frame-less policy-type picture. No `get` → not sortable.
    { label: "", cell: (r) => policyTypeIcon(r.policy) },
    { label: "Policy", get: (r) => r.policy.line, cell: (r) => [
      el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${r.policy.id}` }, text: r.policy.line }),
      el("div", { class: "k-imuted", text: r.policy.number || "" }),
    ] },
    { label: "Entity", get: (r) => r.entity.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/entity/${r.entity.id}` }, text: r.entity.name }) },
    { label: "Asset", get: (r) => r.asset.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${r.asset.id}` }, text: r.asset.name }) },
    { label: "Carrier", get: (r) => r.policy.carrier || "", cell: (r) => el("span", { text: r.policy.carrier || "—" }) },
    { label: "Renewal", get: (r) => r.policy.renewalInDays, cell: (r) => expiryBadge(r.policy.renewalInDays) },
    { label: "Premium", get: (r) => annualPremium(r.policy) || 0, cell: (r) => el("span", { text: formatPremium(r.policy) }) },
    { label: "Documents", cell: (r) => docCell(r.policy, r.asset, r.entity) },
  ];

  // Summary stats across the whole table.
  const active = rows.filter((r) => policyKind(r.policy.renewalInDays) !== "exp").length;
  const attention = rows.filter((r) => r.policy.renewalInDays <= 30).length; // expiring soon or lapsed
  const premiums = rows.map((r) => annualPremium(r.policy)).filter((n) => n != null);
  const premiumTotal = premiums.reduce((s, n) => s + n, 0);
  const insuredEntities = new Set(rows.map((r) => r.entity.id)).size;

  const view = page("insurance", [
    el("h1", { class: "k-h1", text: "Policies" }),
    el("p", { class: "k-sub", text: `Every policy across your entities — ${rows.length} on file.` }),
    el("div", { class: "k-astats" }, [
      statTile("Policies", String(rows.length), `across ${insuredEntities} ${insuredEntities === 1 ? "entity" : "entities"}`),
      statTile("Active", String(active), "in force"),
      statTile("Needs attention", String(attention), attention ? "expiring or lapsed" : "all current"),
      statTile("Annual premium", premiums.length ? (money(premiumTotal) || "$0") : "—", "total on file"),
    ]),
    rows.length
      ? (() => { const t = sortableTable(columns, rows, { defaultIdx: 5, defaultDir: 1 }); t.wrap.classList.add("k-atable", "k-ptable"); return t.wrap; })()  // Renewal, soonest first
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
    // Leading column: the detailed, frame-less asset-type picture. No `get` → not sortable.
    { label: "", cell: (r) => assetTypeIcon(r.asset) },
    { label: "Asset", get: (r) => r.asset.name, cell: (r) => el("a", { class: "k-ilink", attrs: { href: `#/keep/asset/${r.asset.id}` }, text: r.asset.name }) },
    { label: "Type", get: (r) => assetTypeLabel(r.asset), cell: (r) => el("span", { text: assetTypeLabel(r.asset) }) },
    { label: "Entity", get: (r) => (r.entity ? r.entity.name : "￿"), cell: (r) => entityCell(r.entity) },
    { label: "Value", get: (r) => r.asset.value || 0, cell: (r) => el("span", { text: r.asset.value ? money(r.asset.value) : "—" }) },
    // Summary of the type's actual-cash-value depreciation (full schedule lives
    // on the asset detail page). Non-depreciating types read "Holds value".
    { label: "Depreciation", get: (r) => depreciationFor(r.asset).annual, cell: (r) => {
      const d = depreciationFor(r.asset);
      return d.depreciates
        ? el("span", { text: `−${money(d.annual)}/yr` })
        : el("span", { class: "k-dep-hold", text: r.asset.value ? "Holds value" : "—" });
    } },
    { label: "Policies", get: (r) => (r.asset.policies || []).length, cell: (r) => el("span", { text: String((r.asset.policies || []).length) }) },
  ];

  // Summary stats across the whole table.
  const totalValue = rows.reduce((s, r) => s + (r.asset.value || 0), 0);
  const totalPolicies = rows.reduce((s, r) => s + (r.asset.policies || []).length, 0);
  const uninsured = rows.filter((r) => !(r.asset.policies || []).length).length;
  const insuredEntities = new Set(rows.filter((r) => r.entity).map((r) => r.entity.id)).size;

  const view = page("assets", [
    el("div", { class: "k-reqhead" }, [
      el("div", {}, [
        el("h1", { class: "k-h1", text: "Assets" }),
        el("p", { class: "k-sub", text: `Every asset across your entities — ${rows.length} on file${orphanCount ? ` · ${orphanCount} orphan${orphanCount === 1 ? "" : "s"}` : ""}.` }),
      ]),
      el("a", { class: "k-btn", attrs: { href: "#/keep/add-asset" } }, [icon("plus", { size: 18 }), el("span", { text: "Add asset" })]),
    ]),
    el("div", { class: "k-astats" }, [
      statTile("Assets", String(rows.length), `across ${insuredEntities} ${insuredEntities === 1 ? "entity" : "entities"}`),
      statTile("Total value", money(totalValue) || "$0", "insured value on file"),
      statTile("Policies", String(totalPolicies), "in force"),
      statTile("Uninsured", String(uninsured), uninsured ? "no policy yet" : "all covered"),
    ]),
    rows.length
      ? (() => { const t = sortableTable(columns, rows, { defaultIdx: 3, defaultDir: 1, rowHref: (r) => `#/keep/asset/${r.asset.id}`, rowClass: (r) => (r.entity ? "" : "k-trorphan") }); t.wrap.classList.add("k-atable"); return t.wrap; })()  // default sort: Entity; whole row opens the asset
      : el("div", { class: "k-empty", text: "No assets yet — use Add asset to add one." }),
  ]);
  mount(view);
}

// Segmented switch across the three views of the same entities: a compact Rows
// list, a Cards grid, and the Relationships map. `active` is "rows" | "cards" |
// "map"; each segment deep-links to its route.
function entitiesToggle(active) {
  const seg = (label, iconName, href, key, title) => el("a", {
    class: `k-seg__btn${active === key ? " is-on" : ""}`,
    attrs: Object.assign({ href, role: "tab", "aria-selected": String(active === key) }, title ? { title, "aria-label": title } : {}),
  }, [icon(iconName, { size: 16 }), el("span", { text: label })]);
  return el("div", { class: "k-seg", attrs: { role: "tablist", "aria-label": "Entities view" } }, [
    seg("Rows", "clipboard", "#/keep/list", "rows"),
    seg("Cards", "book", "#/keep/grid", "cards"),
    seg("Relationships", "swap", "#/keep/entities", "map"),
    // Fourth: jump to the account's own (logged-in) entity — the ultimate beneficial owner.
    seg("UBO", "user", "#/keep/entity", "owner", "Ultimate beneficial owner"),
  ]);
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

  // Summary stats across all entities (same treatment as the Assets table).
  const companies = entities.filter((e) => entityCategory(e) === "Company").length;
  const individuals = entities.filter((e) => entityCategory(e) === "Individual").length;
  const trusts = entities.filter((e) => entityCategory(e) === "Trust").length;
  const ubos = entities.filter((e) => entityCategory(e) === "UBO").length; // the account holder(s)
  const totalAssets = entities.reduce((s, e) => s + e.assets.length, 0);
  const totalGaps = entities.reduce((s, e) => s + entitySummary(e, settings).gaps, 0);
  const totalValue = entities.reduce((s, e) => s + entityValue(e), 0);
  const mix = [companies ? `${companies} ${companies === 1 ? "company" : "companies"}` : null,
    individuals ? `${individuals} individual${individuals === 1 ? "" : "s"}` : null,
    trusts ? `${trusts} trust${trusts === 1 ? "" : "s"}` : null,
    ubos ? `${ubos} UBO` : null].filter(Boolean).join(" · ");
  const stats = el("div", { class: "k-astats" }, [
    statTile("Entities", String(entities.length), mix || "in your account"),
    statTile("Assets", String(totalAssets), "across your entities"),
    statTile("Coverage gaps", String(totalGaps), totalGaps ? "review recommended" : "none open"),
    statTile("Total value", money(totalValue) || "$0", "insured value on file"),
  ]);

  const view = page("list", [
    originBackRow(),
    el("h1", { class: "k-h1", text: "Entities" }),
    entitiesToggle(layout),
    entitiesPrivacyRow(),
    entities.length ? el("div", {}, [stats, body]) : el("div", { class: "k-empty", text: "No entities yet — use New entity to add one." }),
  ]);
  mount(view);
}

export function renderKeepEntityList() { return renderEntityCollection("rows"); }
export function renderKeepEntityGrid() { return renderEntityCollection("cards"); }

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
  ], { split: true });   // wide canvas so a large graph fits and zooms up, centred
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
  // the primary action at the end. The at-a-glance figure leads the page. Every
  // type shows its detailed line icon (the entity name sits right beside it).
  const bandAvatar = entityAvatar(entity);
  const band = el("div", { class: "k-eband" }, [
    bandAvatar,
    el("div", { class: "k-eband__who" }, [
      el("div", { class: "k-eband__eyebrow", text: "Entity" }),
      el("div", { class: "k-eband__name" }, [
        el("h1", { text: entity.name }),
        el("span", { class: `k-et k-et--${suffix}`, text: entityCategory(entity) }),
      ]),
      (() => {
        const line = [subtype !== "—" ? subtype : null, entityIndustry(entity)].filter(Boolean).join(" · ");
        return line ? el("div", { class: "k-eband__sub", text: line }) : null;
      })(),
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
  // A single assets frame beside the entity frame: the two protection groups
  // (Needs attention, then Protected) stacked in one column, so the entity
  // information keeps the majority of the width.
  const group = (title, items, tone) => items.length ? el("div", { class: "k-agroup" }, [
    el("div", { class: "k-agroup__h" }, [
      // Protected is marked by a blue shield; needs-attention keeps the status dot.
      tone === "ok" ? icon("shield", { size: 15, class: "k-agroup__shield" }) : el("i", { class: `k-agroup__dot k-agroup__dot--${tone}` }),
      el("span", { text: title }),
      el("span", { class: "k-agroup__c", text: String(items.length) }),
    ]),
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

  // Reached from the Owner tab / a drill-in, so it carries an origin-aware back;
  // a plain breadcrumb, no in-page view switch.
  const view = page("list", [
    backLink("#/keep/list", "entities"),
    el("nav", { class: "k-crumbs" }, [el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(), el("span", { text: entity.name })]),
    el("div", { class: "k-esplit" }, [entityFrame, assetsFrame]),
  ], { split: true });
  mount(view);
}

// Value & depreciation panel for the asset detail page. Depreciating types show
// a milestone actual-cash-value (ACV) schedule; non-depreciating types show a
// short "holds value" note. Returns null when the asset has no value to project.
function depreciationSection(asset) {
  if (!asset || !asset.value) return null;
  const d = depreciationFor(asset);

  if (!d.depreciates) {
    return el("section", { class: "k-sec" }, [
      el("h2", { text: "Value & depreciation" }),
      el("p", { class: "k-sub2", text: "How this asset's insurable value changes over time" }),
      el("div", { class: "k-depnote" }, [
        el("span", { class: "k-cic" }, [icon("shield", { size: 22 })]),
        el("p", { text: "This asset type typically holds its value or appreciates, so no actual-cash-value depreciation is applied. Coverage is written on a replacement-cost or agreed-value basis." }),
      ]),
    ]);
  }

  const yearLabel = (y) => (y === 0 ? "Today" : `Year ${y}`);
  const head = el("tr", {}, ["When", "Replacement value", "Actual cash value", "Depreciated"].map((t, i) =>
    el("th", i === 0 ? {} : { class: "k-depnum" }, [el("span", { text: t })])));
  const body = depreciationMilestones(d).map((row) => el("tr", {}, [
    el("td", { text: yearLabel(row.year) }),
    el("td", { class: "k-depnum", text: money(row.rc) }),
    el("td", { class: "k-depnum k-depacv", text: money(row.acv) }),
    el("td", { class: "k-depnum k-depdown", text: row.dep ? `−${money(row.dep)}` : "—" }),
  ]));

  return el("section", { class: "k-sec" }, [
    el("h2", { text: "Value & depreciation" }),
    el("p", { class: "k-sub2", text: "Estimated actual cash value (ACV) as this asset ages — replacement cost minus depreciation" }),
    el("div", { class: "k-itable-wrap k-deptable" }, [
      el("table", { class: "k-itable" }, [el("thead", {}, [head]), el("tbody", {}, body)]),
    ]),
    el("p", { class: "k-depfoot", text: `Straight-line over ~${d.life} years to a ${Math.round(d.salvage * 100)}% salvage floor — about ${money(d.annual)}/year. Estimate only; a claim paid on a replacement-cost basis is not reduced by this depreciation.` }),
  ]);
}

export async function renderKeepAsset(params, id) {
  const found = findAsset(id);
  if (!found) return renderKeepAssets(); // unknown asset → the assets list, not entities
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
    // An orphan asset (entity didn't load) falls back to the Assets list.
    backLink(entity ? `#/keep/entity/${entity.id}` : "#/keep/assets", entity ? entity.name : "assets"),
    el("nav", { class: "k-crumbs" }, entity
      ? [
        el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(),
        el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), sep(),
        el("span", { text: asset.name }),
      ]
      : [
        el("a", { attrs: { href: "#/keep/assets" }, text: "Assets" }), sep(),
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

  const depSec = depreciationSection(asset);
  if (depSec) sections.push(depSec);

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

  const billInner = el("div", {}, [pg([["Annual premium", formatPremium(policy)], ["Payment plan", policy.paymentPlan], ["Billing status", policy.billingStatus]])]);
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
          out.push({ doc: d, entity: ent, asset: a, policy: p, hay: `${docName(d)} ${p.line} ${a.name} ${ent.name}`.toLowerCase() });
  return out;
}

// Documents — a flat table: one row per document, with the entity, asset and
// policy it belongs to, plus a download button. Sort by clicking the columns.
export function renderKeepDocuments() {
  const rows = collectDocuments();

  const columns = [
    { label: "Document", get: (r) => docName(r.doc), cell: (r) => [
      el("span", { class: "k-doc-ic" }, [icon("doc", { size: 15 })]),
      el("a", { class: "k-ilink", attrs: { href: `#/keep/policy/${r.policy.id}` }, text: docName(r.doc) }),
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
  if (table) table.wrap.classList.add("k-doctable");   // compact, all-blue document rows
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
