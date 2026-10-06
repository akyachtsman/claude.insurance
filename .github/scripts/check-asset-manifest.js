#!/usr/bin/env node
/**
 * check-asset-manifest — index.html's three hand-maintained asset lists must
 * match the tree and each other.
 *
 * WHY THIS EXISTS. index.html carries three lists that nothing validated:
 *   1. MODULES  — every js/**\/*.js on the import graph, used to build the
 *                 cache-busting import map
 *   2. SHEETS   — every css/*.css, injected with ?v=
 *   3. <noscript> <link>s — the same stylesheets again, by hand
 *
 * An omission from MODULES is SILENT: the module still loads, it just resolves
 * to an unversioned URL, so returning browsers keep serving a stale copy after
 * a deploy. Nothing goes red. That is not hypothetical — commit 2be517a reads
 * "add js/keep/depreciation.js and js/keep/entity-display.js to the MODULES
 * cache-bust array — they were omitted, so a deploy could serve a stale copy."
 * A SHEETS/<noscript> drift is the same shape for CSS.
 *
 * The guard walks the real import graph from js/main.js rather than globbing, so
 * a module that exists but nothing imports is not demanded, and a module that IS
 * imported cannot be forgotten.
 *
 * .mjs files are Node-only tests/fixtures and are never in the browser graph —
 * asserted, not assumed: an .mjs reached from main.js is itself a finding.
 *
 * Exit 0 pass · 1 mismatch · 2 cannot check (missing input — never silent).
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const INDEX = path.join(ROOT, "index.html");
const ENTRY = "js/main.js";

function die(code, msg) { console.error(`check-asset-manifest: ${msg}`); process.exit(code); }

if (!fs.existsSync(INDEX)) die(2, "CANNOT CHECK — index.html not found");
if (!fs.existsSync(path.join(ROOT, ENTRY))) die(2, `CANNOT CHECK — entry ${ENTRY} not found`);
const html = fs.readFileSync(INDEX, "utf8");

// ── parse the three lists ───────────────────────────────────────────────────
function arrayLiteral(name) {
  // Matches `var NAME = [ ... ];` and tolerates comments inside the brackets.
  const m = html.match(new RegExp("var\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;"));
  if (!m) die(2, `CANNOT CHECK — could not find the ${name} array in index.html`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const modules = arrayLiteral("MODULES");
const sheets = arrayLiteral("SHEETS");

const noscript = (html.match(/<noscript>([\s\S]*?)<\/noscript>/) || [, ""])[1];
const noscriptSheets = [...noscript.matchAll(/href="([^"]+\.css)"/g)].map((x) => x[1]);
if (!noscriptSheets.length) die(2, "CANNOT CHECK — no stylesheet links found in <noscript>");

// ── walk the real import graph ──────────────────────────────────────────────
const graph = new Set();
const mjsInGraph = [];
(function walk(rel) {
  if (graph.has(rel)) return;
  graph.add(rel);
  if (rel.endsWith(".mjs")) mjsInGraph.push(rel);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  const src = fs.readFileSync(abs, "utf8");
  const specs = [
    ...src.matchAll(/(?:^|[\s;}])(?:import|export)[\s\S]{0,400}?from\s*"(\.[^"]+)"/g),
    ...src.matchAll(/\bimport\s*\(\s*"(\.[^"]+)"/g),
    ...src.matchAll(/^\s*import\s*"(\.[^"]+)"/gm),
  ].map((m) => m[1]);
  for (const spec of specs) {
    walk(path.relative(ROOT, path.resolve(path.dirname(abs), spec)).split(path.sep).join("/"));
  }
})(ENTRY);

const graphJs = [...graph].filter((f) => f.endsWith(".js")).sort();
const problems = [];

for (const f of graphJs) {
  if (!modules.includes(f)) {
    problems.push(`MODULES is missing "${f}" — it is imported from the graph, so it will be served UNVERSIONED and returning browsers will keep a stale copy after a deploy.`);
  }
}
for (const m of modules) {
  if (!fs.existsSync(path.join(ROOT, m))) problems.push(`MODULES lists "${m}", which does not exist on disk.`);
  else if (!graph.has(m)) problems.push(`MODULES lists "${m}", which nothing in the import graph reaches (dead entry, or an import this guard failed to parse).`);
}
for (const f of mjsInGraph) {
  problems.push(`"${f}" is reachable from ${ENTRY} — .mjs files are Node-only and must never be on the browser graph.`);
}

// ── stylesheets: disk <-> SHEETS <-> <noscript>, all three ──────────────────
const cssDir = path.join(ROOT, "css");
const onDisk = fs.existsSync(cssDir)
  ? fs.readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => "css/" + f).sort()
  : die(2, "CANNOT CHECK — css/ not found");

for (const f of onDisk) {
  if (!sheets.includes(f)) problems.push(`SHEETS is missing "${f}" (present in css/) — it would never load.`);
  if (!noscriptSheets.includes(f)) problems.push(`<noscript> is missing a link for "${f}" — no-JS visitors lose it.`);
}
for (const f of sheets) {
  if (!onDisk.includes(f)) problems.push(`SHEETS lists "${f}", which does not exist in css/.`);
}
for (const f of noscriptSheets) {
  if (!onDisk.includes(f)) problems.push(`<noscript> links "${f}", which does not exist in css/.`);
}
if (sheets.join("|") !== noscriptSheets.join("|")) {
  problems.push(`SHEETS and <noscript> disagree on order/content:\n    SHEETS:    ${sheets.join(", ")}\n    <noscript>: ${noscriptSheets.join(", ")}`);
}

if (problems.length) {
  console.error("check-asset-manifest: FAIL\n");
  for (const p of problems) console.error("  - " + p);
  console.error(`\n  (${graphJs.length} modules on the import graph from ${ENTRY}; ${onDisk.length} stylesheets in css/)`);
  process.exit(1);
}
console.log(`check-asset-manifest: OK — ${graphJs.length} graph modules all cache-busted, ${onDisk.length} stylesheets consistent across SHEETS, <noscript> and css/.`);
console.log("        checks the import graph reached from " + ENTRY + ", not a glob: a module nothing imports is not demanded, and one that is imported cannot be forgotten.");
