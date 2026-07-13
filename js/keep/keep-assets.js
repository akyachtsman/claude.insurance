// keep/keep-assets.js — the Assets domain of the Keep portal.
// The all-assets table, the asset detail page (with its value & depreciation
// schedule), and the add-asset picker flow. Extracted from views/keep.js; hangs
// in the shared chrome from shell.js. Public: renderKeepAssets / renderKeepAsset
// / renderKeepAddAsset.
import { el, mount } from "../dom.js";
import { go } from "../main.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { getRuleDefaults } from "../content.js";
import { ASSET_META } from "./data.js";
import { analyzeAsset } from "./analysis.js";
import { depreciationFor, depreciationMilestones } from "./depreciation.js";
import { findAsset, addAsset, ensureData, getAllAssets, getEntities } from "../supabase.js";
import {
  BROKER_NAME, sep, page, backLink, originHref, money, cic, assetTypeLabel, assetTypeIcon,
  policyTypeIcon, coveragePill, policiesSection, sortableTable, statTile,
} from "./shell.js";

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

