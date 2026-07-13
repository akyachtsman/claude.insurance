// keep/policies.js — pure helpers for policy expiry + renewal reminders.
// No Date use here so it's deterministic/testable; the view supplies the actual
// calendar date for display. "renewalInDays" is days from now (negative = past).

// Default lead-times (days before renewal) to send reminders on. Mirrored by the
// profiles.reminder_schedule column default in supabase/migrations — keep in sync.
export const REMINDER_SCHEDULE = [60, 30, 14, 7, 1];

// Badge state for a policy based on days until renewal.
export function policyKind(renewalInDays) {
  if (renewalInDays <= 0) return "exp";   // due today / expired / lapsed
  if (renewalInDays <= 30) return "warn"; // expiring soon
  return "ok";                            // active
}

// Urgency band for an upcoming renewal, escalating as the date nears. Drives the
// colour priority on the landing renewals report. Returns null when the renewal
// is further out than the 60-day report window (or unknown).
// Bands: lapsed (past) · urgent (≤3d) · week (≤7d) · soon (≤30d) · upcoming (≤60d).
export function renewalBand(renewalInDays) {
  if (renewalInDays == null) return null;
  if (renewalInDays < 0) return "lapsed";
  if (renewalInDays <= 3) return "urgent";
  if (renewalInDays <= 7) return "week";
  if (renewalInDays <= 30) return "soon";
  if (renewalInDays <= 60) return "upcoming";
  return null;
}

// SINGLE source of truth for how a policy line presents everywhere, keyed on the
// canonical `line`. Each facet: key + label (the specific coverage type) + icon
// (detailed frame-less glyph for the Policies table's leading column) + card
// (small glyph on policy detail cards) + color (the `cic` tile-colour class).
// The adapter (js/supabase.js) and the views all read from here, so the two
// former line→presentation maps can no longer drift.
const POLICY_LINE = {
  "Homeowners (HO-3)": { key: "home", label: "Home insurance", icon: "as-home", card: "home", color: "home" },
  "Windstorm": { key: "windstorm", label: "Windstorm insurance", icon: "as-home", card: "umbrella", color: "home" },
  "Flood (NFIP)": { key: "flood", label: "Flood insurance", icon: "as-home", card: "flood", color: "boat" },
  "Dwelling": { key: "dwelling", label: "Dwelling insurance", icon: "as-home", card: "home", color: "home" },
  "Personal auto": { key: "auto", label: "Auto insurance", icon: "as-auto", card: "auto", color: "auto" },
  "Commercial auto": { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck", card: "commercial-auto", color: "auto" },
  "Watercraft": { key: "watercraft", label: "Watercraft insurance", icon: "as-boat", card: "boat", color: "boat" },
  "Scheduled personal property": { key: "valuables", label: "Valuables insurance", icon: "as-gem", card: "gem", color: "gem" },
  "Business owner's policy (BOP)": { key: "business", label: "Business insurance", icon: "as-commercial", card: "general-liability", color: "cp" },
  "General liability": { key: "liability", label: "Liability insurance", icon: "as-shield", card: "general-liability", color: "cp" },
  "Umbrella": { key: "umbrella", label: "Umbrella insurance", icon: "as-shield", card: "umbrella", color: "cp" },
};
const POLICY_LINE_OTHER = { key: "other", label: "Other", icon: "as-box", card: "shield", color: "home" };

// Ordered [pattern, facet] fallbacks — first match wins, so more specific lines
// (commercial auto, E&O, umbrella) must precede their broader cousins.
const POLICY_LINE_FALLBACK = [
  [/flood/, { key: "flood", label: "Flood insurance", icon: "as-home", card: "flood", color: "boat" }],
  [/wind|hail/, { key: "windstorm", label: "Windstorm insurance", icon: "as-home", card: "umbrella", color: "home" }],
  [/errors|omission|\be&o\b|professional liab/, { key: "eo", label: "Errors & omissions (E&O)", icon: "as-shield", card: "general-liability", color: "cp" }],
  [/worker|comp\b/, { key: "workers", label: "Workers' comp", icon: "as-commercial", card: "general-liability", color: "cp" }],
  [/umbrella/, { key: "umbrella", label: "Umbrella insurance", icon: "as-shield", card: "umbrella", color: "cp" }],
  [/liability/, { key: "liability", label: "Liability insurance", icon: "as-shield", card: "general-liability", color: "cp" }],
  [/renter/, { key: "renters", label: "Renters insurance", icon: "as-home", card: "home", color: "home" }],
  [/condo/, { key: "condo", label: "Condo insurance", icon: "as-home", card: "home", color: "home" }],
  [/commercial auto/, { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck", card: "commercial-auto", color: "auto" }],
  [/\bauto\b|vehicle|motor/, { key: "auto", label: "Auto insurance", icon: "as-auto", card: "auto", color: "auto" }],
  [/watercraft|boat|marine|yacht/, { key: "watercraft", label: "Watercraft insurance", icon: "as-boat", card: "boat", color: "boat" }],
  [/jewel|scheduled|valuab|fine art|collect/, { key: "valuables", label: "Valuables insurance", icon: "as-gem", card: "gem", color: "gem" }],
  [/business|\bbop\b|commercial|general/, { key: "business", label: "Business insurance", icon: "as-commercial", card: "general-liability", color: "cp" }],
  [/home|dwelling|hazard|property/, { key: "home", label: "Home insurance", icon: "as-home", card: "home", color: "home" }],
];

// The full presentation facet for a policy (or a bare line string). Used by the
// adapter to set the card icon + tile colour.
export function policyPresentation(policyOrLine) {
  const line = typeof policyOrLine === "string" ? policyOrLine : (policyOrLine && policyOrLine.line ? policyOrLine.line : "");
  if (POLICY_LINE[line]) return POLICY_LINE[line];
  const s = line.toLowerCase();
  for (const [pattern, facet] of POLICY_LINE_FALLBACK) if (pattern.test(s)) return facet;
  return POLICY_LINE_OTHER;
}

// The specific coverage type + the table's leading detailed icon.
export function policyType(policy) {
  const f = policyPresentation(policy);
  return { key: f.key, label: f.label, icon: f.icon };
}

// Annual premium as a number. Prefers the numeric source of truth
// (premiumAmount + premiumPeriod); falls back to parsing the legacy `premium`
// text ("$2,260 / yr") for any row not yet migrated. Monthly is annualised (×12).
export function annualPremium(policy) {
  if (policy == null) return null;
  if (policy.premiumAmount != null && isFinite(policy.premiumAmount)) {
    const amt = Math.round(policy.premiumAmount);
    return /mo|month/i.test(policy.premiumPeriod || "") ? amt * 12 : amt;
  }
  const raw = policy.premium;
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) ? Math.round(raw) : null;
  const m = String(raw).replace(/,/g, "").match(/-?[\d.]+/);
  if (!m) return null;
  const amt = parseFloat(m[0]);
  if (!isFinite(amt)) return null;
  return Math.round(/\/\s*mo|month/i.test(raw) ? amt * 12 : amt);
}

// Display string for a premium ("$2,260 / yr"), formatted from the numeric
// source when present, else the legacy text, else "—".
export function formatPremium(policy) {
  if (policy && policy.premiumAmount != null && isFinite(policy.premiumAmount)) {
    return `$${Math.round(policy.premiumAmount).toLocaleString("en-US")} / ${policy.premiumPeriod || "yr"}`;
  }
  return (policy && policy.premium) || "—";
}

// Which reminders have already fired and which is next, for a given lead-time
// schedule (default 60/30/14/7/1 days before renewal).
export function reminderInfo(renewalInDays, schedule = REMINDER_SCHEDULE) {
  const sent = schedule.filter((d) => d > renewalInDays).sort((a, b) => b - a);
  const upcoming = schedule.filter((d) => d <= renewalInDays).sort((a, b) => b - a);
  return { sent, next: upcoming.length ? upcoming[0] : null };
}
