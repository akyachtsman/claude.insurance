// entity-display.test.mjs — unit tests for the single entity-label source.
// Run: node --test js/keep/entity-display.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { entityCategory, entitySubtype, entityColorSuffix, entityRelStyleKey, entityAvatarIcon, entityMapSub, entityIndustry } from "./entity-display.js";

test("entityIndustry returns the business industry, empty otherwise", () => {
  assert.equal(entityIndustry({ kind: "business", subtype: "LLC", industry: "Media" }), "Media");
  assert.equal(entityIndustry({ kind: "business", subtype: "LLC" }), "");
  assert.equal(entityIndustry({ kind: "person", subtype: "Spouse" }), "");
  assert.equal(entityIndustry(null), "");
});

test("entityCategory: the account holder is UBO, other people are Individual", () => {
  assert.equal(entityCategory({ kind: "personal" }), "UBO");
  assert.equal(entityCategory({ kind: "person" }), "Individual");
  assert.equal(entityCategory({ kind: "business" }), "Business");
  assert.equal(entityCategory({ kind: "trust" }), "Trust");
});

test("entityColorSuffix maps kind to the shared colour key", () => {
  assert.equal(entityColorSuffix({ kind: "personal" }), "me");
  assert.equal(entityColorSuffix({ kind: "person" }), "person");
  assert.equal(entityColorSuffix({ kind: "trust" }), "trust");
  assert.equal(entityColorSuffix({ kind: "business", subtype: "LLC" }), "biz");
  assert.equal(entityColorSuffix({ kind: "business", subtype: "Nonprofit Corporation" }), "np");
});

test("entityRelStyleKey is the same mapping as the colour suffix (no drift)", () => {
  for (const e of [{ kind: "personal" }, { kind: "person" }, { kind: "trust" }, { kind: "business", subtype: "LLC" }]) {
    assert.equal(entityRelStyleKey(e), entityColorSuffix(e));
  }
});

test("entitySubtype prefers the real subtype, skips generic words, falls back", () => {
  assert.equal(entitySubtype({ kind: "business", subtype: "LLC" }), "LLC");
  assert.equal(entitySubtype({ kind: "trust", subtype: "Revocable Trust" }), "Revocable Trust");
  assert.equal(entitySubtype({ kind: "person", subtype: "Spouse" }), "Spouse");
  // A generic category word in either column is ignored (never shown as subtype).
  assert.equal(entitySubtype({ kind: "personal", label: "You · personal" }), "You");
  assert.equal(entitySubtype({ kind: "personal", label: "You · UBO" }), "You");
  assert.equal(entitySubtype({ kind: "business", subtype: "Company" }), "—");
  // Falls back from subtype to label when subtype is empty.
  assert.equal(entitySubtype({ kind: "business", subtype: null, label: "S Corporation" }), "S Corporation");
});

test("entityAvatarIcon picks the glyph by kind", () => {
  assert.equal(entityAvatarIcon({ kind: "business" }), "ent-company");
  assert.equal(entityAvatarIcon({ kind: "trust" }), "ent-trust");
  assert.equal(entityAvatarIcon({ kind: "personal" }), "ent-person");
  assert.equal(entityAvatarIcon({ kind: "person" }), "ent-person");
});

test("entityMapSub: UBO for the account holder, subtype/role for everyone else", () => {
  assert.equal(entityMapSub({ kind: "personal", label: "You · personal" }), "You · UBO");
  assert.equal(entityMapSub({ kind: "person", subtype: "Spouse" }), "Spouse");
  assert.equal(entityMapSub({ kind: "business", subtype: "LLC" }), "LLC");
  assert.equal(entityMapSub({ kind: "person", sub: "Business partner" }), "Business partner"); // map-node shape
});
