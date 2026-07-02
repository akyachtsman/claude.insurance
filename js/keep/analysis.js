// keep/analysis.js — asset coverage analysis for the Keep.
// Reuses the shared rules engine (computeNeeds) for the broker-configurable,
// risk-based RECOMMENDED coverages; core "must have" coverages per asset type
// come from the catalog below. Pure + deterministic so it's unit-testable and
// will carry over unchanged when real assets come from Supabase.

import { computeNeeds } from "../rules.js";

const CATALOG = {
  home: {
    must: [
      { id: "dwelling", title: "Dwelling (building)", why: "Rebuild cost for the structure itself", icon: "home" },
      { id: "home-liability", title: "Personal liability", why: "If someone is injured on your property", icon: "shield" },
      { id: "home-contents", title: "Personal property", why: "Your belongings inside the home", icon: "briefcase" },
    ],
    profile: (asset) => ({
      domain: "residential",
      answers: {
        home_status: { value: "own" },
        home_value: { amount: asset.value || 0 },
        flood_risk: { value: asset.attrs && asset.attrs.floodZone ? "yes" : "unsure" },
      },
    }),
    recommend: new Set(["flood", "umbrella"]),
    icon: { flood: "flood", umbrella: "umbrella" },
    suggest: [
      { id: "water-backup", title: "Water backup endorsement", why: "Sewer/sump backup is not covered by default", icon: "flood" },
    ],
  },
  auto: {
    must: [
      { id: "auto-liability", title: "Auto liability", why: "Required in most states; covers injury or damage you cause", icon: "auto" },
      { id: "auto-physical", title: "Collision & comprehensive", why: "Repairs to your own vehicle — usually required while financed", icon: "auto" },
    ],
    recommend: new Set(),
  },
  watercraft: {
    must: [
      { id: "watercraft-hull", title: "Hull / physical damage", why: "Repair or replace the boat after damage or theft", icon: "boat" },
      { id: "watercraft-liability", title: "Watercraft liability", why: "Injury or damage you cause on the water", icon: "shield" },
    ],
    recommend: new Set(),
  },
  valuables: {
    must: [
      { id: "valuables-floater", title: "Scheduled personal property", why: "A floater covers high-value items above home-policy sub-limits", icon: "gem" },
    ],
    recommend: new Set(),
    suggest: [
      { id: "valuables-appraisal", title: "Keep appraisals current", why: "Re-appraise periodically so limits match value", icon: "spark" },
    ],
  },
  "commercial-space": {
    must: [
      { id: "general-liability", title: "General liability", why: "Third-party injury and property-damage claims", icon: "general-liability" },
      { id: "commercial-property", title: "Commercial property", why: "Equipment, fixtures and inventory at the space", icon: "commercial-property" },
    ],
    recommend: new Set(),
    suggest: [
      { id: "cyber", title: "Cyber liability", why: "If you take card payments or store customer data", icon: "cyber" },
    ],
  },
  "commercial-auto": {
    must: [
      { id: "commercial-auto", title: "Commercial auto", why: "Personal policies exclude business use of a vehicle", icon: "commercial-auto" },
    ],
    recommend: new Set(),
  },
  // An operating business (going concern) held by a company/entity — BOP-style.
  business: {
    must: [
      { id: "general-liability", title: "General liability", why: "Third-party injury and property-damage claims", icon: "general-liability" },
      { id: "business-income", title: "Business income", why: "Lost revenue if operations are interrupted", icon: "briefcase" },
      { id: "commercial-property", title: "Property & contents", why: "Equipment, fixtures and inventory", icon: "commercial-property" },
    ],
    recommend: new Set(),
    suggest: [
      { id: "cyber", title: "Cyber liability", why: "If you take card payments or store customer data", icon: "cyber" },
      { id: "workers-comp", title: "Workers' compensation", why: "Required once you have employees", icon: "workers-comp" },
    ],
  },
};

export function analyzeAsset(asset, settings) {
  const cat = CATALOG[asset.type];
  if (!cat) return { mustHave: [], recommended: [], gaps: 0 };
  const held = new Set(asset.held || []);

  const mustHave = cat.must.map((c) => ({ ...c, status: held.has(c.id) ? "in-place" : "gap" }));

  const recommended = [];
  if (cat.profile && cat.recommend && cat.recommend.size) {
    const needs = computeNeeds(cat.profile(asset), settings || {});
    for (const n of needs) {
      if (!cat.recommend.has(n.id)) continue;
      recommended.push({
        id: n.id,
        title: n.title,
        why: n.why,
        icon: (cat.icon && cat.icon[n.id]) || n.id,
        status: held.has(n.id) ? "in-place" : "gap",
      });
    }
  }
  for (const s of cat.suggest || []) {
    recommended.push({ ...s, status: held.has(s.id) ? "in-place" : "suggested" });
  }

  const gaps = [...mustHave, ...recommended].filter((c) => c.status === "gap").length;
  return { mustHave, recommended, gaps };
}

// Roll an asset's analysis into one card status.
export function assetStatus(asset, settings) {
  const { mustHave, recommended, gaps } = analyzeAsset(asset, settings);
  const mustGaps = mustHave.filter((c) => c.status === "gap").length;
  if (mustHave.length && mustGaps === mustHave.length) return { cls: "gap", icon: "alert", label: "Not insured", gaps };
  if (gaps > 0) return { cls: "gap", icon: "alert", label: `${gaps} gap${gaps > 1 ? "s" : ""} found`, gaps };
  if (recommended.some((c) => c.status === "suggested")) return { cls: "rec", icon: "spark", label: "1 recommendation", gaps: 0 };
  return { cls: "ok", icon: "check", label: "Protected", gaps: 0 };
}

// Aggregate counts for an entity card/header.
export function entitySummary(entity, settings) {
  let inPlace = 0, gaps = 0;
  for (const asset of entity.assets) {
    const { mustHave, recommended } = analyzeAsset(asset, settings);
    for (const c of [...mustHave, ...recommended]) {
      if (c.status === "in-place") inPlace += 1;
      if (c.status === "gap") gaps += 1;
    }
  }
  return { assets: entity.assets.length, inPlace, gaps };
}
