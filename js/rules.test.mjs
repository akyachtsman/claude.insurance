// rules.test.mjs — unit tests for the needs/gap engine.
// Run with the built-in Node test runner (no dependencies): `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNeeds } from "./rules.js";

const SETTINGS = {
  residential: { umbrellaHomeValue: 750000, umbrellaVehicleCount: 3 },
  commercial: { workersCompMinEmployees: 1, umbrellaRevenue: 2000000 },
};

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

test("commercial solo, remote, low revenue, no vehicles -> general liability only", () => {
  const needs = computeNeeds({
    domain: "commercial",
    answers: {
      industry: { value: "retail" },
      employee_count: { value: "0", amount: 0 },
      revenue: { value: "under_250k", amount: 150000 },
      has_premises: { value: "no" },
      company_vehicles: { value: "no" },
    },
  }, SETTINGS);
  assert.deepEqual(ids(needs), ["general-liability"]);
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
