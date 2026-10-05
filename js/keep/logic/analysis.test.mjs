// analysis.test.mjs — unit tests for the Keep asset-coverage analysis.
// Run: node --test js/keep/logic/analysis.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAsset, assetStatus, entitySummary } from "./analysis.js";
import { getEntity, findAsset } from "./data.js";
import { SETTINGS } from "../../test-settings.mjs";

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

test("an asset type with no catalog entry reports Not analyzed, not a false Protected", () => {
  // Uncatalogued type → analyzeAsset yields empty mustHave/recommended. We must
  // not claim it's Protected (green) when we can't assess it.
  const s = assetStatus({ id: "x", type: "spaceship", held: [] }, SETTINGS);
  assert.equal(s.label, "Not analyzed");
  assert.notEqual(s.cls, "ok");
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

// ── Regression: client-created asset states (audit 2026-10-05) ─────────────
test("an inherited Object key does not crash the analysis", () => {
  // assets.type is free text and clients have full CRUD. CATALOG["constructor"]
  // was truthy, so the `!cat` guard passed and cat.must.map() threw — taking out
  // the Keep landing, My Entities AND entity detail, which all call entitySummary.
  for (const t of ["constructor", "toString", "valueOf", "__proto__"]) {
    assert.deepEqual(analyzeAsset({ type: t, held: [] }), { mustHave: [], recommended: [], gaps: 0 });
    assert.doesNotThrow(() => entitySummary({ assets: [{ type: t }] }));
  }
});

test("a home with unknown flood risk is not scored as a gap", () => {
  // addAsset always writes attrs:{}, which the home profile turns into
  // flood_risk "unsure" -> an advisory need. `held` is broker-written only, so
  // scoring that a gap left every client-created home permanently flagged with
  // something the client could not clear.
  const bare = { type: "home", value: 400000, facts: [], attrs: {}, held: ["dwelling", "home-liability", "home-contents"] };
  assert.equal(assetStatus(bare, {}).gaps, 0);
  assert.equal(analyzeAsset(bare, {}).recommended.find((r) => r.id === "flood").status, "suggested");
});

test("an established flood risk IS still a gap", () => {
  const zone = { type: "home", value: 400000, facts: [], attrs: { floodZone: true }, held: ["dwelling", "home-liability", "home-contents"] };
  assert.equal(analyzeAsset(zone, {}).recommended.find((r) => r.id === "flood").status, "gap");
});
