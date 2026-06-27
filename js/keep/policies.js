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

// Which reminders have already fired and which is next, for a given lead-time
// schedule (default 60/30/14/7/1 days before renewal).
export function reminderInfo(renewalInDays, schedule = REMINDER_SCHEDULE) {
  const sent = schedule.filter((d) => d > renewalInDays).sort((a, b) => b - a);
  const upcoming = schedule.filter((d) => d <= renewalInDays).sort((a, b) => b - a);
  return { sent, next: upcoming.length ? upcoming[0] : null };
}
