// policies.test.mjs — unit tests for policy expiry + reminder helpers.
// Run: node --test js/keep/policies.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { policyKind, reminderInfo } from "./policies.js";
import { findPolicy } from "./data.js";

test("policyKind classifies active / expiring / expired", () => {
  assert.equal(policyKind(263), "ok");
  assert.equal(policyKind(30), "warn");
  assert.equal(policyKind(12), "warn");
  assert.equal(policyKind(0), "exp");  // due today counts as expired
  assert.equal(policyKind(-1), "exp");
});

test("reminderInfo reports sent reminders and the next one", () => {
  const r = reminderInfo(12); // 60/30/14 have passed; next is 7
  assert.deepEqual(r.sent, [60, 30, 14]);
  assert.equal(r.next, 7);
});

test("reminderInfo: nothing sent yet far from renewal", () => {
  const r = reminderInfo(263);
  assert.deepEqual(r.sent, []);
  assert.equal(r.next, 60);
});

test("reminderInfo: expired policy has no next reminder", () => {
  const r = reminderInfo(-23);
  assert.equal(r.next, null);
  assert.deepEqual(r.sent, [60, 30, 14, 7, 1]);
});

test("sample policies are reachable and carry standard fields", () => {
  const { policy } = findPolicy("ho3-marina");
  assert.equal(policy.carrier, "Gulfstream P&C");
  assert.ok(policy.coverages.length >= 6, "has Coverage A–F");
  assert.ok(policy.coverages.some((c) => c.recommended), "flags an underinsured limit");
  assert.equal(policyKind(policy.renewalInDays), "ok");
  assert.equal(policyKind(findPolicy("flood-marina").policy.renewalInDays), "warn");
  assert.equal(policyKind(findPolicy("wind-marina").policy.renewalInDays), "exp");
});
