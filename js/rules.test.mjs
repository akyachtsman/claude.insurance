// rules.test.mjs — unit tests for the needs/gap engine.
// Run with the built-in Node test runner (no dependencies): `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNeeds } from "./rules.js";
import { SETTINGS } from "./test-settings.mjs";

const ids = (needs) => needs.map((n) => n.id);

test("residential owner with high value and two vehicles -> home, auto, umbrella", () => {
  const needs = computeNeeds({
    domain: "residential",
    answers: {
      home_status: { value: "own" },
      home_value: { value: "over_750k", amount: 1000000 },
      vehicle_count: { value: "2", amount: 2 },
    },
  }, SETTINGS);
  assert.deepEqual(ids(needs), ["home", "auto", "umbrella"]);
  assert.equal(needs[0].priority, "high");
  assert.equal(needs[2].priority, "medium");
});

test("renter with no car and low value -> renters only", () => {
  const needs = computeNeeds({
    domain: "residential",
    answers: {
      home_status: { value: "rent" },
      home_value: { value: "under_250k", amount: 200000 },
      vehicle_count: { value: "0", amount: 0 },
    },
  }, SETTINGS);
  assert.deepEqual(ids(needs), ["renters"]);
});

test("dependents trigger life insurance (high priority)", () => {
  const needs = computeNeeds({
    domain: "residential",
    answers: {
      home_status: { value: "own" },
      home_value: { value: "under_250k", amount: 200000 },
      vehicle_count: { value: "0", amount: 0 },
      dependents: { value: "yes" },
    },
  }, SETTINGS);
  const life = needs.find((n) => n.id === "life");
  assert.ok(life, "expected a life insurance need");
  assert.equal(life.priority, "high");
});

test("flood risk: yes -> high, unsure -> medium, no -> none", () => {
  const base = {
    home_status: { value: "own" },
    home_value: { value: "under_250k", amount: 200000 },
    vehicle_count: { value: "0", amount: 0 },
  };
  const yes = computeNeeds({ domain: "residential", answers: { ...base, flood_risk: { value: "yes" } } }, SETTINGS);
  const unsure = computeNeeds({ domain: "residential", answers: { ...base, flood_risk: { value: "unsure" } } }, SETTINGS);
  const no = computeNeeds({ domain: "residential", answers: { ...base, flood_risk: { value: "no" } } }, SETTINGS);
  assert.equal(yes.find((n) => n.id === "flood")?.priority, "high");
  assert.equal(unsure.find((n) => n.id === "flood")?.priority, "medium");
  assert.equal(no.find((n) => n.id === "flood"), undefined);
});

test("umbrella triggers on vehicle count even when value is low", () => {
  const needs = computeNeeds({
    domain: "residential",
    answers: {
      home_status: { value: "own" },
      home_value: { value: "under_250k", amount: 200000 },
      vehicle_count: { value: "3plus", amount: 3 },
    },
  }, SETTINGS);
  assert.ok(ids(needs).includes("umbrella"));
});

test("commercial professional services, full profile -> all relevant needs, high first", () => {
  const needs = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "technology", professional: true },
      employee_count: { value: "6_20", amount: 12 },
      revenue: { value: "over_2m", amount: 3000000 },
      has_premises: { value: "yes" },
      company_vehicles: { value: "yes" },
    },
  }, SETTINGS);
  const got = ids(needs);
  assert.ok(got.includes("general-liability"));
  assert.ok(got.includes("bop"));
  assert.ok(got.includes("workers-comp"));
  assert.ok(got.includes("professional-liability"));
  assert.ok(got.includes("commercial-auto"));
  assert.ok(got.includes("commercial-umbrella"));
  // High-priority needs must all precede medium-priority ones.
  const firstMedium = needs.findIndex((n) => n.priority === "medium");
  const lastHigh = needs.map((n) => n.priority).lastIndexOf("high");
  assert.ok(lastHigh < firstMedium);
});

test("commercial solo, remote, low revenue, no vehicles, no data -> general liability only", () => {
  const needs = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "retail" },
      employee_count: { value: "0", amount: 0 },
      revenue: { value: "under_250k", amount: 150000 },
      has_premises: { value: "no" },
      owns_property: { value: "no" },
      company_vehicles: { value: "no" },
      handles_data: { value: "no" },
    },
  }, SETTINGS);
  assert.deepEqual(ids(needs), ["general-liability"]);
});

test("handling customer data triggers cyber liability (high)", () => {
  const needs = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "retail" },
      employee_count: { value: "0", amount: 0 },
      revenue: { value: "under_250k", amount: 150000 },
      has_premises: { value: "no" },
      owns_property: { value: "no" },
      company_vehicles: { value: "no" },
      handles_data: { value: "yes" },
    },
  }, SETTINGS);
  const cyber = needs.find((n) => n.id === "cyber");
  assert.ok(cyber && cyber.priority === "high");
});

test("commercial property: fires for remote business with equipment, not for small premises-based business", () => {
  // Remote business storing equipment, no premises -> standalone property coverage.
  const remote = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "retail" },
      employee_count: { value: "0", amount: 0 },
      revenue: { value: "under_250k", amount: 150000 },
      has_premises: { value: "no" },
      owns_property: { value: "yes" },
      company_vehicles: { value: "no" },
      handles_data: { value: "no" },
    },
  }, SETTINGS);
  assert.ok(remote.find((n) => n.id === "commercial-property"));

  // Small business with premises -> BOP bundles property, so no standalone property need.
  const premises = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "retail" },
      employee_count: { value: "1_5", amount: 3 },
      revenue: { value: "under_250k", amount: 150000 },
      has_premises: { value: "yes" },
      owns_property: { value: "yes" },
      company_vehicles: { value: "no" },
      handles_data: { value: "no" },
    },
  }, SETTINGS);
  assert.ok(premises.find((n) => n.id === "bop"));
  assert.equal(premises.find((n) => n.id === "commercial-property"), undefined);
});

test("thresholds are read from settings, not hard-coded", () => {
  // Lower the workers-comp threshold so even a solo operator triggers it.
  const custom = { ...SETTINGS, commercial: { workersCompMinEmployees: 0, umbrellaRevenue: 2000000 } };
  const needs = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "retail" },
      employee_count: { value: "0", amount: 0 },
      revenue: { value: "under_250k", amount: 150000 },
      has_premises: { value: "no" },
      company_vehicles: { value: "no" },
    },
  }, custom);
  assert.ok(ids(needs).includes("workers-comp"));
});

test("empty or unknown profile yields no needs", () => {
  assert.deepEqual(computeNeeds(null, SETTINGS), []);
  assert.deepEqual(computeNeeds({ domain: "other", answers: {} }, SETTINGS), []);
});

// ── Regression: thresholds must FAIL CLOSED (audit 2026-10-05) ──────────────
// rule_settings.settings is free-form jsonb with no shape constraint, so a
// broker can clear a threshold. A bare `n >= null` coerces to `n >= 0` and
// recommended the coverage to EVERYONE.
test("a cleared threshold recommends nothing rather than everything", () => {
  const renter = { domain: "residential", answers: { home_status: { value: "rent" }, home_value: { amount: 1000 } } };
  for (const bad of [null, "", "   ", NaN, "abc", true, []]) {
    const ids = computeNeeds(renter, { residential: { umbrellaHomeValue: bad } }).map((n) => n.id);
    assert.deepEqual(ids, ["renters"], `umbrellaHomeValue=${JSON.stringify(bad)} must not add umbrella`);
  }
});

test("a cleared commercial threshold does not invent employees", () => {
  const sole = { domain: "commercial", answers: { employee_count: { amount: 0 } } };
  const ids = computeNeeds(sole, { commercial: { workersCompMinEmployees: null } }).map((n) => n.id);
  assert.ok(!ids.includes("workers-comp"), "a sole proprietor must not be told they have employees");
});

test("a usable threshold still fires, including as a numeric string", () => {
  const rich = { domain: "residential", answers: { home_status: { value: "own" }, home_value: { amount: 2000000 } } };
  assert.ok(computeNeeds(rich, { residential: { umbrellaHomeValue: 1000000 } }).map((n) => n.id).includes("umbrella"));
  assert.ok(computeNeeds(rich, { residential: { umbrellaHomeValue: "1000000" } }).map((n) => n.id).includes("umbrella"));
});

test("computeNeeds is pure for an omitted settings argument", () => {
  // Documented as computeNeeds(profile, settings); the profile was guarded but
  // settings was dereferenced one line later.
  assert.deepEqual(
    computeNeeds({ domain: "residential", answers: { home_status: { value: "rent" } } }).map((n) => n.id),
    ["renters"],
  );
});

test("the speculative flood need is marked advisory; established ones are not", () => {
  const unsure = computeNeeds({ domain: "residential", answers: { flood_risk: { value: "unsure" } } }, {});
  assert.equal(unsure.find((n) => n.id === "flood").advisory, true);
  const yes = computeNeeds({ domain: "residential", answers: { flood_risk: { value: "yes" } } }, {});
  assert.equal(yes.find((n) => n.id === "flood").advisory, undefined);
});
