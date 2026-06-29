// keep/ownership.js — pure helpers for entity ownership stakes.
// An ownership row is { ownerId, role, pct } where pct is a string/number
// percentage (or blank for "no stake", e.g. a trustee). No DOM; unit-tested.

export const OWNERSHIP_ROLES = ["Owner", "Managing member", "Member", "Trustee", "Beneficiary"];

// Parse a percentage input. "" / null → null (no stake); a number → that number;
// anything non-numeric → NaN (invalid).
export function parsePct(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/%$/, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Sum of the valid numeric stakes (blanks/invalid count as 0).
export function totalStake(rows) {
  return rows.reduce((t, r) => {
    const n = parsePct(r.pct);
    return t + (Number.isFinite(n) ? n : 0);
  }, 0);
}

// Validate the ownership rows before saving. Ownership is optional (no rows is
// fine); each row needs an owner; stakes are 1–100 and can't total over 100.
export function validateOwnership(rows) {
  if (!rows.length) return { ok: true };
  for (const r of rows) {
    if (!r.ownerId) return { ok: false, error: "Pick an owner for each ownership row." };
    const n = parsePct(r.pct);
    if (Number.isNaN(n)) return { ok: false, error: "Enter a valid percentage (or leave it blank)." };
    if (n != null && (n < 1 || n > 100)) return { ok: false, error: "Each stake must be between 1% and 100%." };
  }
  const total = totalStake(rows);
  if (total > 100) return { ok: false, error: `Total stake is ${total}% — it can't exceed 100%.` };
  return { ok: true };
}

// Format a parsed stake back to a "NN%" string for storage, or null.
export function stakeLabel(pct) {
  const n = parsePct(pct);
  return (n != null && !Number.isNaN(n)) ? `${n}%` : null;
}
