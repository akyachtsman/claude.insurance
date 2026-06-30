// keep/entity-types.js — the entity-type taxonomy offered when creating an
// entity, grouped by colour category. `kind` drives the colour + RLS category
// (personal = blue, business = green, trust = amber); the specific type string
// is stored as the entity's `label` and shown on its pill. Pure + unit-tested.

export const ENTITY_TYPE_GROUPS = [
  {
    category: "Business", kind: "business",
    types: [
      "LLC",
      "C Corporation",
      "S Corporation",
      "Professional Corporation (PC)",
      "Nonprofit Corporation",
      "Benefit Corporation",
      "General Partnership",
      "Limited Partnership (LP)",
      "Limited Liability Partnership (LLP)",
      "Sole Proprietorship",
      "Cooperative",
    ],
  },
  {
    category: "Trust & Estate", kind: "trust",
    types: [
      "Revocable Trust",
      "Irrevocable Trust",
      "Testamentary Trust",
      "Estate",
    ],
  },
];

// Specific type label → colour/RLS category kind.
export const TYPE_TO_KIND = (() => {
  const map = {};
  for (const g of ENTITY_TYPE_GROUPS) for (const t of g.types) map[t] = g.kind;
  return map;
})();

export function kindForType(typeLabel) {
  return TYPE_TO_KIND[typeLabel] || "business";
}

// Default selected type (first business type).
export const DEFAULT_ENTITY_TYPE = ENTITY_TYPE_GROUPS[0].types[0];
