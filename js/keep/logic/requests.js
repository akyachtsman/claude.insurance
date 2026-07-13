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

// The request lifecycle as an ordered pipeline the client can track. `wait`
// is the plain-language "what's happening now" line shown to the client.
export const REQUEST_STAGES = [
  { key: "requested",     track: "Submitted",     wait: "Waiting for your broker to review" },
  { key: "broker_review", track: "Broker review", wait: "Your broker is reviewing your request" },
  { key: "underwriting",  track: "Underwriting",  wait: "Submitted to the underwriter for approval" },
  { key: "approved",      track: "Approved",      wait: "Approved — your broker will follow up" },
];

// Stage position for the progress tracker. `declined` is terminal and off-track.
export function stageInfo(status) {
  if (status === "declined") {
    return { key: "declined", step: 0, total: REQUEST_STAGES.length, track: "Declined", wait: "This request was declined — talk to your broker", terminal: true, declined: true };
  }
  const idx = REQUEST_STAGES.findIndex((s) => s.key === status);
  const i = idx < 0 ? 0 : idx;
  const s = REQUEST_STAGES[i];
  return { key: s.key, step: i + 1, total: REQUEST_STAGES.length, track: s.track, wait: s.wait, terminal: s.key === "approved", declined: false };
}

// A request is still in flight (not approved or declined) → shows on the
// landing "Request status" window.
export function isPending(status) {
  return status !== "approved" && status !== "declined";
}

// The next stage a broker can advance a request to (null at/after underwriting).
export function nextStage(status) {
  const i = REQUEST_STAGES.findIndex((s) => s.key === status);
  if (i < 0 || i >= REQUEST_STAGES.length - 1) return null; // unknown, or already approved
  return REQUEST_STAGES[i + 1].key;
}

// Status → pill treatment for the requests list.
const STATUS = {
  requested:     { label: "Submitted", cls: "k-pill--rec", icon: "spark" },
  broker_review: { label: "Broker review", cls: "k-pill--rec", icon: "user" },
  underwriting:  { label: "Underwriting", cls: "k-pill--rec", icon: "clipboard" },
  approved:      { label: "Approved", cls: "k-pill--ok", icon: "check" },
  declined:      { label: "Declined", cls: "k-pill--gap", icon: "x" },
};
export function statusDisplay(status) {
  return STATUS[status] || STATUS.requested;
}

// A sensible default subject when the client starts from a specific policy.
export function defaultSubject(policyLine) {
  return policyLine ? `Enhance ${policyLine}` : "Policy enhancement request";
}
