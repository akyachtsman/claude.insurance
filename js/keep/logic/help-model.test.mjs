// help-model.test.mjs — the model-tier allow-list exists in THREE sources that
// cannot import from one another, so this is the thing that stops them drifting.
//
//   1. js/keep/logic/help-model.js                       what a broker may pick
//   2. supabase/functions/help-ask/handler.ts            what may reach Anthropic
//   3. supabase/migrations/…_help_settings.sql           what may be stored
//
// ⚠️ EVERY SOURCE IS COMMENT-STRIPPED AND THEN SCOPED TO THE DECLARATION THAT
// OWNS THE PROPERTY, and both halves of that are load-bearing. CLAUDE.md records
// this scoping defect five separate times — a source assertion run over a whole
// file, or over concatenated files, passes against prose that merely mentions
// the thing. This migration's own probe footer names `claude-haiku-5-5` AND
// `claude-3-opus` in comments, so a whole-file scan would read a deliberately
// REFUSED value as an allowed one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HELP_MODEL_CHOICES, DEFAULT_HELP_MODEL, isHelpModel, helpModelLabel,
  normaliseHelpModel, priceLine, PRICES_AS_AT,
} from "./help-model.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── HOW A SOURCE IS PARSED, AND WHY IN THIS ORDER ────────────────────────────
//
// Region FIRST, comment-strip SECOND, extract THIRD. The order is the whole
// defence. CLAUDE.md records the scoping defect five times: an assertion run
// over a whole file passes against prose that merely mentions the thing. This
// migration's own probe footer names `claude-haiku-5-5` AND the deliberately
// REFUSED `claude-3-opus` in comments, so a whole-file scan would read a value
// the schema rejects as one it allows.
//
// ⚠️ AND THE STRIPPERS ARE NOT STRING-AWARE, SO THEIR PRECONDITION IS CHECKED
// ON THE REGION rather than asserted in a comment. The first version of this
// file checked it over the whole of `handler.ts` and FAILED on its first run —
// correctly, on `"--no-verify-jwt"`, with a needle list that did not even match
// the strippers in use. A half-correct string-aware stripper would have hidden
// that; a simple one with a checked precondition could not.

/** The raw text between an anchor's first `open` and its matching `close`.
 *  Nothing is stripped here — the precondition below needs the real text. */
function region(src, anchor, open, close, what) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${what}: anchor ${JSON.stringify(anchor)} not found`);
  const from = src.indexOf(open, at);
  const to = src.indexOf(close, from);
  assert.ok(from > at && to > from, `${what}: could not delimit ${anchor}`);
  return src.slice(from, to);
}

/** Strip `markers` comments from one region, having first checked that no marker
 *  occurs inside a string literal there — which is exactly when a non
 *  string-aware stripper would eat live code. */
function stripIn(text, markers, what) {
  for (const m of text.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    for (const needle of markers) {
      assert.ok(!body.includes(needle),
        `${what}: ${JSON.stringify(needle)} inside the string ${JSON.stringify(body)} — ` +
        `stripIn must become string-aware before this region can be parsed`);
    }
  }
  let out = text;
  if (markers.includes("/*")) out = out.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const needle of markers) {
    if (needle === "/*") continue;
    out = out.replace(new RegExp(`${needle.replace(/[/-]/g, "\\$&")}[^\\n]*`, "g"), " ");
  }
  return out;
}

const QUOTED = /['"]([a-z0-9.\-]+)['"]/gi;
const idsIn = (text) => [...text.matchAll(QUOTED)].map((m) => m[1]);

const MIGRATION = "../../../supabase/migrations/20261014001500_help_settings.sql";
const HANDLER = "../../../supabase/functions/help-ask/handler.ts";

// ── 1. the browser list ───────────────────────────────────────────────────────
function clientIds() {
  const r = stripIn(region(read("./help-model.js"), "HELP_MODEL_CHOICES", "[", "];", "help-model.js"),
    ["//", "/*"], "help-model.js");
  // `id:` only — `label`, `blurb` and the prices are quoted too and must not be
  // swept in as ids.
  return [...r.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

// ── 2. the function's allow-list ──────────────────────────────────────────────
function handlerIds() {
  const r = stripIn(region(read(HANDLER), "HELP_MODELS", "[", "]", "handler.ts"),
    ["//", "/*"], "handler.ts");
  return idsIn(r);
}

// ── 3. the column CHECK, scoped to the `model` column ─────────────────────────
// `id boolean … check (id)` is a different constraint on the same table, so the
// region is the create-table body and the match is anchored on `model in`.
function migrationTable() {
  return stripIn(region(read(MIGRATION), "create table if not exists public.help_settings", "(", "\n);", "migration"),
    ["--"], "migration");
}
function migrationIds() {
  const m = /check\s*\(\s*model\s+in\s*\(([^)]*)\)/i.exec(migrationTable());
  assert.ok(m, "the model CHECK constraint was not found in the create-table body");
  return idsIn(m[1]);
}
function migrationDefault() {
  const m = /model\s+text\s+not\s+null\s+default\s+'([^']+)'/i.exec(migrationTable());
  assert.ok(m, "the model column default was not found in the create-table body");
  return m[1];
}

test("all three sources allow exactly the same ids, in the same order", () => {
  const client = clientIds();
  const handler = handlerIds();
  const migration = migrationIds();

  // Non-vacuous first: an empty list would satisfy every equality below.
  assert.equal(client.length, 3, `expected 3 client choices, got ${client.length}`);
  assert.deepEqual(client, HELP_MODEL_CHOICES.map((c) => c.id), "the parse disagrees with the imported module");

  assert.deepEqual(handler, client, "handler.ts's HELP_MODELS differs from the broker control's list");
  assert.deepEqual(migration, client, "the migration's CHECK differs from the broker control's list");
});

test("the default is the same in all three, and it is positional", () => {
  assert.equal(DEFAULT_HELP_MODEL, HELP_MODEL_CHOICES[0].id);
  assert.equal(migrationDefault(), DEFAULT_HELP_MODEL, "the column default is not the first tier");
  assert.equal(handlerIds()[0], DEFAULT_HELP_MODEL, "handler.ts's first tier is not the default");

  // handler.ts derives its default positionally; assert that it still does,
  // because a literal there would silently survive a reorder of the list.
  const src = read(HANDLER);
  assert.match(src, /DEFAULT_HELP_MODEL[^=]*=\s*HELP_MODELS\[0\]/,
    "handler.ts's DEFAULT_HELP_MODEL is no longer HELP_MODELS[0]");
});

test("every choice carries what the control renders", () => {
  for (const c of HELP_MODEL_CHOICES) {
    assert.match(c.id, /^claude-[a-z]+-\d+-\d+$/, `id ${c.id}`);
    assert.ok(c.label && c.label.length <= 12, `label ${c.label}`);
    assert.ok(c.blurb && c.blurb.length > 20, `blurb for ${c.id}`);
    assert.ok(Number.isFinite(c.inPer1M) && c.inPer1M > 0, `inPer1M for ${c.id}`);
    assert.ok(Number.isFinite(c.outPer1M) && c.outPer1M > c.inPer1M, `outPer1M for ${c.id}`);
  }
  // Cheapest last, so the control reads as a descending cost ladder.
  const out = HELP_MODEL_CHOICES.map((c) => c.outPer1M);
  assert.deepEqual([...out].sort((a, b) => b - a), out, "tiers are not in descending cost order");
});

test("PRICES_AS_AT is a real date, so the caveat cannot read as blank", () => {
  assert.match(PRICES_AS_AT, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(PRICES_AS_AT)));
});

test("isHelpModel accepts only the three, forgiving case and space", () => {
  for (const c of HELP_MODEL_CHOICES) {
    assert.ok(isHelpModel(c.id));
    assert.ok(isHelpModel(`  ${c.id.toUpperCase()}  `), `case/space for ${c.id}`);
  }
  // A DATE-SUFFIXED id is refused, for the reason handler.ts gives: it is the
  // most likely wrong value a human types and it is wrong in a way that looks
  // right.
  for (const bad of ["", "   ", "claude-opus-5-5-20260101", "claude-opus-5", "opus", null, undefined, 5, {}, ["claude-opus-5-5"]]) {
    assert.equal(isHelpModel(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test("helpModelLabel returns a label or an empty string, never the raw id", () => {
  assert.equal(helpModelLabel("claude-sonnet-5-5"), "Sonnet");
  assert.equal(helpModelLabel("CLAUDE-HAIKU-5-5"), "Haiku");
  for (const bad of ["claude-3-opus", "", null, undefined, 7]) {
    assert.equal(helpModelLabel(bad), "", `leaked ${JSON.stringify(bad)}`);
  }
});

test("normaliseHelpModel falls back rather than refusing", () => {
  assert.equal(normaliseHelpModel("claude-haiku-5-5"), "claude-haiku-5-5");
  assert.equal(normaliseHelpModel(" Claude-Sonnet-5-5 "), "claude-sonnet-5-5");
  for (const bad of ["claude-3-opus", "", null, undefined, {}]) {
    assert.equal(normaliseHelpModel(bad), DEFAULT_HELP_MODEL, `did not fall back for ${JSON.stringify(bad)}`);
  }
});

test("priceLine writes whole dollars bare and cents to two places", () => {
  assert.equal(priceLine({ inPer1M: 4, outPer1M: 20 }), "$4 / $20 per million tokens in / out");
  assert.equal(priceLine({ inPer1M: 0.1, outPer1M: 0.5 }), "$0.10 / $0.50 per million tokens in / out");
});
