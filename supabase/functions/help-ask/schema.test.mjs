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

// ⚠️ COMMENTS ARE STRIPPED BEFORE PAIRING, and that is a bug fix, not tidiness.
// The pairing regex allows 200 characters between `.from()` and `.select(`. A
// 348-character comment added to the throttle reservation pushed its
// `.select("id")` out of that window, so this guard silently went from pairing
// 8 of 8 selects to 7 of 8 — and `>= 4` could not notice. Mutating that select
// to a nonexistent column then passed the whole suite, which is precisely the
// defect class this file exists to catch (a missing column makes PostgREST
// return `{data: null, error}` and every ask fail). Found by review round 5.
//
// Stripping comments makes the window measure CODE distance, so no comment can
// move a select out of range again. String literals are left alone: a `//` or
// `/*` inside one would only ever shorten the text being searched, and the
// column lists this reads are themselves string literals.
//
// ⚠️ KNOWN LIMIT: a REGEX LITERAL containing `/*` — e.g. `.replace(/\/*$/, "")`,
// a plausible trailing-slash trim — opens a block comment that runs to end of
// file, because this does not track regex-literal context (telling `/` as
// division from `/` as a regex start needs real lexing). It FAILS CLOSED: three
// of the index.ts scrapes then fail on correct code, with messages naming the
// wrong cause ("the Anthropic client must be built with maxRetries: 0"). If that
// happens, the scrape is wrong, not the code. Measured by review round 6; a lone
// quote or backtick inside a regex literal was tried and does not break it.
function codeOnly(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// Every `.from(t) … .select("cols")` pair, with an assertion that NOTHING was
// left unpaired — the count must equal the number of `.select("…")` calls in the
// file, not merely clear a floor.
function selectPairs(src) {
  const code = codeOnly(src);
  const pairs = [...code.matchAll(/\.from\("(\w+)"\)[\s\S]{0,200}?\.select\(\s*"([^"]*)"/g)];
  // ⚠️ `total` COUNTS EVERY QUOTING STYLE, not just double quotes. It used to
  // count only `.select("…")`, so a read written `.select('id, ssn')`, with a
  // template literal, or with a constant was invisible to BOTH halves of this
  // guard — the pair count matched, nothing looked unpaired, and a new select
  // reaching an undocumented column passed. Measured. Counting all forms means
  // such a select is unpairable and the error below fires.
  const total = [...code.matchAll(/\.select\(\s*(?:["'`]|[A-Za-z_$])/g)].length;
  if (pairs.length !== total) {
    throw new Error(
      `${total} .select("…") calls in handler.ts but only ${pairs.length} could be paired with a .from(). ` +
      "An unpaired select is UNCHECKED — this guard would pass while it named a column that does not exist.");
  }
  return pairs;
}

test("every column help-ask SELECTs exists in that table", () => {
  const selects = selectPairs(fnSrc);
  assert.ok(selects.length >= 8, `only ${selects.length} .from().select() pairs found — did the parse break?`);

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

// The documented disclosure list, asserted against the SELECT lists too.
//
// handler.test.mjs pins what reaches the provider, which is the boundary that
// matters. This pins the other half: a column selected and then discarded
// discloses nothing, but it makes CLAUDE.md's "exactly these columns" untrue and
// pays to fetch something nobody reads — which is exactly how `policy_number`
// sat selected-and-dropped for four review rounds while the docs claimed it was
// sent. Keep the two lists in step or change the constraint deliberately.
const DOCUMENTED = {
  profiles: ["id"],
  entities: ["id", "name", "kind"],
  assets: ["id", "name", "type", "value", "entity_id"],
  // `status` and `effective_date` added 2026-10-09: the prompt invited the model
  // to decide "still active" and the digest carried only `renewal_date`, so a
  // cancelled or not-yet-started policy read as active. CLAUDE.md's disclosure
  // paragraph was widened in the same change, which is what this list gates.
  policies: ["line", "carrier", "number", "status", "effective_date", "renewal_date",
             "premium_amount", "premium_period", "coverages", "asset_id"],
};

test("help-ask selects exactly the columns CLAUDE.md says it discloses", () => {
  const selects = selectPairs(fnSrc);
  assert.ok(selects.length >= 8, `only ${selects.length} .from().select() pairs found — did the parse break?`);

  for (const [, table, list] of selects) {
    if (!DOCUMENTED[table]) continue;                 // help_queries is throttle state, not a disclosure
    const got = list.split(",").map((c) => c.trim()).filter(Boolean).sort();
    assert.deepEqual(got, [...DOCUMENTED[table]].sort(),
      `public.${table}'s select does not match CLAUDE.md's disclosed column list. ` +
      `Widening it widens what crosses to the provider; narrowing it makes the documented list over-state. ` +
      `Change the constraint deliberately, in the same edit.`);
  }
});
