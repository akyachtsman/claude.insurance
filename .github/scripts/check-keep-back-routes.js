#!/usr/bin/env node
// check-keep-back-routes.js — every Keep route is classified as a back
// destination, or the build fails.
//
// WHY THIS EXISTS. `originRoute()` in js/keep/views/shell.js decides where a
// back control may point. It used to hold a DENY-list of routes that must not be
// offered, and that list was found incomplete twice on one pull request, each
// time a real defect:
//
//   * `#/keep/login` — every sign-in lands on home with the login card as its
//     recorded origin, so the first screen of every session offered a "Back" to
//     a login form that `dispatchKeep` renders with no session check.
//   * the bare `#/keep/request` — the general enhancement form, which submits to
//     `#/keep/requests`; that page then pointed back at the form it had just
//     submitted, inviting a duplicate enhancement request.
//
// `global.md` → *Review Rounds Have to Terminate*: when the same mechanism fails
// again across rounds, the mechanism is in the wrong place. A deny-list is
// incomplete by construction — a route added later is a candidate omission and
// nothing fails when one is missed. The table was inverted to an allow-list, so
// an unclassified route is simply not offered, and this guard closes the other
// half: it fails when the router knows a route the table does not, or the table
// names one the router does not.
//
// It deliberately checks SET EQUALITY, not just containment. Containment alone
// would let a table entry outlive the route it describes — which is the same
// kind of stale record this repo has been bitten by in prose, and it is worse in
// code because it looks deliberate.
//
// ⚠️ IT IS A TEXT SCAN, not a parse, and it fails CLOSED. If either pattern
// stops matching — the switch is restructured, the table renamed — it reports
// that it could not read what it needs and exits non-zero, rather than
// certifying a comparison it did not make. An empty set compared against an
// empty set is the silent pass this guard must never produce.

import { readFileSync } from "node:fs";

const ROUTER = "js/main.js";
const SHELL = "js/keep/views/shell.js";
const fail = [];

const router = readFileSync(ROUTER, "utf8");
const shell = readFileSync(SHELL, "utf8");

// --- the router's cases -----------------------------------------------------
// dispatchKeep's body only; `case undefined:` is `#/keep` itself and maps to "".
const dispatch = router.match(/function dispatchKeep[\s\S]*?\n}/);
if (!dispatch) fail.push(`${ROUTER}: could not find dispatchKeep — this guard cannot run`);
const routerRoutes = new Set();
if (dispatch) {
  for (const m of dispatch[0].matchAll(/^\s*case\s+(?:"([^"]+)"|undefined)\s*:/gm)) {
    routerRoutes.add(m[1] === undefined ? "" : m[1]);
  }
  // `login` is handled by an early return above the switch, not by a case.
  if (/sub\s*===\s*"login"/.test(dispatch[0])) routerRoutes.add("login");
}
if (dispatch && routerRoutes.size === 0) {
  fail.push(`${ROUTER}: dispatchKeep matched but yielded no routes — the case pattern no longer fits`);
}

// --- the shell's table ------------------------------------------------------
const table = shell.match(/const BACK_ELIGIBLE = \{([\s\S]*?)\n\};/);
if (!table) fail.push(`${SHELL}: could not find the BACK_ELIGIBLE table — this guard cannot run`);
const tableRoutes = new Map();
if (table) {
  for (const line of table[1].split("\n")) {
    const m = line.match(/^\s*(?:"([^"]*)"|([A-Za-z_$][\w$]*))\s*:\s*(true|false)\s*,/);
    if (m) tableRoutes.set(m[1] !== undefined ? m[1] : m[2], m[3] === "true");
  }
}
if (table && tableRoutes.size === 0) {
  fail.push(`${SHELL}: BACK_ELIGIBLE matched but yielded no entries — the entry pattern no longer fits`);
}

// --- compare ----------------------------------------------------------------
if (routerRoutes.size && tableRoutes.size) {
  const show = (s) => [...s].map((r) => (r === "" ? '"" (#/keep)' : r)).sort().join(", ");
  const missing = [...routerRoutes].filter((r) => !tableRoutes.has(r));
  const extra = [...tableRoutes.keys()].filter((r) => !routerRoutes.has(r));
  if (missing.length) {
    fail.push(
      `${SHELL}: BACK_ELIGIBLE does not classify ${missing.length} route(s) the router handles: ` +
      `${show(new Set(missing))}\n` +
      `  Add each with true (an ordinary page a user may return to) or false (an auth\n` +
      `  route, or a single-use form the app navigates away from on success).`
    );
  }
  if (extra.length) {
    fail.push(
      `${SHELL}: BACK_ELIGIBLE names ${extra.length} route(s) the router does not handle: ` +
      `${show(new Set(extra))}\n` +
      `  Remove them — a stale entry describes a route that no longer exists.`
    );
  }
}

if (fail.length) {
  console.error("check-keep-back-routes: FAIL\n");
  for (const f of fail) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(
  `check-keep-back-routes: ok — ${tableRoutes.size} routes classified ` +
  `(${[...tableRoutes.values()].filter(Boolean).length} back-eligible, ` +
  `${[...tableRoutes.values()].filter((v) => !v).length} not), matching dispatchKeep exactly`
);
