// node --test js/keep/logic/ownership.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePct, totalStake, validateOwnership, stakeLabel, OWNERSHIP_ROLES } from "./ownership.js";

test("parsePct: numbers, percents, blanks, junk", () => {
  assert.equal(parsePct("60"), 60);
  assert.equal(parsePct("60%"), 60);
  assert.equal(parsePct(" 40 "), 40);
  assert.equal(parsePct(""), null);
  assert.equal(parsePct("   "), null);
  assert.equal(parsePct(null), null);
  assert.ok(Number.isNaN(parsePct("abc")));
});

test("totalStake: sums valid, ignores blanks", () => {
  assert.equal(totalStake([{ pct: "50" }, { pct: "40" }, { pct: "" }]), 90);
  assert.equal(totalStake([{ pct: "60%" }, { pct: null }]), 60);
});

test("validateOwnership: empty is allowed", () => {
  assert.deepEqual(validateOwnership([]), { ok: true });
});

test("validateOwnership: each row needs an owner", () => {
  const r = validateOwnership([{ ownerId: "", role: "Owner", pct: "50" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /owner/i);
});

test("validateOwnership: rejects out-of-range stakes", () => {
  assert.equal(validateOwnership([{ ownerId: "a", pct: "0" }]).ok, false);
  assert.equal(validateOwnership([{ ownerId: "a", pct: "150" }]).ok, false);
  assert.equal(validateOwnership([{ ownerId: "a", pct: "abc" }]).ok, false);
});

test("validateOwnership: rejects totals over 100", () => {
  const r = validateOwnership([{ ownerId: "a", pct: "60" }, { ownerId: "b", pct: "60" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /exceed 100/);
});

test("validateOwnership: accepts a valid split and partial ownership", () => {
  assert.deepEqual(validateOwnership([{ ownerId: "a", pct: "60" }, { ownerId: "b", pct: "40" }]), { ok: true });
  assert.deepEqual(validateOwnership([{ ownerId: "a", pct: "30" }]), { ok: true });
});

test("validateOwnership: allows a row with no stake (e.g. trustee)", () => {
  assert.deepEqual(validateOwnership([{ ownerId: "a", role: "Trustee", pct: "" }]), { ok: true });
});

test("stakeLabel: formats or nulls", () => {
  assert.equal(stakeLabel("60"), "60%");
  assert.equal(stakeLabel(""), null);
  assert.equal(stakeLabel("abc"), null);
});

test("roles list is non-empty and includes Owner", () => {
  assert.ok(OWNERSHIP_ROLES.includes("Owner"));
});

// ── Regression: duplicate owner rows (audit 2026-10-05) ────────────────────
// Only the 100% total was checked, so two rows naming one owner validated and
// both inserted — entity_relationships has no unique (from,to) constraint.
test("validateOwnership rejects the same owner listed twice", () => {
  const r = validateOwnership([{ ownerId: "X", pct: "50" }, { ownerId: "X", pct: "50" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /already listed/);
});

test("validateOwnership still accepts distinct owners totalling 100", () => {
  assert.deepEqual(validateOwnership([{ ownerId: "X", pct: "50" }, { ownerId: "Y", pct: "50" }]), { ok: true });
});
