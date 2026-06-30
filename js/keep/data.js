// keep/data.js — OFFLINE TEST FIXTURE for the Keep (+ ASSET_META, used by the app).
// The live app reads from Supabase via js/supabase.js; this sample tree is no
// longer the app's data source — it backs the offline unit tests (analysis/rules)
// which can't reach a live DB. Shapes mirror the real tables so the tests and the
// adapter agree. ASSET_META (asset-type icon/colour) is still imported by the app.
//
// Policy records carry the standard declarations-page fields (researched against
// NAIC / state DOIs / carriers): identity, insured item, Coverage A–F + limits,
// endorsements, deductibles, premium & billing, mortgagee/interests, documents,
// claims. Renewal dates are stored as offsets in days from "now" so the demo's
// expiry badges stay meaningful over time.

export const SAMPLE = {
  user: { name: "Jordan Mercer", initials: "JM", email: "jordan.m@example.com" },
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
          held: ["dwelling", "home-liability", "home-contents", "flood"],
          policies: [
            {
              id: "ho3-marina", line: "Homeowners (HO-3)", form: "HO-3 (special)", cic: "home", icon: "home",
              carrier: "Gulfstream P&C", naic: "12345", number: "HO-4471892",
              effectiveInDays: -102, renewalInDays: 263, autoRenew: true,
              namedInsured: "Jordan & Alex Mercer", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Dwelling type", "Single-family"], ["Year built", "1998"], ["Construction", "Masonry"], ["Roof", "Replaced 2021"], ["Protection class", "3 · FEMA zone AE"]],
              coverages: [
                { tag: "A", label: "Dwelling", limit: "$920,000" },
                { tag: "B", label: "Other structures", limit: "$92,000" },
                { tag: "C", label: "Personal property", limit: "$460,000" },
                { tag: "D", label: "Loss of use", limit: "$184,000" },
                { tag: "E", label: "Personal liability", limit: "$300,000", recommended: "$500,000" },
                { tag: "F", label: "Medical payments", limit: "$5,000" },
              ],
              endorsements: ["Water backup $10K", "Ordinance/law 10%", "Scheduled jewelry $25K"],
              deductibles: [["All-peril", "$5,000"], ["Hurricane / wind", "2% ($18,400)"], ["Flood", "Separate NFIP policy"]],
              premium: "$3,420 / yr", paymentPlan: "Monthly · $285", billingStatus: "Current",
              discounts: ["Bundle", "New roof", "Claims-free"],
              interests: [["Mortgagee", "Harbor Bank, N.A."], ["Loan number", "••••8830"], ["Loss payee", "Harbor Bank (1st)"]],
              documents: ["Declarations page", "Full policy", "Endorsements"],
              claims: "1 claim — wind/hail, Sep 2022, paid $8,400",
            },
            {
              id: "flood-marina", line: "Flood (NFIP)", form: "Dwelling form", cic: "boat", icon: "flood",
              carrier: "FloodPro / NFIP", naic: "—", number: "FLD-22119",
              effectiveInDays: -353, renewalInDays: 12, autoRenew: false,
              namedInsured: "Jordan & Alex Mercer", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Flood zone", "AE"], ["Elevation cert.", "On file"]],
              coverages: [
                { tag: "—", label: "Building", limit: "$250,000" },
                { tag: "—", label: "Contents", limit: "$100,000" },
              ],
              endorsements: [],
              deductibles: [["Building", "$2,000"], ["Contents", "$2,000"]],
              premium: "$1,180 / yr", paymentPlan: "Annual", billingStatus: "Current",
              discounts: [], interests: [["Mortgagee", "Harbor Bank, N.A."]],
              documents: ["Declarations page"], claims: "None",
            },
            {
              id: "wind-marina", line: "Windstorm", form: "Wind-only", cic: "home", icon: "umbrella",
              carrier: "Coastal Wind Pool", naic: "67890", number: "WS-7781",
              effectiveInDays: -388, renewalInDays: -23, autoRenew: false,
              namedInsured: "Jordan & Alex Mercer", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Construction", "Masonry"], ["Roof", "Replaced 2021"]],
              coverages: [{ tag: "—", label: "Wind / hail", limit: "$920,000" }],
              endorsements: [], deductibles: [["Hurricane", "2% ($18,400)"]],
              premium: "$2,260 / yr", paymentPlan: "Annual", billingStatus: "Lapsed",
              discounts: [], interests: [["Mortgagee", "Harbor Bank, N.A."]],
              documents: ["Declarations page"], claims: "None",
            },
          ],
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
          policies: [
            {
              id: "auto-tesla", line: "Personal auto", form: "PAP", cic: "auto", icon: "auto",
              carrier: "Anchor Mutual", naic: "24680", number: "AU-90233",
              effectiveInDays: -220, renewalInDays: 140, autoRenew: true,
              namedInsured: "Jordan Mercer", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Vehicle", "2023 Tesla Model Y"], ["VIN", "••••4471"], ["Driver", "Jordan Mercer"]],
              coverages: [
                { tag: "—", label: "Bodily injury liability", limit: "$250K / $500K" },
                { tag: "—", label: "Property damage liability", limit: "$100,000" },
                { tag: "—", label: "Collision", limit: "ACV" },
                { tag: "—", label: "Comprehensive", limit: "ACV" },
                { tag: "—", label: "Uninsured motorist", limit: "$250K / $500K" },
                { tag: "—", label: "Medical payments", limit: "$5,000" },
              ],
              endorsements: ["Roadside assistance", "Rental reimbursement"],
              deductibles: [["Collision", "$500"], ["Comprehensive", "$250"]],
              premium: "$1,910 / yr", paymentPlan: "Monthly · $159", billingStatus: "Current",
              discounts: ["Bundle", "Safe driver", "EV"],
              interests: [["Lienholder", "Harbor Bank, N.A."]],
              documents: ["Declarations page", "ID cards"], claims: "None",
            },
          ],
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
          policies: [],
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
          policies: [
            {
              id: "floater-valuables", line: "Scheduled personal property", form: "Floater", cic: "gem", icon: "gem",
              carrier: "Gulfstream P&C", naic: "12345", number: "SPP-3321",
              effectiveInDays: -160, renewalInDays: 205, autoRenew: true,
              namedInsured: "Jordan Mercer", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Items", "3 scheduled"], ["Appraisals", "On file"]],
              coverages: [
                { tag: "—", label: "Diamond ring", limit: "$22,000" },
                { tag: "—", label: "Watch", limit: "$15,000" },
                { tag: "—", label: "Necklace", limit: "$11,000" },
              ],
              endorsements: ["Worldwide coverage"], deductibles: [["All-peril", "$0"]],
              premium: "$410 / yr", paymentPlan: "Annual", billingStatus: "Current",
              discounts: [], interests: [], documents: ["Declarations page", "Appraisals"], claims: "None",
            },
          ],
        },
      ],
    },
    {
      id: "coastal-cafe",
      kind: "business",
      subtype: null,
      name: "Coastal Cafe LLC",
      label: "Business",
      icon: "briefcase",
      meta: "EIN ••–•••4821 · Food service",
      relationship: { role: "Managing member", stake: "50%" },
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
          policies: [
            {
              id: "bop-harbor", line: "Business owner's policy (BOP)", form: "BOP", cic: "cp", icon: "general-liability",
              carrier: "Harbor Commercial", naic: "13579", number: "BOP-55120",
              effectiveInDays: -270, renewalInDays: 88, autoRenew: true,
              namedInsured: "Coastal Cafe LLC", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Location", "312 Harbor Dr"], ["Sq ft", "1,800"], ["Class", "Restaurant"]],
              coverages: [
                { tag: "—", label: "General liability", limit: "$1M / $2M" },
                { tag: "—", label: "Business personal property", limit: "$180,000" },
                { tag: "—", label: "Business income", limit: "12 months" },
              ],
              endorsements: ["Liquor liability", "Spoilage"],
              deductibles: [["Property", "$2,500"]],
              premium: "$4,260 / yr", paymentPlan: "Monthly · $355", billingStatus: "Current",
              discounts: ["Protective devices"], interests: [["Landlord (add'l insured)", "Harbor Dr Holdings"]],
              documents: ["Declarations page", "Full policy"], claims: "None",
            },
          ],
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
          policies: [
            {
              id: "cauto-van", line: "Commercial auto", form: "BAP", cic: "auto", icon: "commercial-auto",
              carrier: "Harbor Commercial", naic: "13579", number: "CA-77410",
              effectiveInDays: -240, renewalInDays: 120, autoRenew: true,
              namedInsured: "Coastal Cafe LLC", agent: "Rosa Alvarez", agentContact: "(239) 555-0142",
              details: [["Vehicle", "2021 Ford Transit"], ["VIN", "••••2210"], ["Use", "Delivery"]],
              coverages: [
                { tag: "—", label: "Liability (CSL)", limit: "$1,000,000" },
                { tag: "—", label: "Collision", limit: "ACV" },
                { tag: "—", label: "Comprehensive", limit: "ACV" },
              ],
              endorsements: ["Hired & non-owned auto"], deductibles: [["Collision", "$1,000"], ["Comprehensive", "$500"]],
              premium: "$2,140 / yr", paymentPlan: "Monthly · $178", billingStatus: "Current",
              discounts: [], interests: [], documents: ["Declarations page", "ID cards"], claims: "None",
            },
          ],
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

export function findPolicy(policyId) {
  for (const entity of SAMPLE.entities) {
    for (const asset of entity.assets) {
      const policy = (asset.policies || []).find((p) => p.id === policyId);
      if (policy) return { entity, asset, policy };
    }
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
