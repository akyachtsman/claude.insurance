// depreciation.test.mjs — unit tests for the Keep asset depreciation engine.
// Run: node --test js/keep/depreciation.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { depreciationFor, depreciationMilestones, DEPRECIATION } from "./depreciation.js";

test("a depreciating auto declines straight-line to its salvage floor", () => {
  const d = depreciationFor({ type: "auto", value: 40000 });
  assert.equal(d.depreciates, true);
  assert.equal(d.rc, 40000);
  assert.equal(d.life, 10);
  assert.equal(d.floor, Math.round(40000 * 0.15)); // 6000
  assert.equal(d.annual, Math.round((40000 - 6000) / 10)); // 3400/yr
  assert.equal(d.schedule[0].acv, 40000, "today's ACV equals replacement cost");
  assert.equal(d.schedule[0].dep, 0);
  assert.equal(d.schedule[10].acv, d.floor, "ACV lands exactly on the salvage floor at end of life");
});

test("ACV never drops below the salvage floor", () => {
  const d = depreciationFor({ type: "watercraft", value: 100000 });
  for (const row of d.schedule) assert.ok(row.acv >= d.floor, `year ${row.year} respects floor`);
  assert.equal(d.schedule[d.life].acv, d.floor);
});

test("non-depreciating types (home, land, valuables) carry no schedule", () => {
  for (const type of ["home", "valuables", "commercial-space", "business", "other"]) {
    const d = depreciationFor({ type, value: 500000 });
    assert.equal(d.depreciates, false, `${type} does not depreciate`);
    assert.equal(d.annual, 0);
    assert.deepEqual(d.schedule, []);
    assert.deepEqual(depreciationMilestones(d), []);
  }
});

test("a valueless or missing asset never depreciates", () => {
  assert.equal(depreciationFor({ type: "auto", value: 0 }).depreciates, false);
  assert.equal(depreciationFor(null).depreciates, false);
  assert.equal(depreciationFor({ type: "auto" }).annual, 0);
});

test("milestones include today and end-of-life and stay within the schedule", () => {
  const d = depreciationFor({ type: "watercraft", value: 60000 }); // life 15
  const marks = depreciationMilestones(d).map((r) => r.year);
  assert.equal(marks[0], 0, "starts at today");
  assert.equal(marks[marks.length - 1], d.life, "ends at end of life");
  assert.deepEqual(marks, [0, 1, 2, 3, 5, 10, 15]);
  assert.ok(marks.every((y) => y <= d.life));
});

test("every configured type has a positive life and a salvage fraction in [0,1)", () => {
  for (const [type, cfg] of Object.entries(DEPRECIATION)) {
    assert.ok(cfg.life > 0, `${type} life > 0`);
    assert.ok(cfg.salvage >= 0 && cfg.salvage < 1, `${type} salvage in [0,1)`);
  }
});
