// keep/depreciation.js — per-asset-type actual-cash-value (ACV) depreciation.
// Pure + deterministic (unit-testable, no I/O). Treats the asset's current
// estimated value as today's replacement cost and projects a straight-line ACV
// decline over the type's useful life down to a salvage floor. Property, land
// and valuables are treated as non-depreciating (they hold value or appreciate),
// so they carry no schedule — the view shows a "holds value" note instead.

// life: useful life in years · salvage: floor as a fraction of replacement cost.
// Types absent from this map are non-depreciating (see depreciationFor).
export const DEPRECIATION = {
  auto: { life: 10, salvage: 0.15 },
  "commercial-auto": { life: 8, salvage: 0.15 },
  watercraft: { life: 15, salvage: 0.20 },
};

// depreciationFor(asset) → {
//   depreciates, rc (replacement cost = today's value), life, salvage,
//   annual ($/yr straight-line), floor (salvage $),
//   schedule: [{ year, rc, acv, dep }]  (year 0 = today … year = life)
// }
export function depreciationFor(asset) {
  const rc = Math.max(0, Math.round(asset && asset.value ? asset.value : 0));
  const cfg = asset ? DEPRECIATION[asset.type] : null;
  if (!cfg || !rc) {
    return { depreciates: false, rc, life: 0, salvage: 0, annual: 0, floor: rc, schedule: [] };
  }
  const floor = Math.round(rc * cfg.salvage);
  const annual = Math.round((rc - floor) / cfg.life); // straight-line $/yr (avg)
  const schedule = [];
  for (let year = 0; year <= cfg.life; year++) {
    // Interpolate from the exact fraction so the final year lands on the floor
    // precisely (rounding the per-year step instead would drift off it).
    const frac = Math.min(year / cfg.life, 1);
    const acv = Math.max(floor, Math.round(rc - (rc - floor) * frac));
    schedule.push({ year, rc, acv, dep: rc - acv });
  }
  return { depreciates: true, rc, life: cfg.life, salvage: cfg.salvage, annual, floor, schedule };
}

// Sample the schedule down to a tidy set of milestone rows for display, so a
// 15-year table doesn't print 16 rows. Always includes today (0) and the final
// year (full salvage floor). Empty for non-depreciating assets.
export function depreciationMilestones(dep) {
  if (!dep.depreciates) return [];
  const marks = [...new Set([0, 1, 2, 3, 5, 10, dep.life].filter((y) => y <= dep.life))].sort((a, b) => a - b);
  return marks.map((y) => dep.schedule[y]);
}
