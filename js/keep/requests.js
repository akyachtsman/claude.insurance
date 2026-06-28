// keep/requests.js — pure helpers for policy enhancement requests.
// No DOM: validation + display mapping, unit-tested (requests.test.mjs).

export const SUBJECT_MAX = 200;
export const MESSAGE_MAX = 4000;

// Validate a request before it's sent. Returns { ok } or { ok:false, error }.
export function validateRequest({ subject, message } = {}) {
  const s = (subject || "").trim();
  const m = (message || "").trim();
  if (!s) return { ok: false, error: "Add a short subject for your request." };
  if (s.length > SUBJECT_MAX) return { ok: false, error: `Keep the subject under ${SUBJECT_MAX} characters.` };
  if (!m) return { ok: false, error: "Describe the change you'd like." };
  if (m.length > MESSAGE_MAX) return { ok: false, error: `Keep the details under ${MESSAGE_MAX} characters.` };
  return { ok: true };
}

// Status → display treatment for the requests list.
const STATUS = {
  requested: { label: "Awaiting approval", cls: "k-pill--rec", icon: "spark" },
  approved:  { label: "Approved", cls: "k-pill--ok", icon: "check" },
  declined:  { label: "Declined", cls: "k-pill--gap", icon: "x" },
};
export function statusDisplay(status) {
  return STATUS[status] || STATUS.requested;
}

// A sensible default subject when the client starts from a specific policy.
export function defaultSubject(policyLine) {
  return policyLine ? `Enhance ${policyLine}` : "Policy enhancement request";
}
