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

// Which reminders have already fired and which is next, for a given lead-time
// schedule (default 60/30/14/7/1 days before renewal).
export function reminderInfo(renewalInDays, schedule = REMINDER_SCHEDULE) {
  const sent = schedule.filter((d) => d > renewalInDays).sort((a, b) => b - a);
  const upcoming = schedule.filter((d) => d <= renewalInDays).sort((a, b) => b - a);
  return { sent, next: upcoming.length ? upcoming[0] : null };
}
