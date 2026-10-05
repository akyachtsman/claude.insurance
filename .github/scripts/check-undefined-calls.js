#!/usr/bin/env node
/**
 * check-undefined-calls — every called identifier in a browser module must be
 * declared locally, imported, or a known global.
 *
 * WHY THIS EXISTS. This class of bug shipped TWICE inside one PR (#251):
 *   - `renderKeepEntityList()` in policies-view.js — copy-pasted during a module
 *     split without its import. Every unknown policy id threw a ReferenceError.
 *   - `fetchRules()` in keep.js — a scripted import edit used a single-line
 *     regex and silently missed a MULTI-LINE import block, so the call shipped
 *     with no binding and `#/keep` died on the generic error page for every
 *     authenticated user.
 *
 * Neither was caught by anything: `node --check` only parses (a free identifier
 * is legal until it executes), the import-path checks only prove the SPECIFIER
 * resolves, and the UI suite skips the Keep scenarios on a localhost server, so
 * the one page that broke is never opened there.
 *
 * Deliberately CONSERVATIVE — it must not cry wolf, or it will be ignored:
 *   - strips comments, strings and template literals before scanning
 *   - skips language keywords, which are not calls (`if (`, `for (`, …)
 *   - treats object-literal method shorthand (`track(x) {`) as a declaration
 *   - collects params, destructuring, catch bindings and loop vars generously
 * It therefore under-reports rather than over-reports. A hit is a real one.
 *
 * Exit 0 pass · 1 undefined call found · 2 cannot check.
 */
const fs = require("fs");
const path = require("path");

const KEYWORDS = new Set("if else for while switch catch return function class new typeof instanceof delete void in of do try finally throw await yield case default break continue const let var export import extends super this null true false async static get set".split(" "));
const GLOBALS = new Set(`console document window location history setTimeout clearTimeout
setInterval clearInterval fetch JSON Math Object Array String Number Boolean Date Promise Map
Set WeakMap WeakSet RegExp Error TypeError RangeError SyntaxError isNaN isFinite parseInt
parseFloat encodeURIComponent decodeURIComponent encodeURI decodeURI URL URLSearchParams Intl
localStorage sessionStorage navigator alert confirm prompt requestAnimationFrame
cancelAnimationFrame IntersectionObserver MutationObserver ResizeObserver HTMLScriptElement
CustomEvent Event Blob File FileReader TextEncoder TextDecoder structuredClone queueMicrotask
btoa atob crypto performance Symbol Proxy Reflect BigInt globalThis Uint8Array Int8Array
Float32Array Float64Array ArrayBuffer DataView HTMLElement Node NodeList Element SVGElement
Image AbortController AbortSignal FormData Headers Request Response WebSocket Worker
getComputedStyle matchMedia scrollTo DOMParser XMLSerializer`.trim().split(/\s+/));

function strip(src) {
  let c = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  c = c.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  c = c.replace(/`(?:[^`\\]|\\[\s\S])*`/g, "``");
  c = c.replace(/"(?:[^"\\\n]|\\[\s\S])*"/g, '""');
  c = c.replace(/'(?:[^'\\\n]|\\[\s\S])*'/g, "''");
  return c;
}

function declaredIn(c) {
  const d = new Set([...KEYWORDS, ...GLOBALS]);
  const add = (s) => { const n = String(s).replace(/[^\w$]/g, ""); if (n) d.add(n); };
  for (const m of c.matchAll(/import\s*\{([^}]*)\}/g)) m[1].split(",").forEach((n) => add(n.split(" as ").pop()));
  for (const m of c.matchAll(/import\s+(\w+)\s*(?:,|from)/g)) add(m[1]);
  for (const m of c.matchAll(/import\s*\*\s*as\s+(\w+)/g)) add(m[1]);
  for (const m of c.matchAll(/\b(?:function|class)\s+(\w+)/g)) add(m[1]);
  for (const m of c.matchAll(/\b(?:const|let|var)\s+(\w+)/g)) add(m[1]);
  for (const m of c.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) m[1].split(",").forEach((n) => add(n.split(":").pop()));
  for (const m of c.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) m[1].split(",").forEach(add);
  for (const m of c.matchAll(/\(([^()]*)\)\s*=>/g)) m[1].split(",").forEach(add);
  for (const m of c.matchAll(/(?:^|[^\w.$])(\w+)\s*=>/g)) add(m[1]);
  for (const m of c.matchAll(/function\s*\w*\s*\(([^()]*)\)/g)) m[1].split(",").forEach(add);
  for (const m of c.matchAll(/\bcatch\s*\(\s*(\w+)/g)) add(m[1]);
  // object-literal / class method shorthand:  name(args) {
  for (const m of c.matchAll(/(?:^|[,{;\s])(\w+)\s*\([^()]*\)\s*\{/g)) add(m[1]);
  for (const m of c.matchAll(/\basync\s+(\w+)\s*\(/g)) add(m[1]);
  return d;
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
})("js");
if (!files.length) { console.error("check-undefined-calls: CANNOT CHECK — no .js files under js/"); process.exit(2); }

const hits = [];
for (const p of files) {
  const c = strip(fs.readFileSync(p, "utf8"));
  const d = declaredIn(c);
  const seen = new Set();
  for (const m of c.matchAll(/(?<![\w.$?])([a-zA-Z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (d.has(name) || seen.has(name)) continue;
    seen.add(name);
    const line = c.slice(0, m.index).split("\n").length;
    hits.push(`${p}:${line} calls \`${name}()\` — not declared, not imported, not a known global`);
  }
}

if (hits.length) {
  console.error("check-undefined-calls: FAIL\n");
  for (const h of hits) console.error("  - " + h);
  console.error("\n  A free identifier is legal JavaScript until it RUNS, so node --check and the");
  console.error("  import-path checks both pass. This is usually a missing import after a module");
  console.error("  split or a scripted import edit that missed a multi-line import block.");
  process.exit(1);
}
console.log(`check-undefined-calls: OK — ${files.length} browser modules, every called identifier resolves.`);
