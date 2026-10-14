// policies.test.mjs — unit tests for policy expiry + reminder helpers.
// Run: node --test js/keep/logic/policies.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { policyKind, reminderInfo, renewalBand, renewalCounts, policyType, annualPremium, policyPresentation, formatPremium, statusIsAffirmative, statusText } from "./policies.js";

// A policy that is in force apart from whatever the test overrides. policyKind
// takes the POLICY now, not a number, so every case has to name the status it
// means — which is the point: a bare renewalInDays can no longer be mistaken
// for a complete answer to "is this in force?".
const pol = (over) => ({ status: "active", effectiveInDays: -100, renewalInDays: 200, ...over });
import { findPolicy } from "../fixtures/sample.mjs";

test("policyKind classifies active / expiring / expired", () => {
  assert.equal(policyKind(pol({ renewalInDays: 263 })), "ok");
  assert.equal(policyKind(pol({ renewalInDays: 30 })), "warn");
  assert.equal(policyKind(pol({ renewalInDays: 12 })), "warn");
  assert.equal(policyKind(pol({ renewalInDays: 0 })), "exp");  // due today counts as expired
  assert.equal(policyKind(pol({ renewalInDays: -1 })), "exp");
});

// ── Regression: a CANCELLED policy read "Active" (found 2026-10-14) ─────────
// `policies.status` was selected by the adapter, carried on every policy object,
// and read by NO view — so the badge could only see the renewal date. A policy
// cancelled last week with a renewal date next year rendered
// "Active · renews <date>", which is the worst thing this app can say about
// someone's cover. The rule below is help-ask's prompt rule, not a new one: the
// desk had been getting this right since 2026-10-09 while the UI did not.
test("policyKind: a non-affirmative status beats a future renewal date", () => {
  assert.equal(policyKind(pol({ status: "cancelled", renewalInDays: 365 })), "ended");
  assert.equal(policyKind(pol({ status: "lapsed", renewalInDays: 365 })), "ended");
  // ...and beats a MISSING renewal date, so the cancellation is reported rather
  // than the absent date. That is why the status test comes first in the body.
  assert.equal(policyKind(pol({ status: "void", renewalInDays: null })), "ended");
});

test("policyKind: absent status is reported, never guessed from the dates", () => {
  // The column is nullable with no default and no CHECK (measured 2026-10-14),
  // so this is a real row, not a defensive branch. Falling through to the dates
  // here is exactly the defect: a cancelled policy whose status nobody recorded
  // would read as active.
  assert.equal(policyKind(pol({ status: null, renewalInDays: 365 })), "nostatus");
  assert.equal(policyKind(pol({ status: undefined })), "nostatus");
  assert.equal(policyKind(pol({ status: "   " })), "nostatus");
  assert.equal(policyKind({}), "nostatus");
  assert.equal(policyKind(null), "nostatus");   // no policy at all is not "active"
});

test("policyKind: cover that has not started is not in force", () => {
  assert.equal(policyKind(pol({ effectiveInDays: 10 })), "pending");
  assert.equal(policyKind(pol({ effectiveInDays: 0 })), "ok");    // starts today = started
  assert.equal(policyKind(pol({ effectiveInDays: null })), "ok"); // unrecorded start is not "pending"
});

test("statusIsAffirmative forgives case and padding, nothing else", () => {
  assert.equal(statusIsAffirmative("active"), true);
  assert.equal(statusIsAffirmative("  ACTIVE "), true);
  assert.equal(statusIsAffirmative("Active"), true);
  // Not an allow-list of guesses: these are plausible values this project has
  // never seen, and treating one as in force would be inventing a vocabulary.
  assert.equal(statusIsAffirmative("in force"), false);
  assert.equal(statusIsAffirmative("bound"), false);
  assert.equal(statusIsAffirmative("cancelled"), false);
  assert.equal(statusIsAffirmative(null), false);
  assert.equal(statusIsAffirmative(""), false);
});

test("statusText shows the record's own word, only capitalised", () => {
  assert.equal(statusText("cancelled"), "Cancelled");
  assert.equal(statusText("  non-renewed "), "Non-renewed");
  // NOT rounded to a friendlier word: the broker owns this vocabulary and there
  // is no CHECK constraint on the column.
  assert.equal(statusText("pending-cancel"), "Pending-cancel");
  assert.equal(statusText(null), "");
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

test("policyType names the specific coverage per known line + detailed icon", () => {
  assert.deepEqual(policyType({ line: "Homeowners (HO-3)" }), { key: "home", label: "Home insurance", icon: "as-home" });
  assert.deepEqual(policyType({ line: "Windstorm" }), { key: "windstorm", label: "Windstorm insurance", icon: "as-home" });
  assert.deepEqual(policyType({ line: "Flood (NFIP)" }), { key: "flood", label: "Flood insurance", icon: "as-home" });
  assert.deepEqual(policyType({ line: "Personal auto" }), { key: "auto", label: "Auto insurance", icon: "as-auto" });
  assert.deepEqual(policyType({ line: "Commercial auto" }), { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck" });
  assert.deepEqual(policyType({ line: "Watercraft" }), { key: "watercraft", label: "Watercraft insurance", icon: "as-boat" });
  assert.deepEqual(policyType({ line: "Scheduled personal property" }), { key: "valuables", label: "Valuables insurance", icon: "as-gem" });
  assert.deepEqual(policyType({ line: "Business owner's policy (BOP)" }), { key: "business", label: "Business insurance", icon: "as-commercial" });
  assert.deepEqual(policyType({ line: "General liability" }), { key: "liability", label: "Liability insurance", icon: "as-shield" });
});

test("policyType falls back to a specific type by keyword (specific wins), then Other", () => {
  assert.equal(policyType({ line: "Personal umbrella policy" }).label, "Umbrella insurance");
  assert.equal(policyType({ line: "Errors & omissions" }).label, "Errors & omissions (E&O)");
  assert.equal(policyType({ line: "Professional liability" }).label, "Errors & omissions (E&O)"); // E&O beats generic liability
  assert.equal(policyType({ line: "Workers' compensation" }).label, "Workers' comp");
  assert.equal(policyType({ line: "Commercial auto — fleet" }).label, "Commercial auto insurance"); // beats plain auto
  assert.equal(policyType({ line: "Motorcycle physical damage" }).label, "Auto insurance");
  assert.equal(policyType({ line: "Renters (HO-4)" }).label, "Renters insurance");
  assert.equal(policyType({ line: "Yacht hull" }).label, "Watercraft insurance");
  assert.deepEqual(policyType({ line: "Something unheard of" }), { key: "other", label: "Other", icon: "as-box" });
  assert.equal(policyType({}).label, "Other");
});

test("policyPresentation is the single source: policyType projects from it", () => {
  // Card icon + tile colour (used by the adapter) come from the same facet as
  // the table's type label + detailed icon — they can't drift.
  const wind = policyPresentation({ line: "Windstorm" });
  assert.equal(wind.card, "umbrella");   // detail-card glyph
  assert.equal(wind.color, "home");      // cic tile colour
  assert.equal(wind.icon, "as-home");    // table leading icon
  // policyType is a projection of the same facet.
  assert.deepEqual(policyType({ line: "Windstorm" }), { key: wind.key, label: wind.label, icon: wind.icon });
  // Unknown lines fall back to the shield/home default (matches the old adapter).
  const other = policyPresentation({ line: "Something unheard of" });
  assert.equal(other.card, "shield");
  assert.equal(other.color, "home");
});

test("annualPremium prefers the numeric source, annualises monthly", () => {
  // Numeric columns are the source of truth.
  assert.equal(annualPremium({ premiumAmount: 2260, premiumPeriod: "yr" }), 2260);
  assert.equal(annualPremium({ premiumAmount: 150, premiumPeriod: "mo" }), 1800); // ×12
  // Falls back to parsing the legacy text when no numeric is present.
  assert.equal(annualPremium({ premium: "$1,180 / yr" }), 1180);
  assert.equal(annualPremium({ premium: "$150 / mo" }), 1800);
  assert.equal(annualPremium({ premium: 4260 }), 4260);
  assert.equal(annualPremium({ premium: null }), null);
  assert.equal(annualPremium({}), null);
  assert.equal(annualPremium({ premium: "—" }), null);
});

test("formatPremium renders from the numeric source, else the text", () => {
  assert.equal(formatPremium({ premiumAmount: 2260, premiumPeriod: "yr" }), "$2,260 / yr");
  assert.equal(formatPremium({ premiumAmount: 410, premiumPeriod: "yr" }), "$410 / yr");
  assert.equal(formatPremium({ premiumAmount: 150, premiumPeriod: "mo" }), "$150 / mo");
  assert.equal(formatPremium({ premium: "$1,180 / yr" }), "$1,180 / yr"); // legacy fallback
  assert.equal(formatPremium({}), "—");
});

test("sample policies are reachable and carry standard fields", () => {
  const { policy } = findPolicy("ho3-marina");
  assert.equal(policy.carrier, "Gulfstream P&C");
  assert.ok(policy.coverages.length >= 6, "has Coverage A–F");
  assert.ok(policy.coverages.some((c) => c.recommended), "flags an underinsured limit");
  // The fixture carries `status` because the live adapter does (js/supabase.js
  // emits it on every policy). It did not until 2026-10-14, which made the
  // fixture model a shape the app never produces — so these three would have
  // read "nostatus" against perfectly good data.
  assert.equal(policy.status, "active", "fixture must model the adapter's shape");
  assert.equal(policyKind(policy), "ok");
  assert.equal(policyKind(findPolicy("flood-marina").policy), "warn");
  assert.equal(policyKind(findPolicy("wind-marina").policy), "exp");
});

// ── Regression: unknown renewal date (audit 2026-10-05) ─────────────────────
// policies.renewal_date is nullable, so renewalInDays arrives as null. These
// are the cases a green 112-test suite missed: renewalBand(null) WAS tested,
// and it was the only one of the three with a guard.
test("policyKind reports an unknown renewal date as unknown, not expired", () => {
  assert.equal(policyKind(pol({ renewalInDays: null })), null);      // `null <= 0` is true — must not read "exp"
  assert.equal(policyKind(pol({ renewalInDays: undefined })), null); // the two unknowns must agree
  assert.equal(policyKind(pol({ renewalInDays: 0 })), "exp");        // due today is still expired
  assert.equal(policyKind(pol({ renewalInDays: 1 })), "warn");
});

test("reminderInfo reports nothing sent when the renewal date is unknown", () => {
  // `d > null` coerces to `d > 0`, which previously marked all five lead times
  // as already sent and none upcoming.
  assert.deepEqual(reminderInfo(null), { sent: [], next: null });
  assert.deepEqual(reminderInfo(undefined), { sent: [], next: null });
});

test("policyPresentation does not resolve inherited Object keys", () => {
  // `line` is free broker-written text; a bare map lookup returned Object's
  // own members as if they were presentation facets.
  // Assert the facet is WELL-FORMED, not that it is "other": "hasOwnProperty"
  // lowercases to contain "property", which legitimately matches the home
  // fallback. The defect was the bare lookup returning Object's constructor,
  // whose .key/.label/.icon are all undefined.
  for (const k of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const f = policyPresentation(k);
    assert.equal(typeof f.key, "string", `${k} must yield a real facet`);
    assert.equal(typeof f.label, "string", `${k} must yield a label`);
    assert.equal(typeof f.icon, "string", `${k} must yield an icon`);
  }
  assert.equal(policyPresentation("constructor").key, "other");
});

test("premium guards reject non-numeric amounts instead of coercing to 0", () => {
  // Global isFinite("") is true, so a blank numeric form field became $0 AND
  // suppressed the text fallback that held the real figure.
  assert.equal(annualPremium({ premiumAmount: "" , premium: "$3,420 / yr" }), 3420);
  assert.equal(formatPremium({ premiumAmount: "", premium: "$3,420 / yr" }), "$3,420 / yr");
  assert.equal(annualPremium({ premiumAmount: 2260, premiumPeriod: "yr" }), 2260);
});

// ── Regression: the summary counters and an UNKNOWN renewal date ───────────
// `policyKind(null) !== "exp"` is true, so the Policies page counted a policy
// with no renewal_date on file as "Active · in force" — a confident claim made
// from absent data — while the neighbouring "needs attention" counter already
// (correctly) excluded it. Four counters, two answers. (Codex P2, round 3.)
test("renewalCounts puts an undated policy in neither active nor attention", () => {
  const c = renewalCounts([null]);
  assert.deepEqual(c, { active: 0, attention: 0, undated: 1 },
    "an undated policy is neither provably in force nor provably urgent");
});

test("renewalCounts classifies each known state once", () => {
  //                 lapsed  due today  expiring soon  active   undated
  const days = [-40,    0,         12,            400,     null, undefined];
  const c = renewalCounts(days.map((d) => pol({ renewalInDays: d })));
  assert.equal(c.undated, 2, "null and undefined are both 'no date on file'");
  assert.equal(c.active, 2, "expiring soon (12d) is still in force, alongside 400d");
  assert.equal(c.attention, 3, "lapsed + due today + expiring soon");
});

test("renewalCounts: not-provably-in-force states land in `undated`, never `active`", () => {
  const c = renewalCounts([
    pol({ renewalInDays: 400 }),                         // ok
    pol({ status: "cancelled", renewalInDays: 400 }),    // ended
    pol({ status: null, renewalInDays: 400 }),           // nostatus
    pol({ effectiveInDays: 30, renewalInDays: 400 }),    // pending
    pol({ renewalInDays: null }),                        // no date
  ]);
  assert.equal(c.active, 1, "only the one provably-in-force policy counts as active");
  assert.equal(c.undated, 4, "cancelled / no-status / not-started / undated are all 'unclear'");
  assert.equal(c.attention, 0, "none of them is a renewal deadline");
});

test("renewalCounts given bare numbers fails LOUDLY, not silently", () => {
  // The signature changed from a list of days to a list of policies. A caller
  // that was not updated now reports every row as `undated` — visibly wrong on
  // screen — rather than quietly producing a plausible count from `.status`
  // being undefined on a Number. Pinned so the failure mode stays the loud one.
  const c = renewalCounts([400, 12, -40]);
  assert.deepEqual(c, { active: 0, attention: 0, undated: 3 });
});

test("renewalCounts never counts more rows than it was given", () => {
  // active + attention double-counts "warn" by design (expiring soon is both
  // in force and urgent), but neither bucket alone may exceed the dated rows.
  const days = [-5, 0, 3, 29, 30, 31, 900, null];
  const c = renewalCounts(days.map((d) => pol({ renewalInDays: d })));
  const dated = days.length - c.undated;
  assert.ok(c.active <= dated, `active ${c.active} > dated ${dated}`);
  assert.ok(c.attention <= dated, `attention ${c.attention} > dated ${dated}`);
  assert.equal(c.active + c.attention - days.filter((d) => d > 0 && d <= 30).length, dated,
    "every dated row lands in exactly one of active/attention, bar the warn overlap");
});

test("renewalCounts tolerates an empty or absent list", () => {
  assert.deepEqual(renewalCounts([]), { active: 0, attention: 0, undated: 0 });
  assert.deepEqual(renewalCounts(), { active: 0, attention: 0, undated: 0 });
});
