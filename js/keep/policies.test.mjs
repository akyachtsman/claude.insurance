// policies.test.mjs — unit tests for policy expiry + reminder helpers.
// Run: node --test js/keep/policies.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { policyKind, reminderInfo, renewalBand, policyType, annualPremium } from "./policies.js";
import { findPolicy } from "./data.js";

test("policyKind classifies active / expiring / expired", () => {
  assert.equal(policyKind(263), "ok");
  assert.equal(policyKind(30), "warn");
  assert.equal(policyKind(12), "warn");
  assert.equal(policyKind(0), "exp");  // due today counts as expired
  assert.equal(policyKind(-1), "exp");
});

test("renewalBand escalates as the renewal nears, null beyond 60 days", () => {
  assert.equal(renewalBand(-5), "lapsed");
  assert.equal(renewalBand(0), "urgent");
  assert.equal(renewalBand(3), "urgent");
  assert.equal(renewalBand(7), "week");
  assert.equal(renewalBand(20), "soon");
  assert.equal(renewalBand(30), "soon");
  assert.equal(renewalBand(45), "upcoming");
  assert.equal(renewalBand(60), "upcoming");
  assert.equal(renewalBand(90), null);
  assert.equal(renewalBand(null), null);
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

test("policyType maps known lines to a category + detailed icon", () => {
  assert.deepEqual(policyType({ line: "Windstorm" }), { key: "property", label: "Property", icon: "as-home" });
  assert.deepEqual(policyType({ line: "Flood (NFIP)" }), { key: "property", label: "Property", icon: "as-home" });
  assert.deepEqual(policyType({ line: "Personal auto" }), { key: "vehicle", label: "Vehicle", icon: "as-auto" });
  assert.deepEqual(policyType({ line: "Commercial auto" }), { key: "vehicle", label: "Vehicle", icon: "as-truck" });
  assert.deepEqual(policyType({ line: "Watercraft" }), { key: "watercraft", label: "Watercraft", icon: "as-boat" });
  assert.deepEqual(policyType({ line: "Scheduled personal property" }), { key: "valuables", label: "Valuables", icon: "as-gem" });
  assert.deepEqual(policyType({ line: "Business owner's policy (BOP)" }), { key: "business", label: "Business", icon: "as-commercial" });
  assert.deepEqual(policyType({ line: "General liability" }), { key: "liability", label: "Liability", icon: "as-shield" });
});

test("policyType falls back by keyword, then to Other", () => {
  assert.equal(policyType({ line: "Personal umbrella policy" }).label, "Liability");
  assert.equal(policyType({ line: "Motorcycle physical damage" }).label, "Vehicle");
  assert.equal(policyType({ line: "Renters (HO-4)" }).label, "Property");
  assert.equal(policyType({ line: "Yacht hull" }).label, "Watercraft");
  assert.deepEqual(policyType({ line: "Something unheard of" }), { key: "other", label: "Other", icon: "as-box" });
  assert.equal(policyType({}).label, "Other");
});

test("annualPremium parses strings, annualises monthly, handles missing", () => {
  assert.equal(annualPremium({ premium: "$2,260 / yr" }), 2260);
  assert.equal(annualPremium({ premium: "$1,180 / yr" }), 1180);
  assert.equal(annualPremium({ premium: "$150 / mo" }), 1800);   // ×12
  assert.equal(annualPremium({ premium: 4260 }), 4260);
  assert.equal(annualPremium({ premium: null }), null);
  assert.equal(annualPremium({}), null);
  assert.equal(annualPremium({ premium: "—" }), null);
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
