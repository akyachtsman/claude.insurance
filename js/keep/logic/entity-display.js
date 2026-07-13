// keep/entity-display.js — the SINGLE source of truth for how an entity is
// labelled and styled everywhere it appears (rows, cards, detail header, the
// relationship map). Pure functions derived from the canonical record fields
// (`kind` + `subtype`/`label` + `name`) so a label can never diverge between two
// views — the class of bug where the map said "You · personal" while the table
// said "UBO". Nothing here reads or invents identity that isn't on the record.

import { isNonprofitType } from "./entity-types.js";

// Broad category shown as the Type pill. Derived purely from `kind`:
//   personal → UBO (the account holder / ultimate beneficial owner)
//   person   → Individual (spouse, partners, other people)
//   business → Business · trust → Trust
export function entityCategory(entity) {
  if (entity.kind === "business") return "Business";
  if (entity.kind === "trust") return "Trust";
  if (entity.kind === "personal") return "UBO";
  return "Individual";
}

// Per-type colour key, consistent across the app:
//   You / People → blue (me/person) · Business → red (biz) · Nonprofit → green
//   (np) · Trust & Estate → amber (trust).
export function entityColorSuffix(entity) {
  if (entity.kind === "business") return isNonprofitType(entity.subtype || entity.label) ? "np" : "biz";
  if (entity.kind === "trust") return "trust";
  if (entity.kind === "person") return "person";
  return "me";
}

// Relationship-map style key — same mapping as the colour suffix (kept as a
// named alias so callers read clearly; unified so the two can never drift).
export const entityRelStyleKey = entityColorSuffix;

// The specific subtype ("LLC", "Revocable Trust", "Spouse", …). The canonical
// column is `subtype`; some seeded rows only carry it in `label`, so fall back
// to that — but never surface a generic category word as if it were a subtype.
const GENERIC_TYPE = new Set(["business", "company", "trust", "individual", "personal", "you · personal", "you · ubo", ""]);
export function entitySubtype(entity) {
  for (const c of [entity.subtype, entity.label]) {
    if (c && !GENERIC_TYPE.has(c.trim().toLowerCase())) return c;
  }
  return entity.kind === "personal" ? "You" : "—";
}

// Business industry ("Media", "Real estate", …). Its own record column now,
// distinct from `subtype` (the legal structure). Empty for non-businesses.
export function entityIndustry(entity) {
  return entity && entity.industry ? entity.industry : "";
}

// Sprite glyph for the entity avatar (frame-less line icon), by kind.
export function entityAvatarIcon(entity) {
  return entity.kind === "business" ? "ent-company" : (entity.kind === "trust" ? "ent-trust" : "ent-person");
}

// Sub-label under an entity's name on the relationship map. The account holder
// is the UBO; everyone else shows their specific subtype/role. Accepts either a
// full entity or a map node (which carries `subtype`/`sub`).
export function entityMapSub(entity) {
  if (entity.kind === "personal") return "You · UBO";
  return entity.subtype || entity.label || entity.sub || "";
}
