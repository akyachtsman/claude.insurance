// keep/logic/asset-meta.js — asset-type presentation vocabulary (icon, colour,
// label) for the app. Pure data, no DOM. docs/data-model.md names this the
// canonical source for asset-type labels.
//
// Split out of the old js/keep/logic/data.js (audit 2026-10-05). That file was
// 88% offline TEST FIXTURE and 6% this map, and because js/supabase.js — which
// is on the render path — imported the map from it, the whole file was listed in
// index.html's MODULES and the full ~12KB fixture was fetched and evaluated on
// EVERY page load, including the anonymous marketing site. There is no build
// step and no tree-shaking, so nothing was going to drop it.
export const ASSET_META = {
  home: { cic: "home", icon: "home", label: "Home" },
  auto: { cic: "auto", icon: "auto", label: "Vehicle" },
  watercraft: { cic: "boat", icon: "boat", label: "Watercraft" },
  valuables: { cic: "gem", icon: "gem", label: "Valuables" },
  "commercial-space": { cic: "cp", icon: "commercial-property", label: "Commercial space" },
  "commercial-auto": { cic: "auto", icon: "commercial-auto", label: "Commercial auto" },
  business: { cic: "cp", icon: "briefcase", label: "Business" },
  // "other" covers land/vacant lots and any miscellaneous asset (see ASSET_GROUPS
  // in keep.js). Kept in sync so these render an icon/colour instead of crashing.
  other: { cic: "home", icon: "shield", label: "Other" },
};
