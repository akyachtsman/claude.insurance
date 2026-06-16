// rules.js — needs/gap engine.
//
// Pure and deterministic: computeNeeds(profile, settings) -> prioritized needs[].
// No thresholds are hard-coded; every numeric limit comes from `settings`, which
// mirrors the broker-editable Supabase rule_settings row. This keeps the rules
// broker-configurable from v1 and lets the same engine power v2 asset gaps.
//
// profile shape:
//   { domain: "residential" | "commercial",
//     answers: { [stepId]: { value, amount?, professional? } } }
//
// A "need" is { id, title, why, priority }, priority in {"high","medium"}.

const PRIORITY_ORDER = { high: 0, medium: 1 };

export function computeNeeds(profile, settings) {
  if (!profile || !profile.answers) return [];
  const needs =
    profile.domain === "residential"
      ? residentialNeeds(profile.answers, settings.residential || {})
      : profile.domain === "commercial"
        ? commercialNeeds(profile.answers, settings.commercial || {})
        : [];
  return dedupeAndSort(needs);
}

function residentialNeeds(a, s) {
  const out = [];
  const status = value(a.home_status);
  const homeValue = amount(a.home_value);
  const vehicles = amount(a.vehicle_count);

  if (status === "own") {
    out.push(need("home", "Homeowners insurance",
      "You own your home, so protecting the structure and your liability is foundational.", "high"));
  } else if (status === "rent") {
    out.push(need("renters", "Renters insurance",
      "As a renter, your landlord's policy won't cover your belongings or personal liability.", "high"));
  }

  if (vehicles >= 1) {
    out.push(need("auto", "Auto insurance",
      "You have a vehicle in the household, and liability coverage is required in most states.", "high"));
  }

  const highValue = homeValue >= s.umbrellaHomeValue;
  const manyVehicles = vehicles >= s.umbrellaVehicleCount;
  if (highValue || manyVehicles) {
    out.push(need("umbrella", "Umbrella liability",
      highValue
        ? "Your assets are high enough that a large claim could exceed standard liability limits."
        : "Multiple vehicles raise your liability exposure beyond standard policy limits.", "medium"));
  }

  return out;
}

function commercialNeeds(a, s) {
  const out = [];
  const employees = amount(a.employee_count);
  const revenue = amount(a.revenue);
  const hasPremises = value(a.has_premises) === "yes";
  const hasVehicles = value(a.company_vehicles) === "yes";
  const professional = Boolean(a.industry && a.industry.professional);

  out.push(need("general-liability", "General liability insurance",
    "Baseline protection against third-party injury and property-damage claims — often required by clients and landlords.", "high"));

  if (hasPremises) {
    out.push(need("bop", "Business owner's policy (BOP)",
      "You own or lease premises or equipment, which a BOP bundles with liability cost-effectively.", "high"));
  }

  if (employees >= s.workersCompMinEmployees) {
    out.push(need("workers-comp", "Workers' compensation",
      "You have employees, and workers' compensation is legally required in nearly every state.", "high"));
  }

  if (professional) {
    out.push(need("professional-liability", "Professional liability (E&O)",
      "Your industry advises or serves clients, exposing you to claims of professional error.", "high"));
  }

  if (hasVehicles) {
    out.push(need("commercial-auto", "Commercial auto insurance",
      "Vehicles used for business need commercial auto coverage; personal policies exclude business use.", "medium"));
  }

  if (revenue >= s.umbrellaRevenue) {
    out.push(need("commercial-umbrella", "Commercial umbrella",
      "Your revenue is high enough that a major claim could exceed your underlying liability limits.", "medium"));
  }

  return out;
}

function need(id, title, why, priority) {
  return { id, title, why, priority };
}

function value(answer) {
  return answer ? answer.value : undefined;
}

function amount(answer) {
  return answer && typeof answer.amount === "number" ? answer.amount : 0;
}

function dedupeAndSort(needs) {
  const seen = new Set();
  const unique = [];
  for (const n of needs) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  // Stable sort by priority; insertion order preserved within a priority.
  return unique
    .map((n, i) => [n, i])
    .sort((x, y) => (PRIORITY_ORDER[x[0].priority] - PRIORITY_ORDER[y[0].priority]) || (x[1] - y[1]))
    .map(([n]) => n);
}
