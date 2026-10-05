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
  const s = settings || {};  // documented as pure for (profile, settings); an
  // omitted second argument used to throw on `settings.residential` even though
  // the sub-objects already defaulted one level down.
  const needs =
    profile.domain === "residential"
      ? residentialNeeds(profile.answers, s.residential || {})
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
  const dependents = value(a.dependents) === "yes";
  const flood = value(a.flood_risk);

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

  if (dependents) {
    out.push(need("life", "Life insurance",
      "People depend on your income or care, so a death benefit would help protect them financially.", "high"));
  }

  if (flood === "yes") {
    out.push(need("flood", "Flood insurance",
      "You're in a higher flood-risk area, and flooding is excluded from standard home and renters policies.", "high"));
  }

  const highValue = meets(homeValue, s.umbrellaHomeValue);
  const manyVehicles = meets(vehicles, s.umbrellaVehicleCount);
  if (highValue || manyVehicles) {
    out.push(need("umbrella", "Umbrella / personal liability insurance",
      highValue
        ? "Your assets are high enough that a large claim could exceed standard liability limits."
        : "Multiple vehicles raise your liability exposure beyond standard policy limits.", "medium"));
  }

  if (flood === "unsure") {
    out.push(need("flood", "Flood insurance",
      "It's worth checking your flood risk — flooding is excluded from standard policies and can occur outside mapped zones.", "medium", true));
  }

  return out;
}

function commercialNeeds(a, s) {
  const out = [];
  const employees = amount(a.employee_count);
  const revenue = amount(a.revenue);
  const hasPremises = value(a.has_premises) === "yes";
  const hasProperty = value(a.owns_property) === "yes";
  const hasVehicles = value(a.company_vehicles) === "yes";
  const handlesData = value(a.handles_data) === "yes";
  const professional = Boolean(a.industry && a.industry.professional);

  out.push(need("general-liability", "General liability insurance",
    "Baseline protection against third-party injury and property-damage claims — often required by clients and landlords.", "high"));

  if (hasPremises) {
    out.push(need("bop", "Business owner's policy (BOP)",
      "You own or lease premises, which a BOP bundles with property and liability cost-effectively.", "high"));
  }

  if (meets(employees, s.workersCompMinEmployees)) {
    out.push(need("workers-comp", "Workers' compensation",
      "You have employees, and workers' compensation is legally required in nearly every state.", "high"));
  }

  if (professional) {
    out.push(need("professional-liability", "Professional liability (errors & omissions)",
      "Your industry advises or serves clients, exposing you to claims of professional error.", "high"));
  }

  if (handlesData) {
    out.push(need("cyber", "Cyber liability insurance",
      "You store customer data or depend on online systems, which exposes you to breach and ransomware costs.", "high"));
  }

  // Standalone property coverage matters when there's no BOP to bundle it, or when
  // the business is large enough that a BOP's limits likely fall short.
  if (hasProperty && (!hasPremises || meets(revenue, s.umbrellaRevenue))) {
    out.push(need("commercial-property", "Commercial property insurance",
      "You own significant equipment or inventory that would be costly to replace if damaged or stolen.", "medium"));
  }

  if (hasVehicles) {
    out.push(need("commercial-auto", "Commercial auto insurance",
      "Vehicles used for business need commercial auto coverage; personal policies exclude business use.", "medium"));
  }

  if (meets(revenue, s.umbrellaRevenue)) {
    out.push(need("commercial-umbrella", "Commercial umbrella insurance",
      "Your revenue is high enough that a major claim could exceed your underlying liability limits.", "medium"));
  }

  return out;
}

// `advisory: true` marks a need raised because the risk is UNKNOWN rather than
// established — "worth checking", not "you are missing this". Consumers that
// score coverage must not treat an advisory need as a hard gap. Priority alone
// cannot carry this: umbrella is also medium, but it fires on a value that has
// actually crossed a threshold, so it IS a real gap.
function need(id, title, why, priority, advisory) {
  return advisory ? { id, title, why, priority, advisory: true } : { id, title, why, priority };
}

// Coerce a broker-supplied threshold to a finite number, or null if it is not
// usable. rule_settings.settings is free-form jsonb with NO shape constraint,
// so a threshold can arrive as null, "", "  " or a numeric string.
function threshold(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Number("") is 0 — the empty string must be rejected BEFORE coercion, or a
  // cleared field becomes a zero threshold that everything clears.
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Does `n` meet a broker-configured threshold? FAILS CLOSED on an unusable one.
//
// Never write `n >= s.someThreshold` directly. A bare comparison against null
// coerces to `n >= 0`, which is true for every value — so clearing a threshold
// in the broker UI silently recommended the coverage to EVERYONE. A $1,000
// renter was told their "assets are high enough that a large claim could exceed
// standard liability limits", and a sole proprietor with no staff was told "you
// have employees" and needed workers' comp. Note `undefined` happened to fail
// closed while `null` failed open, so the behaviour flipped on a distinction
// invisible at the call site. Recommending a coverage nobody needs is the
// failure this engine must not have: it is the output a client acts on.
function meets(n, v) {
  const t = threshold(v);
  return t != null && n >= t;
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
