// node --test js/keep/docfile.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPdf, docLines } from "./docfile.js";

test("buildPdf: produces a structurally valid minimal PDF", () => {
  const pdf = buildPdf(["Declarations page", "Personal auto"]);
  assert.ok(pdf.startsWith("%PDF-1.4"), "PDF header");
  assert.ok(pdf.trimEnd().endsWith("%%EOF"), "EOF marker");
  assert.ok(pdf.includes("xref"), "xref table");
  assert.ok(pdf.includes("/Root 1 0 R"), "trailer root");
  assert.ok(pdf.includes("(Declarations page) Tj"), "renders the title");
  assert.ok(pdf.includes("(Personal auto) Tj"), "renders context");
});

test("buildPdf: escapes PDF special characters", () => {
  const pdf = buildPdf(["a (b) c\\d"]);
  assert.ok(pdf.includes("(a \\(b\\) c\\\\d) Tj"));
});

test("buildPdf: sanitizes non-ASCII so /Length stays byte-accurate", () => {
  const pdf = buildPdf(["Auto · Tesla — dec"]);
  assert.ok(!/[^\x00-\x7F]/.test(pdf), "no non-ASCII bytes leak in");
  // /Length must equal the actual content-stream byte length.
  const m = pdf.match(/<<\/Length (\d+)>>\nstream\n([\s\S]*?)\nendstream/);
  assert.ok(m, "has a content stream");
  assert.equal(Number(m[1]), m[2].length, "/Length matches stream length");
});

test("buildPdf: accepts a single string", () => {
  assert.ok(buildPdf("Solo").includes("(Solo) Tj"));
});

test("docLines: includes the name, context, and the demo disclaimer", () => {
  const lines = docLines("Full policy", ["Homeowners", "123 Marina Way"]);
  assert.equal(lines[0], "Full policy");
  assert.ok(lines.includes("Homeowners"));
  assert.ok(lines.some((l) => /placeholder/i.test(l)), "has the placeholder disclaimer");
});

test("docLines: drops empty context entries", () => {
  const lines = docLines("ID cards", ["Auto", "", null, undefined]);
  assert.deepEqual(lines.slice(0, 2), ["ID cards", "Auto"]);
});
