// schema.test.mjs — every column help-ask SELECTs must exist in the schema.
//
// WHY THIS FILE EXISTS. `ownRecords()` shipped selecting `assets.kind` and
// `policies.policy_number`. Neither column exists — they are `type` and
// `number` — so the assets query returned `{ data: null, error }`, the error was
// discarded, `assets ?? []` made it an empty list, and the function returned
// early before ever reading policies. Every client's records read as "nothing on
// file yet", on a feature whose whole premise is answering from their records.
//
// It was invisible three ways over: no test executes index.ts (Deno-only
// specifiers), the sandbox browser cannot reach Supabase so no live run would
// have caught it either, and FR-17 renders every failure as the same quiet
// notice. The names came from the NESTED SHAPE the views consume
// (`asset.type` is adapted from the row, `policy.number` renamed on the way
// through) rather than from the table. Codex found it; this makes it a gate.
//
// The migrations are the authority here because CLAUDE.md defines them as such:
// "supabase/migrations/ means live and matching list_migrations". Verified
// against the live database on 2026-10-06 as well.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// handler.ts, not index.ts: the logic moved there so it could be EXECUTED
// (see handler.test.mjs). A source scrape left pointing at the old file would
// still parse, still pass, and assert nothing — which is the failure mode this
// whole file exists to prevent, so the parse-health assertions below matter
// more than ever.
const fnSrc = readFileSync(join(here, "handler.ts"), "utf8");
const MIG = join(here, "..", "..", "migrations");
const PROPOSED = join(here, "..", "..", "proposed");

// Replay the migrations in filename order — create, then add column, then drop
// column — to get each table's current column set. Deliberately simple: these
// migrations are plain DDL, and a parser that silently understood less than it
// should would hand back a smaller column set and fail honest code, which is the
// safe direction for a guard.
function buildSchema() {
  const tables = new Map();
  const files = [
    ...readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().map((f) => join(MIG, f)),
    // help_queries is this feature's own table and still unapplied.
    ...readdirSync(PROPOSED).filter((f) => f.endsWith(".sql")).sort().map((f) => join(PROPOSED, f)),
  ];
  for (const file of files) {
    const sql = readFileSync(file, "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const cols = new Set();
      for (const line of m[2].split("\n")) {
        const c = /^\s{2}(\w+)\s+\S/.exec(line);
        if (c && !["constraint", "primary", "unique", "check", "foreign"].includes(c[1].toLowerCase())) cols.add(c[1]);
      }
      tables.set(m[1], cols);
    }
    for (const m of sql.matchAll(/alter table (?:only )?public\.(\w+)([\s\S]*?);/g)) {
      const cols = tables.get(m[1]);
      if (!cols) continue;
      for (const a of m[2].matchAll(/add column (?:if not exists )?(\w+)/g)) cols.add(a[1]);
      for (const d of m[2].matchAll(/drop column (?:if exists )?(\w+)/g)) cols.delete(d[1]);
    }
  }
  return tables;
}

const schema = buildSchema();

test("the migration parser found the tables this function reads", () => {
  // A parse that quietly found nothing would make every assertion below vacuous.
  for (const t of ["entities", "assets", "policies", "help_queries"]) {
    assert.ok(schema.has(t), `the parser did not find public.${t} — this guard is only as good as its parse`);
    assert.ok(schema.get(t).size > 2, `public.${t} parsed with ${schema.get(t).size} columns`);
  }
  // Spot-checks on columns whose names are the whole point of this file.
  assert.ok(schema.get("assets").has("type"), "assets.type");
  assert.ok(!schema.get("assets").has("kind"), "assets has no `kind` — that is entities");
  assert.ok(schema.get("policies").has("number"), "policies.number");
  assert.ok(!schema.get("policies").has("policy_number"), "policies has no `policy_number`");
  assert.ok(schema.get("policies").has("premium_amount"), "policies.premium_amount (added later, text `premium` dropped)");
  assert.ok(!schema.get("policies").has("premium"), "policies.premium was dropped");
});

test("every column help-ask SELECTs exists in that table", () => {
  const selects = [...fnSrc.matchAll(/\.from\("(\w+)"\)[\s\S]{0,200}?\.select\(\s*"([^"]*)"/g)];
  assert.ok(selects.length >= 4, `only ${selects.length} .from().select() pairs found — did the parse break?`);

  const missing = [];
  for (const [, table, list] of selects) {
    const cols = schema.get(table);
    assert.ok(cols, `help-ask selects from public.${table}, which no migration creates`);
    for (const raw of list.split(",")) {
      const col = raw.trim();
      if (!col || col === "*") continue;
      if (!cols.has(col)) missing.push(`${table}.${col}`);
    }
  }
  assert.deepEqual(missing, [],
    `help-ask selects columns that do not exist: ${missing.join(", ")}. ` +
    `A PostgREST select of a missing column returns { data: null, error } — and this function ` +
    `discards those errors, so the client is told they have no records rather than that the read failed.`);
});
