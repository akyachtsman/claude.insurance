// keep/logic/entity-types.js — the entity-type taxonomy offered when creating an
// entity, grouped by colour category. `kind` drives the RLS category and the
// colour; the specific type string is stored as the entity's `label` and shown
// on its pill. Pure + unit-tested.
//
// Colours are NOT defined here. js/keep/logic/entity-display.js is the single
// source of truth for how an entity is labelled and styled (CLAUDE.md says so),
// and it maps business -> red (biz) with nonprofit -> green (np) — see the note
// above NONPROFIT_TYPES below. An earlier version of this header claimed
// "business = green", which was never true of entity-display.js and contradicted
// that note 50 lines further down.

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
  {
    category: "Individual", kind: "person",
    types: [
      "Spouse",
      "Domestic Partner",
      "Child",
      "Parent",
      "Sibling",
      "Other Family Member",
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
  // Own-property lookup: the `|| "business"` fallback cannot catch a TRUTHY
  // inherited value, so kindForType("constructor") returned the Object function
  // — and this result is written to the entity's `kind` column.
  return (Object.prototype.hasOwnProperty.call(TYPE_TO_KIND, typeLabel) && TYPE_TO_KIND[typeLabel]) || "business";
}

// Nonprofit businesses get their own (green) colour category, distinct from the
// (red) for-profit businesses. The RLS/DB `kind` stays "business"; only the
// display colour differs, keyed off the specific type label.
export const NONPROFIT_TYPES = ["Nonprofit Corporation"];
export function isNonprofitType(typeLabel) {
  return NONPROFIT_TYPES.includes(typeLabel);
}

// Default selected type (first business type).
export const DEFAULT_ENTITY_TYPE = ENTITY_TYPE_GROUPS[0].types[0];
