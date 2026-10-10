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
// So the pre-switch region is scanned on its own terms, and the distinction it
// has to draw is real: `if (sub === "login") return …` IS a route, while
// `if (!session) return renderKeepLogin()` is auth logic applying to all of
// them. The rule is CONSERVATIVE rather than enumerative — see the loop below.
//
// ⚠️⚠️ WHAT THIS GUARD IS NOT. It is a strong net, **not a proof**, and the
// difference matters because its green is easy to over-read — which is exactly
// how both of its earlier versions failed. It is sound against every construct
// that mentions `sub`. It is NOT sound against a route selected without
// mentioning `sub` at all: `const r = rest[0]; if (r === "x") return …` is
// invisible to it, and no text scan sees that without becoming a parser.
//
// What actually bounds the harm is not this file — it is that `BACK_ELIGIBLE` is
// an ALLOW-list, so a route it has never heard of is simply not offered as a
// back destination. An unseen route therefore costs a MISSING back control,
// which is cosmetic. That is why the inversion came first and this guard second,
// and why a hole here is not a security hole.
//
// ⚠️ THE SOUND FIX IS A DESIGN DECISION, DELIBERATELY NOT TAKEN HERE: make the
// dispatch table-driven, so `main.js` and `BACK_ELIGIBLE` derive from ONE route
// table — nothing to keep in sync and nothing to scan. That rewrites the app's
// core routing, far beyond the feature this guard arrived with, so it is
// recorded in CLAUDE.md as an owner decision rather than smuggled in. This scan
// has now been fixed TWICE; `global.md` → *Review Rounds Have to Terminate* says
// a mechanism that fails a third time gets reverted or redesigned, not patched
// again.

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
    //
    // ⚠️ THE RULE IS CONSERVATIVE, NOT ENUMERATIVE, and that is the SECOND fix to
    // this scan rather than a widening of the first. Enumerating the shapes a
    // route test can take does not terminate: version one read only a hardcoded
    // `login`; version two read `sub === "lit"` inside a returning statement —
    // and that was defeated by ALIASING THE BOOLEAN, since
    // `const r = sub === "reset-password";` has no `return` (skipped) and
    // `if (r) return …` no longer mentions `sub` (read as route-independent).
    // Codex found both, mutation in hand.
    // So the scan no longer asks "is this a route test?" but "is there anything
    // here I cannot account for?" — any `sub` COMPARISON outside a returning
    // statement, and any `sub` mention inside one without a readable literal,
    // fails the guard by name. `const [sub, id] = rest;` is unaffected: it
    // compares nothing.
    const unreadable = (stmt, why) => fail.push(
      `${ROUTER}: dispatchKeep's pre-switch region has a \`sub\` test this guard cannot ` +
      `account for, so it may select a route that never gets classified (${why}):\n` +
      `      ${stmt.trim().replace(/\s+/g, " ").slice(0, 140)}\n` +
      `  Write it as \`if (sub === "<route>") return …\`, or teach this guard the new ` +
      `shape. It will not certify set equality while a route-shaped branch is unreadable.`
    );
    for (const stmt of body.slice(0, switchAt).split(";")) {
      const lits = [...stmt.matchAll(/\bsub\s*={2,3}\s*"([^"]*)"/g)].map((m) => m[1]);
      const compares = /\bsub\s*={2,3}/.test(stmt);
      const returns = /\breturn\b/.test(stmt);
      if (lits.length && returns) { for (const l of lits) routerRoutes.add(l); continue; }
      // A comparison whose result is not returned here: the alias case.
      if (compares && !returns) { unreadable(stmt, "a `sub` comparison outside a returning statement"); continue; }
      // A comparison against something this scan cannot read as a literal.
      if (compares) { unreadable(stmt, "a `sub` comparison against a non-literal"); continue; }
      // A returning statement mentioning `sub` with no readable literal. One that
      // does NOT mention `sub` is route-independent and correctly ignored.
      if (returns && /\bsub\b/.test(stmt)) unreadable(stmt, "a returning statement using `sub` with no literal");
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
