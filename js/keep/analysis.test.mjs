// analysis.test.mjs — unit tests for the Keep asset-coverage analysis.
// Run: node --test js/keep/analysis.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAsset, assetStatus, entitySummary } from "./analysis.js";
import { getEntity, findAsset } from "./data.js";

const SETTINGS = {
  residential: { umbrellaHomeValue: 750000, umbrellaVehicleCount: 3 },
  commercial: { workersCompMinEmployees: 1, umbrellaRevenue: 2000000 },
};

test("home above the umbrella threshold shows umbrella as the gap; flood is in place", () => {
  const { asset } = findAsset("home-marina");
  const a = analyzeAsset(asset, SETTINGS);
  assert.ok(a.mustHave.every((c) => c.status === "in-place"), "core coverages are in place");
  assert.equal(a.recommended.find((c) => c.id === "flood").status, "in-place", "flood policy on file → in place");
  const recGaps = a.recommended.filter((c) => c.status === "gap").map((c) => c.id);
  assert.deepEqual(recGaps, ["umbrella"], "umbrella is the remaining gap");
  assert.equal(a.gaps, 1);
});

test("an uninsured asset reports as Not insured", () => {
  const { asset } = findAsset("sea-breeze");
  assert.equal(assetStatus(asset, SETTINGS).label, "Not insured");
});

test("a fully covered vehicle reports Protected", () => {
  const { asset } = findAsset("tesla-my");
  assert.equal(assetStatus(asset, SETTINGS).label, "Protected");
});

test("a suggestion-only asset reports a recommendation, not a gap", () => {
  const { asset } = findAsset("valuables");
  const s = assetStatus(asset, SETTINGS);
  assert.equal(s.gaps, 0);
  assert.equal(s.label, "1 recommendation");
});

test("thresholds are read from settings — raising the umbrella floor drops that gap", () => {
  const { asset } = findAsset("home-marina");
  const lifted = { ...SETTINGS, residential: { ...SETTINGS.residential, umbrellaHomeValue: 1000000 } };
  const a = analyzeAsset(asset, lifted);
  const gapIds = a.recommended.filter((c) => c.status === "gap").map((c) => c.id);
  assert.ok(!gapIds.includes("umbrella"), "umbrella no longer recommended above the new floor");
  assert.equal(a.gaps, 0, "no gaps once umbrella drops (flood already on file)");
});

test("entity summary aggregates assets and gaps", () => {
  const me = getEntity("me");
  const sum = entitySummary(me, SETTINGS);
  assert.equal(sum.assets, 4);
  assert.equal(sum.gaps, 3); // home: umbrella (1) + watercraft: hull + liability (2)
  assert.ok(sum.inPlace >= 7);
});
