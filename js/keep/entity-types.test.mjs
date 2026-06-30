// node --test js/keep/entity-types.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTITY_TYPE_GROUPS, TYPE_TO_KIND, kindForType, DEFAULT_ENTITY_TYPE } from "./entity-types.js";

test("groups are non-empty and use valid category kinds", () => {
  assert.ok(ENTITY_TYPE_GROUPS.length >= 2);
  for (const g of ENTITY_TYPE_GROUPS) {
    assert.ok(g.types.length > 0, `${g.category} has types`);
    assert.ok(["business", "trust", "person"].includes(g.kind), `${g.category} kind valid`);
  }
});

test("kindForType maps business, trust and people types", () => {
  assert.equal(kindForType("LLC"), "business");
  assert.equal(kindForType("S Corporation"), "business");
  assert.equal(kindForType("Limited Partnership (LP)"), "business");
  assert.equal(kindForType("Revocable Trust"), "trust");
  assert.equal(kindForType("Estate"), "trust");
  assert.equal(kindForType("Spouse"), "person");
  assert.equal(kindForType("Child"), "person");
});

test("kindForType falls back to business for unknown", () => {
  assert.equal(kindForType("Something New"), "business");
  assert.equal(kindForType(""), "business");
});

test("every listed type maps to its group's kind", () => {
  for (const g of ENTITY_TYPE_GROUPS) {
    for (const t of g.types) {
      assert.equal(TYPE_TO_KIND[t], g.kind, `${t} -> ${g.kind}`);
      assert.equal(kindForType(t), g.kind);
    }
  }
});

test("type labels are unique across groups", () => {
  const all = ENTITY_TYPE_GROUPS.flatMap((g) => g.types);
  assert.equal(new Set(all).size, all.length);
});

test("DEFAULT_ENTITY_TYPE is a real business type", () => {
  assert.equal(kindForType(DEFAULT_ENTITY_TYPE), "business");
});
