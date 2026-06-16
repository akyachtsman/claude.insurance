# Tasks — Broker-Branded Insurance App

**Phase:** 4 (tasks) · **Feature slug:** `001-broker-insurance-app`
**Reads:** `spec.md` (+ §10 Clarifications), `plan.md`
**Convention:** `[ID] [P?] description` — `[P]` = parallelizable (no dependency on
another unfinished task in the same group). Each task names the spec/plan anchor it
serves and a done-check. Implement strictly in phase order; within a phase, `[P]` items
may run together.

> **Gate:** This list is produced for review. `implement` is a separate phase and its
> first task **provisions an external Supabase project** — do not start until approved.

---

## Phase A — Foundations & scaffolding
- [ ] **A1** Create `css/tokens.css` from `design.md` slate-blue scheme; set
  `data-theme="slate-blue"` on `<html>` in `index.html`. *(FR-X3)* — Done: theme tokens
  render; `index.html` validates (`npx html-validate index.html`).
- [ ] **A2 [P]** Create app shell `index.html` (semantic landmarks, module entry
  `<script type="module" src="js/main.js">`, no inline data). *(global.md, FR-X4)* —
  Done: html-validate clean.
- [ ] **A3 [P]** `css/app.css` — components from `design.md` (cards, step/wizard,
  progress bar, buttons, form controls ≥16px). *(design.md, FR-A5/B10)* — Done: visual
  components styled, no hover-only affordances.
- [ ] **A4** `js/main.js` hash router (`#/hub` default, `#/qualify`, `#/summary`) +
  mount points. *(plan §3)* — Done: navigating hashes swaps views.
- [ ] **A5 [P]** `js/format.js` — number/date/currency helpers per `design.md`. — Done:
  unit-testable pure functions exported.

## Phase B — Content (static JSON, no DB)
- [ ] **B1** `content/coverage.json` — hub topics: Residential (home, auto), Commercial
  (BOP, general liability), each with definition / covers / doesn't-cover / who-needs.
  *(FR-A\*, C6)* — Done: 4 topics complete, US-oriented, editorial-reviewed.
- [ ] **B2** `content/questionnaire.json` — branched schema (residential|commercial),
  commercial industry curated ~8–12 list, per-step fields, inline glossary terms,
  deferred contact step last. *(FR-B1–B4, C7, C8)* — Done: schema drives qualify view;
  contact step is final.

## Phase C — Needs/gap engine (pure, TDD-first)
- [ ] **C1** Write unit tests for `rules.js` covering residential + commercial paths and
  threshold-driven gaps (tests fail first). *(test.md, FR-B5/B9)* — Done: tests exist
  and fail (no impl).
- [ ] **C2** Implement `js/rules.js` — pure `(answers, settings) → prioritized needs[]`,
  **no hard-coded thresholds** (all from `settings`). *(FR-B5/B9, C3)* — Done: C1 tests
  pass.

## Phase D — Supabase backend  *(first task provisions external resource — gate here)*
- [ ] **D1** Provision Supabase project (via Supabase MCP / `directives-toolkit:supabase`
  agent); record project URL + anon (publishable) key for client config. *(data.md)* —
  Done: project live, keys captured (anon key only client-side).
- [ ] **D2** `supabase/migrations/0001_init.sql` — `leads` + `rule_settings` tables,
  **RLS enabled**, policies (`leads` anon INSERT-only w/ shape checks, no SELECT;
  `rule_settings` anon SELECT-only), seed `rule_settings` US defaults. *(plan §4,
  data.md)* — Done: migration applied; `get_advisors` shows no RLS gaps.
- [ ] **D3** `js/supabase.js` — thin client (anon key), `insertLead()` + `fetchRules()`;
  honeypot field handling. *(plan §4/§6)* — Done: insert succeeds, select on `leads`
  denied for anon (verified).
- [ ] **D4** `supabase/functions/notify-lead/` Edge Function — triggered by DB webhook on
  `leads` insert; sends broker email via provider (key as function secret). *(FR-B7,
  data.md)* — Done: test insert delivers an email; secret never client-side.

## Phase E — App views (wire UI to content + engine + backend)
- [ ] **E1** `js/views/hub.js` — render from `coverage.json` (textContent only), topic
  drilldown, CTA into `#/qualify?topic=…`. *(FR-A\*, FR-X4)* — Done: all topics
  reachable; CTA navigates.
- [ ] **E2** `js/views/qualify.js` — state machine over `questionnaire.json`: branch →
  (commercial: industry) → stepped questions + glossary + progress → deferred contact.
  *(FR-B1–B4)* — Done: full + partial paths complete; PII deferred.
- [ ] **E3** `js/views/summary.js` — call `rules.js`, render prioritized needs, show
  **explicit "a lead for your broker — not a quote/price/bound policy"** label, submit
  lead via `supabase.js`. *(FR-B5, SC3)* — Done: summary shows needs + disclaimer; lead
  persists; `notify-lead` fires.
- [ ] **E4 [P]** Partial-lead capture: if user exits after contact step, persist with
  `is_partial=true`. *(FR-B8, C8)* — Done: partial lead row created with contact +
  domain.

## Phase F — Tests & QA gates
- [ ] **F1** Extend `.github/scripts/ui-tests/app.spec.js` with S1–S4 generic suite for
  this app + project S-rows (fill CLAUDE.md UI Test config first). *(test.md)* — Done:
  Playwright scenarios pass locally/CI.
- [ ] **F2** Run Required Commands: `npx html-validate index.html` + workflow-YAML check.
  *(CLAUDE.md)* — Done: both pass.
- [ ] **F3** `qa-pipeline` (test-verifier → code-reviewer → security-review →
  pr-readiness); write reports to `.agent-reports/`. *(CLAUDE.md §5)* — Done: reports
  green, no blockers.

## Phase G — Docs & PR
- [ ] **G1** Update `CLAUDE.md`: fill Stack, Application Architecture, UI Test
  Configuration, Project-Specific Test Scenarios, and record the **anon-key public
  lead-insert** security trade-off. *(plan §6)* — Done: placeholders resolved.
- [ ] **G2** Open **draft PR** to `main` from `claude/great-bohr-09e0lb`; confirm Pages
  deploy + `live-chk`. *(CLAUDE.md §6)* — Done: PR open, site live with latest.

---

## Dependency summary
A → (B, C, D independent of each other) → E (needs B+C+D) → F (needs E) → G (needs F).
Within A: A2/A3/A5 `[P]`. D1 is the **external-provisioning gate**; D2–D4 follow D1.
TDD: C1 before C2.

## Parallelizable up front (after A1/A2/A4)
`[P]` B1, B2, C1, A3, A5 can proceed concurrently before backend wiring.
