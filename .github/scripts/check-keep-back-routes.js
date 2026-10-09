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
//
// ⚠️ AND NOT EVERY ROUTE IS A `case`. `dispatchKeep` answers `login` with an
// EARLY RETURN above the switch, because that route must render before
// `getSession()` is consulted. The first version of this guard hardcoded that
// one route — `if (/sub === "login"/)` — which meant a second session-free route
// added the same way (`if (sub === "reset-password") return …`) would be
// invisible to the scan, left unclassified in the table, and the guard would
// still print "18 routes match". A guard that advertises set equality and
// quietly exempts a whole syntactic form is worse than no guard. Found by Codex
// on the PR that introduced it, with the mutation already run.
//
// So the pre-switch region is now scanned on its own terms, and the distinction
// it has to draw is real: `if (sub === "login") return …` IS a route, while
// `if (!session) return renderKeepLogin()` is auth logic that applies to all of
// them. The rule is per statement — a returning statement that compares `sub` to
// string literals contributes those routes; one that mentions `sub` without a
// literal this scan can read is UNRECOGNISED and fails the guard by name. That
// is the "or fail when an unrecognized one exists" half, and it is what keeps
// the next novel shape from being silently exempt too.

import { readFileSync } from "node:fs";

const ROUTER = "js/main.js";
const SHELL = "js/keep/views/shell.js";
const fail = [];

const router = readFileSync(ROUTER, "utf8");
const shell = readFileSync(SHELL, "utf8");

// Strip comments so a commented-out `case` or the word `sub` in prose cannot be
// read as code. Crude on purpose: it runs over source this repo controls, and
// over-stripping fails the guard loudly rather than passing it quietly.
const codeOnly = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// --- the router's routes ----------------------------------------------------
// dispatchKeep's body only. Two syntactic forms carry routes, and BOTH are read:
// the switch's `case` labels (`case undefined:` is `#/keep` itself and maps to
// ""), and early returns above the switch.
const dispatch = router.match(/function dispatchKeep[\s\S]*?\n}/);
if (!dispatch) fail.push(`${ROUTER}: could not find dispatchKeep — this guard cannot run`);
const routerRoutes = new Set();
if (dispatch) {
  const body = codeOnly(dispatch[0]);
  const switchAt = body.search(/switch\s*\(\s*sub\s*\)/);
  if (switchAt < 0) {
    fail.push(
      `${ROUTER}: dispatchKeep has no \`switch (sub)\` — this guard cannot tell its ` +
      `route cases from its early returns, so it will not certify either`
    );
  } else {
    for (const m of body.slice(switchAt).matchAll(/\bcase\s+(?:"([^"]+)"|undefined)\s*:/g)) {
      routerRoutes.add(m[1] === undefined ? "" : m[1]);
    }
    // Early returns, per STATEMENT so a condition split over several lines is
    // still read with its own `return`.
    for (const stmt of body.slice(0, switchAt).split(";")) {
      if (!/\breturn\b/.test(stmt)) continue;
      const lits = [...stmt.matchAll(/\bsub\s*={2,3}\s*"([^"]*)"/g)].map((m) => m[1]);
      if (lits.length) { for (const l of lits) routerRoutes.add(l); continue; }
      // Mentions `sub` but in a shape this scan cannot read -> fail by name.
      // A returning statement that does NOT mention `sub` is route-independent
      // (`if (!session) return renderKeepLogin()`) and is correctly ignored.
      if (/\bsub\b/.test(stmt)) {
        fail.push(
          `${ROUTER}: an early return in dispatchKeep tests \`sub\` in a form this guard ` +
          `cannot read, so it may be a route that never gets classified:\n` +
          `      ${stmt.trim().replace(/\s+/g, " ").slice(0, 120)}\n` +
          `  Either write it as \`sub === "<route>"\`, or teach this guard the new shape. ` +
          `It will not certify set equality while a route-shaped branch is unreadable.`
        );
      }
    }
  }
}
if (dispatch && routerRoutes.size === 0 && !fail.length) {
  fail.push(`${ROUTER}: dispatchKeep matched but yielded no routes — the patterns no longer fit`);
}

// --- the shell's table ------------------------------------------------------
const table = codeOnly(shell).match(/const BACK_ELIGIBLE = \{([\s\S]*?)\n\};/);
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
