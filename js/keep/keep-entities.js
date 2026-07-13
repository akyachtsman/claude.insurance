// keep/keep-entities.js — the Entities domain of the Keep portal.
// The three entity views (Rows list, Cards grid, Relationships map) and the
// entity detail page, plus the entity table/tile builders and the drag-and-drop
// card-reorder subsystem. Extracted from views/keep.js; hangs in the shared
// chrome from shell.js. Public: renderKeepEntityList/Grid/Entities/Entity.
import { el, mount } from "../dom.js";
import { go } from "../main.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { getRuleDefaults } from "../content.js";
import { assetStatus, entitySummary } from "./analysis.js";
import { parsePct } from "./ownership.js";
import { entityCategory, entitySubtype, entityColorSuffix as colorSuffix, entityIndustry } from "./entity-display.js";
import { relationshipMap, relToolbar } from "./relmap-view.js";
import { getEntities, getEntity, getMapData } from "../supabase.js";
import {
  money, cic, page, backLink, originBackRow, sortableTable, statTile, sep,
  entityAvatar, primaryEntity, saveCardOrder, loadCardOrder,
} from "./shell.js";

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
