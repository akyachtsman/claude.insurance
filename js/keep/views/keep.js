// views/keep.js — "The Keep" authenticated portal (Direction C).
// Renders login, dashboard (entities + nested assets), entity detail, add-asset,
// and the asset coverage-analysis page. Reads/writes live Supabase data (loaded
// by the route guard in main.js); RLS scopes everything to the signed-in client.

import { el, mount } from "../../dom.js";
import { go } from "../../main.js";
import { icon } from "../../icons.js";
import { s } from "../../svg.js";
import { getRuleDefaults } from "../../content.js";
import {
  getUser, getEntities, signIn, addEntity,
  ensureData, DEMO_CREDENTIAL, addRelationship, loadEnhancementRequests,
} from "../../supabase.js";
import { entitySummary } from "../logic/analysis.js";
import { policyKind, renewalBand, annualPremium, formatPremium } from "../logic/policies.js";
import { statusDisplay, stageInfo, isPending } from "../logic/requests.js";
import { docName } from "../logic/docfile.js";
import { OWNERSHIP_ROLES, totalStake, validateOwnership, stakeLabel } from "../logic/ownership.js";
import { ENTITY_TYPE_GROUPS, kindForType } from "../logic/entity-types.js";
import { renderKeepEntityList, renderKeepEntityGrid, renderKeepEntities, renderKeepEntity } from "./entities.js";
export { renderKeepEntityList, renderKeepEntityGrid, renderKeepEntities, renderKeepEntity };
export { renderKeepAssets, renderKeepAsset, renderKeepAddAsset } from "./assets.js";
export { renderKeepPolicy, renderKeepRequest, renderKeepRequests } from "./policies-view.js";
import {
  BROKER_NAME, buildReminderSettings,
  money, downloadButton, docDownloadMenu, ribbon, landingCommand, page,
  backLink, cic, policyTypeIcon, dateShort, expiryBadge, signOutButton,
  sortableTable, statTile, requestStepper,
} from "./shell.js";

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


// Landing — welcome + "what would you like to do?" + a renewals report and
// at-a-glance boxes. The home of the Keep (#/keep).
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
    el("p", { class: "k-sub", text: "Create a business or trust to organize its assets and coverage." }),
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
