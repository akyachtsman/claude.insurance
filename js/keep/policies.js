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

// Categorise a policy into a human "type" (Property / Vehicle / Watercraft /
// Valuables / Business / Liability / Other) plus the detailed frame-less icon
// used in the Policies table's leading column. Keyed on the canonical policy
// line, with keyword fallbacks so a new line still lands in a sensible bucket.
const POLICY_LINE_TYPE = {
  "Homeowners (HO-3)": { key: "property", label: "Property", icon: "as-home" },
  "Windstorm": { key: "property", label: "Property", icon: "as-home" },
  "Flood (NFIP)": { key: "property", label: "Property", icon: "as-home" },
  "Dwelling": { key: "property", label: "Property", icon: "as-home" },
  "Personal auto": { key: "vehicle", label: "Vehicle", icon: "as-auto" },
  "Commercial auto": { key: "vehicle", label: "Vehicle", icon: "as-truck" },
  "Watercraft": { key: "watercraft", label: "Watercraft", icon: "as-boat" },
  "Scheduled personal property": { key: "valuables", label: "Valuables", icon: "as-gem" },
  "Business owner's policy (BOP)": { key: "business", label: "Business", icon: "as-commercial" },
  "General liability": { key: "liability", label: "Liability", icon: "as-shield" },
  "Umbrella": { key: "liability", label: "Liability", icon: "as-shield" },
};
const POLICY_TYPE_OTHER = { key: "other", label: "Other", icon: "as-box" };

export function policyType(policy) {
  const line = policy && policy.line ? policy.line : "";
  if (POLICY_LINE_TYPE[line]) return POLICY_LINE_TYPE[line];
  const s = line.toLowerCase();
  if (/umbrella|liability/.test(s)) return { key: "liability", label: "Liability", icon: "as-shield" };
  if (/\bauto\b|vehicle|motor/.test(s)) return { key: "vehicle", label: "Vehicle", icon: "as-auto" };
  if (/watercraft|boat|marine|yacht/.test(s)) return { key: "watercraft", label: "Watercraft", icon: "as-boat" };
  if (/jewel|scheduled|valuab|fine art|collect/.test(s)) return { key: "valuables", label: "Valuables", icon: "as-gem" };
  if (/business|bop|commercial|general/.test(s)) return { key: "business", label: "Business", icon: "as-commercial" };
  if (/home|dwelling|flood|wind|property|hazard|renters|condo/.test(s)) return { key: "property", label: "Property", icon: "as-home" };
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
