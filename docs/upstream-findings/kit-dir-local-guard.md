# `claude.directives` — `kit_dir_kept()` lacks `check()`'s `local` guard

**Status:** WRITTEN, NOT SENT. Found on `claude.insurance` #281 by Codex (P2),
verified against the script 2026-10-15, **re-verified against upstream `main`
2026-10-16**.
**Upstream head the quotations are taken from:** `e78b6dd58796b4aa68056fb99e2416ed8f8d8f88`
(read over git transport; the gap is present at every cached head from
`5342fa9` through `e78b6dd`, so it is not a transient).
**File:** `plugins/directives-toolkit/scripts/refresh-stamp.sh`, lines 89-103.

## The asymmetry

`check()` binds a **file**-level `refresh_kept` record only while it names the
installed copy's content:

```jq
.refresh_kept[$p] | select(type == "object" and .blob == $b and .local == $l and $l != "")
```

and the comment above it says exactly why, crediting the review that added it:

> A record binds only while it ALSO names the installed copy's content: its `local` blob
> (`absent` for a file not installed) must equal this file's, so a later edit or a
> replaced file never inherits an old approval. A record without `local` (written before
> it existed) binds nothing and refuses; every refusal prints the value to record
> (Codex, #451).

`kit_dir_kept()`, the **directory**-keyed form for a UI-test kit subdirectory, has
no such clause:

```jq
[.refresh_kept[$lk], .refresh_kept[$tk]] | map(select(type == "object" and .tree == $t))
 | .[0].reason // empty | select(type == "string" and test("\\S"))
 | if length > 60 then .[0:60] + "..." else . end
```

It selects on the **upstream** tree at the pinned head and nothing else. So a
declined kit directory keeps binding across **local** edits under it — the case
`check()`'s guard exists to prevent ("a later edit never inherits an old
approval"), reopened on the directory path.

## Why it matters in practice

A project that defers the kit-helper migration records
`.github/scripts/ui-tests/tests/` with the upstream tree. `app.spec.js` lives
under that directory and is the file a project edits most often — every new
scenario. After one such edit the refresh cannot distinguish the project's own
new work from the deliberately deferred migration, and nothing re-asks.

On `claude.insurance` the local tree is already `810c5e5` against a recorded
upstream `844e5ff`, and every scenario the project adds moves it again.

## Measured, not inferred

Three runs of the real filter against the project's own `directive-sync.json`
(`refresh-stamp.sh` itself declines to run once upstream moves past the
classified head, so the filter is the instrument):

| input | result |
|---|---|
| the record as written (no `local`) | **binds** |
| a deliberately WRONG `local` added | **still binds** — the field is read by nothing |
| a wrong `.tree` | correctly does **not** bind |

That third row matters: it shows the filter works, so the first two rows are
about `local` specifically and not about a broken test.

## The consequence for the obvious fix

"Record the local tree hash alongside the upstream tree" is **inert on its own**
— it writes a field no code reads, which looks like the fix and changes nothing.
That is worth stating plainly, because it is the shape of fix a reader reaches
for first.

`claude.insurance` recorded it anyway, under the key **`local_tree`** rather than
`local`, with a note in the record saying it is read by nothing today. The key
name is deliberate: if this gap is closed by giving `kit_dir_kept()` a `.local`
guard, that record will have no `.local` and will correctly **re-ask** rather
than bind on a stale value under a different name.

## Suggested fix

Give `kit_dir_kept()` the same two-sided binding as `check()`: match the upstream
tree **and** the installed directory's own tree at the time the exception was
recorded. Obtain the local value the way the local blob is obtained —
`git rev-parse HEAD:<local dir>`, or a working-tree equivalent so an uncommitted
edit is not invisible. Refuse a record that lacks it and print the value to
record, exactly as the file path already does. Document the key name, since a
directory's counterpart to `local` is a **tree**, not a blob.

A smaller alternative, if the two-sided form is not wanted: have the stamp
**print** the local tree beside the upstream one whenever it honours a directory
record, so a reader can see at a glance that the directory has moved locally.
Weaker — it informs rather than gates — but it removes the silent case.
