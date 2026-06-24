// keep/data.js — sample entities & assets for the Keep demo prototype.
// STUB: no backend yet. When Supabase is provisioned this is replaced by a
// per-user query (entities + assets scoped by RLS). Shapes mirror what the
// real tables will return so views/analysis don't change.

export const SAMPLE = {
  user: { name: "Jordan Mercer", initials: "JM" },
  entities: [
    {
      id: "me",
      kind: "personal",
      name: "Jordan Mercer",
      label: "You · personal",
      initials: "ME",
      assets: [
        {
          id: "home-marina",
          type: "home",
          name: "123 Marina Way",
          meta: "Single-family home · Naples, FL",
          value: 920000,
          facts: ["Single-family home", "Naples, FL", "Built 1998", "Coastal · FEMA AE"],
          attrs: { floodZone: true },
          held: ["dwelling", "home-liability", "home-contents"],
        },
        {
          id: "tesla-my",
          type: "auto",
          name: "2023 Tesla Model Y",
          meta: "Vehicle · financed",
          value: null,
          facts: ["Vehicle", "Financed", "Primary driver"],
          attrs: {},
          held: ["auto-liability", "auto-physical"],
        },
        {
          id: "sea-breeze",
          type: "watercraft",
          name: "Sea Breeze 28'",
          meta: "Watercraft · powerboat",
          value: 140000,
          facts: ["Powerboat", "28 ft", "Moored"],
          attrs: {},
          held: [],
        },
        {
          id: "valuables",
          type: "valuables",
          name: "Jewelry & valuables",
          meta: "3 scheduled items",
          value: 48000,
          facts: ["3 scheduled items", "Appraised"],
          attrs: {},
          held: ["valuables-floater"],
        },
      ],
    },
    {
      id: "coastal-cafe",
      kind: "business",
      subtype: "LLC",
      name: "Coastal Cafe LLC",
      label: "LLC",
      icon: "briefcase",
      meta: "EIN ••–•••4821 · Food service",
      assets: [
        {
          id: "harbor-dr",
          type: "commercial-space",
          name: "312 Harbor Dr (leased)",
          meta: "Commercial space · 1,800 sq ft",
          value: null,
          facts: ["Leased space", "1,800 sq ft", "Food service"],
          attrs: { employees: 6, revenue: 850000 },
          held: ["general-liability"],
        },
        {
          id: "delivery-van",
          type: "commercial-auto",
          name: "Delivery van",
          meta: "Commercial auto · 2021",
          value: null,
          facts: ["Commercial auto", "2021"],
          attrs: {},
          held: ["commercial-auto"],
        },
      ],
    },
  ],
};

export function getEntity(id) {
  return SAMPLE.entities.find((e) => e.id === id) || null;
}

export function findAsset(assetId) {
  for (const entity of SAMPLE.entities) {
    const asset = entity.assets.find((a) => a.id === assetId);
    if (asset) return { entity, asset };
  }
  return null;
}

// Asset-type display metadata (icon + the rounded icon-tile color class).
export const ASSET_META = {
  home: { cic: "home", icon: "home" },
  auto: { cic: "auto", icon: "auto" },
  watercraft: { cic: "boat", icon: "boat" },
  valuables: { cic: "gem", icon: "gem" },
  "commercial-space": { cic: "cp", icon: "commercial-property" },
  "commercial-auto": { cic: "auto", icon: "commercial-auto" },
};
