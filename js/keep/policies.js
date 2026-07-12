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

// Name a policy's specific coverage type (e.g. "Flood insurance", "Home
// insurance", "Liability insurance") plus the detailed frame-less icon used in
// the Policies table's leading column. Keyed on the canonical policy line, with
// ordered keyword fallbacks (most specific first) so a new line still lands on
// a sensible, specific type rather than a broad bucket.
const POLICY_LINE_TYPE = {
  "Homeowners (HO-3)": { key: "home", label: "Home insurance", icon: "as-home" },
  "Windstorm": { key: "windstorm", label: "Windstorm insurance", icon: "as-home" },
  "Flood (NFIP)": { key: "flood", label: "Flood insurance", icon: "as-home" },
  "Dwelling": { key: "dwelling", label: "Dwelling insurance", icon: "as-home" },
  "Personal auto": { key: "auto", label: "Auto insurance", icon: "as-auto" },
  "Commercial auto": { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck" },
  "Watercraft": { key: "watercraft", label: "Watercraft insurance", icon: "as-boat" },
  "Scheduled personal property": { key: "valuables", label: "Valuables insurance", icon: "as-gem" },
  "Business owner's policy (BOP)": { key: "business", label: "Business insurance", icon: "as-commercial" },
  "General liability": { key: "liability", label: "Liability insurance", icon: "as-shield" },
  "Umbrella": { key: "umbrella", label: "Umbrella insurance", icon: "as-shield" },
};
const POLICY_TYPE_OTHER = { key: "other", label: "Other", icon: "as-box" };

// Ordered [pattern, type] fallbacks — first match wins, so more specific lines
// (commercial auto, E&O, umbrella) must precede their broader cousins.
const POLICY_TYPE_FALLBACK = [
  [/flood/, { key: "flood", label: "Flood insurance", icon: "as-home" }],
  [/wind|hail/, { key: "windstorm", label: "Windstorm insurance", icon: "as-home" }],
  [/errors|omission|\be&o\b|professional liab/, { key: "eo", label: "Errors & omissions (E&O)", icon: "as-shield" }],
  [/worker|comp\b/, { key: "workers", label: "Workers' comp", icon: "as-commercial" }],
  [/umbrella/, { key: "umbrella", label: "Umbrella insurance", icon: "as-shield" }],
  [/liability/, { key: "liability", label: "Liability insurance", icon: "as-shield" }],
  [/renter/, { key: "renters", label: "Renters insurance", icon: "as-home" }],
  [/condo/, { key: "condo", label: "Condo insurance", icon: "as-home" }],
  [/commercial auto/, { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck" }],
  [/\bauto\b|vehicle|motor/, { key: "auto", label: "Auto insurance", icon: "as-auto" }],
  [/watercraft|boat|marine|yacht/, { key: "watercraft", label: "Watercraft insurance", icon: "as-boat" }],
  [/jewel|scheduled|valuab|fine art|collect/, { key: "valuables", label: "Valuables insurance", icon: "as-gem" }],
  [/business|\bbop\b|commercial|general/, { key: "business", label: "Business insurance", icon: "as-commercial" }],
  [/home|dwelling|hazard|property/, { key: "home", label: "Home insurance", icon: "as-home" }],
];

export function policyType(policy) {
  const line = policy && policy.line ? policy.line : "";
  if (POLICY_LINE_TYPE[line]) return POLICY_LINE_TYPE[line];
  const s = line.toLowerCase();
  for (const [pattern, type] of POLICY_TYPE_FALLBACK) if (pattern.test(s)) return type;
  return POLICY_TYPE_OTHER;
}

// Best-effort annual premium as a number, parsed from the policy's premium field
// (a preformatted string like "$2,260 / yr" or a raw number). Monthly premiums
// are annualised (×12). Returns null when nothing numeric can be read.
export function annualPremium(policy) {
  const raw = policy == null ? null : policy.premium;
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) ? Math.round(raw) : null;
  const m = String(raw).replace(/,/g, "").match(/-?[\d.]+/);
  if (!m) return null;
  const amt = parseFloat(m[0]);
  if (!isFinite(amt)) return null;
  return Math.round(/\/\s*mo|month/i.test(raw) ? amt * 12 : amt);
}

// Which reminders have already fired and which is next, for a given lead-time
// schedule (default 60/30/14/7/1 days before renewal).
export function reminderInfo(renewalInDays, schedule = REMINDER_SCHEDULE) {
  const sent = schedule.filter((d) => d > renewalInDays).sort((a, b) => b - a);
  const upcoming = schedule.filter((d) => d <= renewalInDays).sort((a, b) => b - a);
  return { sent, next: upcoming.length ? upcoming[0] : null };
}
