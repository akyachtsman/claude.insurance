# Plan — Broker-Branded Insurance App (Rebuild)

**Phase:** 3 (plan) · HOW
**Feature slug:** `001-broker-insurance-app`
**Reads:** `spec.md` (incl. §10 Clarifications) + `research.md` (Parts 1 & 2)
**Supersedes:** the original minimal plan for this slug.
**Constitution:** imported directives in `CLAUDE.md` (`global.md`, `design.md`,
`data.md`, `test.md`) are binding. This plan adds **no scope** beyond the spec.

> **Ambition bar (binding):** Expressive Mode, benchmarked to Lemonade + Policygenius.
> Breadth preferred (5 sections + 14 coverages). Not trimmed to a minimal MVP. The
> finish line is `research.md` Part 2's polish bar, not "passes tests."

---

## 1. Stack & key decisions (with trade-offs)

| Decision | Choice | Why / trade-off |
|---|---|---|
| **Framework / build** | **Plain HTML + vanilla ES modules, no build step** | Constitution default (`global.md`); zero-config GitHub Pages hosting; full control over inline SVG + motion. Trade-off: we hand-roll a small component layer — mitigated by disciplined `js/components/` structure. |
| **Routing** | **Hash router** (extend existing `main.js`) | Hash works on GitHub Pages with no server rewrites; existing pattern. Extend to deep, shareable routes (FR-X7). Trade-off: hash URLs over clean paths — acceptable for Pages. |
| **Iconography** | **Inline SVG `<symbol>` sprite in `index.html`, referenced via `<use>`** | Author-controlled static markup (not user data) → **no runtime `innerHTML`** (FR-X4); cached once; one icon per concept (FR-X5). Trade-off: sprite lives in the shell — kept organized + commented. |
| **Illustration** | **Inline SVG built via a `createElementNS` helper** (`js/svg.js`) for hero/section art | Keeps the innerHTML ban intact; owned/in-repo (C-Q5); themeable via `currentColor`/tokens. Trade-off: more verbose than raw SVG strings — helper keeps it terse. |
| **Motion** | **IntersectionObserver scroll-reveal + count-up**, `prefers-reduced-motion`-gated (`js/motion.js`) | Tasteful reveals per `design.md`; reduced-motion → reveal immediately, no animation (FR-H3/FR-X6/SC8). |
| **Backend** | **STUB `supabase.js` (unchanged) for v1** | C-Q4 "stub first." `submitLead`/`fetchRules` already stubbed; live provisioning is a later pass governed by `data.md`. |
| **Rules engine** | **Reuse `js/rules.js` as-is (pure, thresholds from settings)** | Already constitution-compliant (FR-Q6, SC7). Extend only if questionnaire depth changes — additively, thresholds still from `rule-defaults.json`/`rule_settings`. |
| **Data safety** | **`textContent` only via `dom.js`; SVG via sprite/`createElementNS`** | `global.md` no-`innerHTML` rule (FR-X4). |
| **CSS** | **Split token + layered stylesheets, linked in `index.html`** | No bundler, so multiple `<link>`s: `tokens.css` (extended) + `base.css` + `components.css` + `views.css` + `motion.css`. Trade-off: a few more requests — fine for a static site, clearer than one mega-file. |

## 2. Constitution check
- `global.md`: plain HTML/JS, no framework/build ✓; `textContent` only ✓; `claude/`
  branch + PR-to-main + Pre-Push gate ✓.
- `design.md`: **Expressive Mode** (hero, display scale `--font-3xl…6xl`, inline-SVG
  icons/imagery, section rhythm, considered states, `prefers-reduced-motion`) ✓;
  `slate-blue` tokens retained ✓; tap targets ≥44px, inputs ≥16px, no hover-only ✓;
  editorial voice + number/date formatting via `format.js` ✓.
- `data.md`: STUB now; when provisioned — anon key only, RLS INSERT-only on `leads`, no
  SELECT, secrets server-side in `notify-lead` ✓ (deferred pass).
- `test.md`: `node --test` for rules; html-validate; Playwright S1–S5; reports to
  `.agent-reports/` ✓.
- **No violations.** No service-role key client-side; no new secrets; no scope beyond spec.

## 3. Architecture & file layout

```
index.html            app shell: <header> site nav, <main id="app">, <footer> trust strip,
                       + inline SVG <symbol> sprite (icons). data-theme="slate-blue".
css/
  tokens.css          + Expressive display scale (--font-3xl..6xl), section/full-bleed widths
  base.css            reset, typography, base layout, a11y (focus, reduced-motion base)
  components.css       buttons, cards, hero, section bands, stat/trust strips, accordion,
                       progress, choice controls, tooltip, form fields
  views.css           per-view layout (landing, section index, coverage, qualify, summary)
  motion.css          scroll-reveal/transition classes (paired with js/motion.js)
js/
  main.js             router (extended routes + focus mgmt + scroll restore)
  dom.js              (keep) el/clear/mount — textContent-only
  svg.js              NEW createElementNS helpers: svg(), useIcon(name)
  icons.js            NEW concept→symbol-id registry (one icon per coverage + UI)
  motion.js           NEW IntersectionObserver reveal + count-up, reduced-motion aware
  format.js           (keep/extend) currency, ranges, plurals — editorial formatting
  rules.js            (keep) computeNeeds(profile, settings); extend additively if needed
  rules.test.mjs      (extend) cover new/branch cases
  supabase.js         (keep) STUB fetchRules/submitLead; lead shape documented
  content.js          NEW small loader/cache for content/*.json (fetch once, memoize)
  components/
    layout.js         site header/nav (active state), footer + trust strip, page chrome
    hero.js           hero(headline, promise, cta, illustration)
    sections.js       sectionBand(), howItWorks(), statStrip(), featureGrid()
    card.js           coverageCard(), needCard()
    accordion.js      FAQ / "how it compares" / anchored sub-sections
    trust.js          recurring "lead not a quote / anonymous / no data sale" strip
    glossary.js       inline term tooltip (tap + focus accessible)
    progress.js       questionnaire progress + back control
  views/
    landing.js        NEW expressive home (hero → how-it-works → bands → stats → trust → CTA)
    section.js        NEW residential/commercial index (intro + coverage card grid)
    coverage.js       NEW data-driven explainer (multi-section + anchors + inline compare + CTA)
    qualify.js        REBUILT state machine (deferred-PII, inline glossary, progress/back,
                       honeypot, "assembling your needs" transition)
    summary.js        REBUILT framed/tiered needs result (rationale shown) + disclaimer + submit
content/
  coverage.json       EXTEND: add `scenario` (+ optional `comparesWith`, `iconKey`) per 14
  questionnaire.json  EXTEND: deepen to ~6–10 steps/branch; per-step glossary refs
  rule-defaults.json  (keep) thresholds the engine reads
```

## 4. Routing map (hash; deep-linkable — FR-X7)
| Route | View | Notes |
|---|---|---|
| `#/` (and empty) | `landing` | New default (was `#/hub`). |
| `#/residential` | `section` | Residential index (6 coverages). |
| `#/commercial` | `section` | Commercial index (8 coverages). |
| `#/coverage/:id` | `coverage` | One of 14; reads `coverage.json`; unknown id → section/landing. |
| `#/qualify` | `qualify` | Optional `?domain=` / `?from=` to carry hub context (S-K4/FR-K4). |
| `#/summary` | `summary` | Needs result + lead submit. |

Router adds: move keyboard focus to the view heading on change (a11y), scroll-to-top,
graceful unknown-route fallback (existing try/catch kept).

## 5. Data shapes
- **Coverage (extended)** — existing fields + `scenario: string` (a "what-if" with a
  dollar anchor, plain language), optional `comparesWith: [{id, how}]` (inline contrast,
  C-Q8), optional `iconKey: string`. No user data → render still via `textContent`.
- **Questionnaire** — existing branch/step schema; steps gain optional `glossary: [term]`
  for inline tooltips; ~6–10 steps/branch (C-Q9). Commercial keeps industry-first step
  with curated ~8–12 list.
- **Profile** (in-memory) — `{ domain, answers: { [stepId]: {value, amount?, professional?} } }`
  (unchanged shape consumed by `rules.js`).
- **Lead** (to `submitLead`) — `{ domain, answers, needs, contact:{name, email?, phone?},
  meta:{ submittedAt, partial:boolean } }`. Honeypot validated client-side before submit;
  usable-lead minimum = name + (email|phone) + domain (FR-L4).

## 6. Expressive design system (how we hit the bar)
- **Type:** add display scale to `tokens.css` (`--font-3xl:30 / 4xl:40 / 5xl:56 /
  6xl:72`), weight 600, line-height 1.05–1.15 for hero/section openers (`design.md`).
- **Color:** keep the single `slate-blue` accent for action/identity only; depth from
  background variation (`--color-bg`/`--color-surface`/`--color-accent-light`) per band.
  A slightly deeper Commercial sub-register via background/accent-light layering (no new
  accent) per `research.md` Coalition note.
- **Sections:** full-bleed bands with generous rhythm; alternating backgrounds;
  one-idea-per-band landing (research Part 2 polish bar #2).
- **Icons/illustration:** one inline-SVG icon per coverage + UI set (sprite); 2–4 larger
  hero/section illustrations built with `svg.js`, colored via tokens/`currentColor`.
- **Motion:** scroll-reveal fade/slide-up on bands; animated stat count-up; the qualify→
  summary "assembling your needs" transition (considered loading state). All gated by
  `prefers-reduced-motion`.
- **States:** designed empty (no needs yet), loading (assembling), success (lead sent),
  and error (`.error`) states — SC5.

## 7. Requirements → design trace (coverage check)
- Landing FR-H1/H2/H3 → `views/landing.js` + `components/{hero,sections,trust}.js` + motion.
- Hub FR-K1…K6, S-K1…K5 → `views/section.js`, `views/coverage.js`, extended
  `coverage.json` (scenario + inline compare), accordion/anchors, CTA into qualify.
- Qualify FR-Q1…Q7, S-Q1…Q6 → rebuilt `views/qualify.js` + `progress.js` + `glossary.js`
  + honeypot; deepened `questionnaire.json`; `rules.js` reused.
- Summary FR-L1…L5, S-L1…L5 → rebuilt `views/summary.js` (framed/tiered + rationale +
  disclaimer) + `supabase.js` stub submit + lead shape.
- Cross-cutting FR-X1…X7 → anonymous (no auth code), US copy, `slate-blue`,
  `textContent`/sprite, reduced-motion, deep routes.
- Tests SC6/SC7/SC8 → `rules.test.mjs`, html-validate, Playwright S1–S5, reduced-motion check.

## 8. Build sequencing (phase 4 `tasks` will expand; ambition NOT trimmed)
A deliberate order that keeps the app runnable at each step — *all of it ships in v1*:
1. **Foundation** — extend `tokens.css` (display scale) + `base.css`; app shell
   (header/nav/footer/sprite); `svg.js`, `icons.js`, `motion.js`, `content.js`; extend router.
2. **Knowledge hub** — `coverage.json` scenarios (×14) + `section.js` + `coverage.js`
   (data-driven, the reusable template) + components (card, accordion, trust).
3. **Landing** — `landing.js` + hero/sections/stat-strip/trust, wired to hub + qualify.
4. **Qualification** — rebuilt `qualify.js` (deferred-PII, progress/back, inline
   glossary, honeypot, transition); deepen `questionnaire.json`; extend `rules.js`/tests.
5. **Summary** — rebuilt framed/tiered result + rationale + disclaimer + stub submit.
6. **Polish pass** — motion/reduced-motion, empty/loading/success/error states,
   responsive + iPad Safari, a11y/focus, against the Lemonade/Policygenius bar (SC5).
7. **QA** — `qa-pipeline` (test-verifier → ui-tester S1–S5 → code review → security if
   relevant → pr-readiness); html-validate + rules tests in Pre-Push gate.

## 9. Risks & mitigations
- **Expressive bar vs vanilla effort** → component layer + design tokens keep it DRY;
  reuse one coverage template for all 14.
- **Motion/perf on iPad Safari** → IntersectionObserver (well-supported), reduced-motion
  fallback, lazy-reveal; no heavy libs.
- **Content authoring volume (14 scenarios)** → schema-driven; author in `coverage.json`,
  one template renders all.
- **Scope creep** → plan traces strictly to spec; contrast = inline (C-Q8), no asset
  protection (v2), no backend build (C-Q4).

## 10. Out of scope (restate)
Asset protection (v2); payments/purchase/binding/real-time quoting; broker UI; accounts/
login; live Supabase provisioning (separate follow-up pass); contrast-pair pages;
non-US framing.

**Phase 3 complete. ⏸ Awaiting user approval before Phase 4 (`tasks`) + Phase 6
(`implement`).**
