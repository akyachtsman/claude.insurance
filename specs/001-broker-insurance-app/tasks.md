# Tasks — Broker-Branded Insurance App (Rebuild)

**Phase:** 4 (tasks) · **Feature slug:** `001-broker-insurance-app`
**Reads:** `spec.md` (+ §10 Clarifications), `plan.md`, `research.md`
**Convention:** `[ID] [P?] description` — `[P]` = parallelizable. Checked = done.

> Look approved from the visual mockup (2026-06-17). Foundation + landing + coverage
> template + section index already landed in the mockup slice. Remaining work below
> completes the full build to the Expressive bar. Live Pages deploy held until done.

## Phase A — Foundation (done in mockup slice)
- [x] A1 App shell: sticky nav, footer, trust/disclaimer, inline-SVG sprite (`index.html`)
- [x] A2 Tokens: display type scale, widths, radii (`css/tokens.css`)
- [x] A3 Stylesheets: `base.css`, `components.css`, `views.css`, `motion.css`
- [x] A4 Helpers: `svg.js`, `icons.js`, `motion.js`, `content.js`
- [x] A5 Router: deep routes (`#/`, sections, `coverage/:id`, qualify, summary) + focus/active-nav

## Phase B — Knowledge hub (mostly done; finish content)
- [x] B1 Landing view (`views/landing.js`): hero + how-it-works + explore + stats + trust + CTA
- [x] B2 Coverage explainer template (`views/coverage.js`): covered/not split, scenario, related
- [x] B3 Section index (`views/section.js`): residential + commercial grids
- [x] B4 Residential scenarios (6) authored in `coverage.json`
- [x] B5 Commercial scenarios (8) authored in `coverage.json` (bop, GL, property, pro-liability,
      workers-comp, cyber, commercial-auto, commercial-umbrella)

## Phase C — Guided qualification (`views/qualify.js`, rebuild)
- [x] C1 Shared `store.js`: in-memory profile/lead state shared qualify → summary
- [x] C2 Branch chooser step: "For my household" / "For my business" as role=button choices
- [x] C3 One-step-at-a-time engine: render `questionnaire.json` steps for the chosen branch,
      options as `.choices .choice`, **auto-advance** on select; store `{value, amount?, professional?}`
- [x] C4 Progress indicator + Back control (`components/progress.js`)
- [x] C5 Inline glossary tooltips on terms (`components/glossary.js`), tap/focus accessible
- [x] C6 Deferred-PII contact step (last): `#contact-name`, `#contact-email`, `#contact-phone`,
      honeypot field; submit button "See my coverage needs"; validate name + (email|phone)
- [x] C7 "Assembling your needs" transition state → route to `#/summary`

## Phase D — Lead summary (`views/summary.js`, rebuild)
- [x] D1 Read profile from store; `fetchRules()` (stub) + `computeNeeds()`; empty state if no profile
- [x] D2 Framed/tiered needs: Essential vs Recommended, each `.need` with rationale (the "why")
- [x] D3 Prominent `.disclaimer` — "a lead summary … not a quote"
- [x] D4 Stub `submitLead()` once; success + `.error` states; partial-lead handling

## Phase E — Wire-up & cleanup
- [x] E1 Router: replace qualify/summary placeholders with real views; nav CTA → role=button
- [x] E2 Remove dead old views (`hub.js`, `placeholder.js`); ensure no orphan imports
- [x] E3 `rules.test.mjs`: extend coverage if answer shape/branches changed

## Phase F — Polish pass (Expressive bar — design.md / research.md Part 2)
- [x] F1 Considered states: empty/loading/success/error across qualify + summary
- [x] F2 Motion + `prefers-reduced-motion` verified on new views
- [x] F3 Responsive + iPad Safari (tap ≥44px, inputs ≥16px, no hover-only); no h-overflow @390
- [x] F4 a11y: focus management, labels, aria-current, contrast

## Phase G — QA & PR
- [x] G1 `node --test js/rules.test.mjs` + `npx html-validate index.html` green
- [x] G2 Playwright S1–S5 green (local render); screenshots to `.agent-reports/`
- [ ] G3 `qa-pipeline` (test-verifier → ui-tester → code review → security if relevant → pr-readiness)
- [ ] G4 ⏸ Pause for user review before merge; on approval, deploy to live Pages (main)
