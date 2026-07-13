// node --test js/keep/search.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_ACTIONS, matchActions, searchRecords } from "./search.js";

const ENTITIES = [
  {
    id: "me", name: "Jordan Mercer", label: "Personal",
    assets: [
      {
        id: "a1", name: "123 Marina Way",
        policies: [
          { id: "p1", line: "Homeowners", carrier: "Pacific Mutual", number: "HO-9921",
            documents: ["Declarations page", "Full policy"] },
        ],
      },
      { id: "a2", name: "Tesla Model 3", policies: [
        { id: "p2", line: "Personal auto", carrier: "Coastal", number: "AU-77", documents: ["ID cards"] },
      ] },
    ],
  },
  { id: "biz", name: "Coastal Cafe LLC", label: "Business", assets: [] },
];

test("matchActions: empty query returns nothing", () => {
  assert.deepEqual(matchActions(""), []);
  assert.deepEqual(matchActions("   "), []);
});

test("matchActions: 'add an entity' surfaces the add-entity action first", () => {
  const r = matchActions("add an entity");
  assert.equal(r[0].id, "add-entity");
});

test("matchActions: 'audit my policies' surfaces the audit action", () => {
  const r = matchActions("audit my policies");
  assert.equal(r[0].id, "audit");
});

test("matchActions: 'download a document' surfaces documents", () => {
  const r = matchActions("download a document");
  assert.equal(r[0].id, "documents");
});

test("matchActions: partial prefix matches ('renew')", () => {
  const ids = matchActions("renew").map((a) => a.id);
  assert.ok(ids.includes("renewals"));
});

test("matchActions: respects the limit", () => {
  assert.ok(matchActions("a", 3).length <= 3);
});

test("every action has a href and keywords", () => {
  for (const a of KEEP_ACTIONS) {
    assert.ok(a.href.startsWith("#/keep"), `${a.id} href`);
    assert.ok(a.keywords.length > 0, `${a.id} keywords`);
  }
});

test("searchRecords: finds an asset by name", () => {
  const r = searchRecords("tesla", ENTITIES);
  assert.equal(r[0].type, "asset");
  assert.equal(r[0].href, "#/keep/asset/a2");
});

test("searchRecords: finds an entity by name", () => {
  const r = searchRecords("coastal cafe", ENTITIES);
  assert.ok(r.some((x) => x.type === "entity" && x.href === "#/keep/entity/biz"));
});

test("searchRecords: finds a policy by carrier", () => {
  const r = searchRecords("pacific", ENTITIES);
  assert.ok(r.some((x) => x.type === "policy" && x.href === "#/keep/policy/p1"));
});

test("searchRecords: finds a document by name and links to its policy", () => {
  const r = searchRecords("declarations", ENTITIES);
  const doc = r.find((x) => x.type === "document");
  assert.ok(doc);
  assert.equal(doc.href, "#/keep/policy/p1");
});

test("searchRecords: empty query returns nothing", () => {
  assert.deepEqual(searchRecords("", ENTITIES), []);
});

test("searchRecords: respects the limit", () => {
  assert.ok(searchRecords("a", ENTITIES, 2).length <= 2);
});
