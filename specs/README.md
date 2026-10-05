# specs/ — point-in-time SDD record, NOT current architecture

These files are the **frozen** spec-driven-development artifacts for feature
001, in phase order: `research.md` → `spec.md` → `plan.md` → `tasks.md`. They
record what was decided and planned *then*. They are deliberately not updated as
the app evolves, so **do not read them as a description of the code today** and
do not "fix" them to match it.

A newcomer previously found a confident file-by-file layout map in `plan.md` with
nothing marking it historical, and CLAUDE.md never mentioned this directory at
all. That is what this file is for. For current architecture, read CLAUDE.md →
*Application Architecture*.

## Known divergences from today's code (as of 2026-10-05)

Listed so they read as history rather than as errors or as instructions:

- **Theme.** These files specify `data-theme="slate-blue"`, including as a
  functional requirement (`spec.md` → FR-X3). The app has shipped
  `data-theme="harbor"` since `1965d66`, recoloured violet → blue in `6dcabcf`.
  `plan.md` and `research.md` carry the same `slate-blue` references.
- **`js/format.js`** — `plan.md` lists it as "(keep/extend)". It was deleted in
  `2be517a`; the formatters now live in `js/keep/views/shell.js`.
- **`js/supabase.js`** — `plan.md` describes it as a STUB. It has been a live
  client since `aef483f`.
- **`js/components/`** — `plan.md` lists six files; they were consolidated into
  `ui.js`, `progress.js` and `glossary.js`.
- **`js/keep/`** — the whole Keep portal, now the bulk of the application, is
  absent from these documents. It arrived after them.

## `test-harness-hardening.md`

Not an SDD artifact — it is an open-findings table from a Codex review of PR #1
about `app.spec.js` and `qa.yml`, and at least one row is resolved (#5:
`http-server` is now a pinned devDependency invoked from `node_modules/.bin`).
It sits here for history; it is not a spec, and its rows are not a current
to-do list.
