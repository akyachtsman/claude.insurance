# Spec — Broker-Branded Insurance App (Rebuild)

**Phase:** 1 (specify) · WHAT & WHY only
**Feature slug:** `001-broker-insurance-app`
**Inputs:** rebuild product brief (2026-06-17) + `research.md` (competitive discovery,
Parts 1 & 2)
**Supersedes:** the original minimal spec/plan/tasks for this slug. `research.md` and
`test-harness-hardening.md` are retained; this is a from-scratch, far more ambitious
front-end. Existing scaffold (CLAUDE.md, `.github` workflows, `.claude` settings,
Playwright kit) and `content/*.json` are kept.
**Constitution:** the imported directives in `CLAUDE.md` (`global.md`, `design.md`,
`test.md`, `data.md`) are binding. Most load-bearing here: **`design.md` → Expressive
Mode** (real hero/landing, display type scale, inline-SVG iconography + imagery,
polished multi-section pages, tasteful scroll motion, `prefers-reduced-motion`); plain
HTML + vanilla ES modules default with no framework/build (`global.md`); `textContent`
for any user/backend data; iPad Safari a hard target; backend governed by `data.md`
(Supabase, RLS always on; service-role server-side only).

---

## 1. Vision & Why
A **broker-branded insurance app that educates and qualifies prospects into leads** —
and is a genuinely impressive, modern web experience, **not a utility form**. It gives a
single broker a credible, premium digital storefront that (a) makes a strong first
impression with a real landing/home, (b) teaches prospects what coverage means through a
deep, polished knowledge hub spanning Residential and Commercial, and (c) turns that
interest into a structured **lead summary** the broker can act on.

**Why it matters:** discovery (Part 1) confirmed competitors do education→lead well, but
the bar for *this* build (Part 2) is the **experiential craft** of Lemonade and
Policygenius — hero treatment, layout richness, imagery, and motion — applied to a
broker's own storefront. The differentiator is a continuous, trustworthy, **expressive**
funnel (learn → qualify → lead) that no single broker site delivers end-to-end. The
qualification output is explicitly a **lead summary, not a bound policy** (no binding,
payments, or real-time quoting), keeping the broker the trusted human in the loop.

**Ambition bar (binding, carried into plan & implement):** very elaborate, intricate,
multi-page, **expressive**. Match the polish and depth of **Lemonade** and
**Policygenius** (patterns, not copies). This is the standard the build is held to —
**do not trim it to a minimal MVP.** "Passes tests" is not the finish line; the finish
line is the polish bar in `research.md` Part 2 and `design.md` Expressive Mode.

## 2. Users & Roles
- **Prospective client (primary):** an unconverted visitor exploring coverage. Uses the
  landing, knowledge hub, and qualification flow. **Anonymous** (no login).
- **Existing client (primary):** a current client of the broker, returning to learn or
  re-qualify. Also anonymous in v1.
- **Broker (secondary):** receives structured lead summaries (via persisted lead +
  email notification). **No broker-facing UI in v1** (delivery only) — inherited from
  CLAUDE.md security model.

## 3. Top-level structure
Five first-class sections (the spine of the app):
1. **Landing / Home** — a real expressive landing: hero, "how it works", section
   bands, a trust/proof strip, and a recurring trust/disclaimer component.
2. **Residential** — a deep section covering **home, auto, renters, umbrella, life,
   flood**.
3. **Commercial** — a deep section covering **BOP, general liability, commercial
   property, professional liability, workers' comp, cyber, commercial auto, umbrella**.
4. **Guided qualification flow** — branched, deferred-PII, one-step-at-a-time.
5. **Lead summary** — prioritized needs/gaps result, framed as a lead (not a quote).

## 4. Scope & phasing
- **v1 (this build):** all five sections above, at the Expressive ambition bar.
- **v2 (out of scope here):** **Asset protection** (portfolio asset inventory +
  per-asset under-insurance flags). Explicitly deferred per the rebuild brief.

## 5. Non-goals (v1)
- **Asset protection** — deferred to v2.
- **No in-app purchase, payments, or premium collection.**
- **No real-time quoting** or carrier rate integration. Any figures are educational
  ranges/examples, clearly labelled as **not quotes**.
- **No policy binding.** Qualification yields a lead, never a policy.
- **No broker-facing UI** — broker consumes leads via database + email.
- **No login / accounts** — the app is fully anonymous in v1.
- **No native mobile app** — responsive web only (iPad Safari is a hard target).
- **No multi-broker / multi-tenant marketplace** — single broker brand.
- **No real photography licensing or external image/icon CDNs** assumed — imagery is
  owned/inline (see FR-X5 / clarification). `[NEEDS CLARIFICATION: confirm imagery
  strategy — see Q5]`

## 6. User stories

**Landing / home (expressive first impression)**
- S-H1: As a visitor, I land on a polished hero with one clear promise and one primary
  call to action, so I immediately understand what the app offers and what to do next.
- S-H2: As a visitor, I can scan a "how it works" narrative (learn → see your needs →
  connect with a licensed broker) so the journey is legible before I commit.
- S-H3: As a visitor, I see trust/proof and an explicit, plain statement that this
  produces a **lead summary, not a quote**, and that I'm anonymous and my data isn't
  sold — so I trust the funnel.
- S-H4: As a visitor, I can enter either the knowledge hub or the qualification flow
  directly from the landing.

**Knowledge hub [Residential + Commercial]**
- S-K1: As a visitor, I can browse coverage organized into two parallel sections —
  Residential and Commercial — with the same mental model in each.
- S-K2: As a visitor, I can open a polished, consistent explainer for any of the 14
  coverages: what it is, what it covers, what it does **not** cover, who needs it, what
  to consider, a real-world scenario, and related coverages.
- S-K3: As a visitor, I can disambiguate confusable coverages via contrast-pair framing
  (e.g. collision vs comprehensive, term vs whole life, general liability vs
  professional liability). `[NEEDS CLARIFICATION: are dedicated contrast-pair pages in
  v1, or is contrast handled inline within explainers? — Q8]`
- S-K4: As a visitor, I can move from any explainer into the qualification flow, with
  relevant context carried over, so learning leads to action.
- S-K5: As a visitor on a long explainer, I can navigate within it (section anchors)
  and the page reads as a polished multi-section page, not a wall of text.

**Guided qualification → lead**
- S-Q1: As a visitor, I can start a guided flow that routes me to Residential or
  Commercial and asks only relevant questions.
- S-Q2: As a commercial visitor, the flow captures my industry/profession early and
  adapts subsequent questions and likely coverages to it.
- S-Q3: As a visitor, I answer one focused step at a time, with key terms explained
  inline, and I can see progress and go back.
- S-Q4: As a visitor, low-commitment context is asked first; my name and contact
  details are requested only at the **final** step (deferred PII).
- S-Q5: As a visitor, between finishing the questions and seeing my result, I get a
  brief, designed "assembling your needs" moment so the result feels earned.
- S-Q6: As a visitor, the flow protects against trivial bots without adding friction for
  me (honeypot), per the inherited security model.

**Lead summary (result)**
- S-L1: As a visitor, I receive a clear, prioritized summary of my identified
  needs/gaps, presented as framed recommendations (e.g. essential vs recommended) with
  the **rationale shown**, not a flat list.
- S-L2: As a visitor, the summary explicitly states it is a **lead for the broker to
  follow up — not a quote, price, or bound policy.**
- S-L3: As a visitor, my completed responses + identified needs + contact details are
  submitted so the broker receives a usable lead.
- S-L4: As a broker, I receive a structured lead summary (responses + needs/gaps +
  contact details) via the inherited delivery path (persisted lead + email).
- S-L5: As a visitor who provided contact info but didn't answer everything, my partial
  responses still produce a usable lead. `[NEEDS CLARIFICATION: confirm minimum fields
  for a usable lead carry over from prior decision — Q6]`

## 7. Functional requirements (testable)

**Landing / home**
- FR-H1: The app MUST present a landing/home with, at minimum: a hero (display headline
  + one-line promise + primary CTA + supporting visual), a "how it works" section, at
  least one value/feature section band, a trust/proof element, and entry points to both
  the hub and the qualification flow.
- FR-H2: The landing MUST include a visible, plain-language statement that the output is
  a lead summary (not a quote) and that use is anonymous / data is not sold.
- FR-H3: The landing MUST meet `design.md` Expressive Mode (display type scale,
  inline-SVG visual, section rhythm, considered states) and `prefers-reduced-motion`
  MUST disable non-essential motion.

**Knowledge hub**
- FR-K1: The hub MUST organize coverage under two parallel sections — Residential
  (home, auto, renters, umbrella, life, flood) and Commercial (BOP, general liability,
  commercial property, professional liability, workers' comp, cyber, commercial auto,
  umbrella) — **14 coverages total**, all present in v1.
- FR-K2: Each coverage MUST render a structured explainer driven by content data
  (`content/coverage.json`), including at minimum: definition, what it covers, what it
  does not cover, who needs it, what to consider, and related coverages. A real-world
  **scenario** SHOULD be included. `[NEEDS CLARIFICATION: are scenarios authored for all
  14 in v1, or a subset — Q7]`
- FR-K3: Content rendering MUST follow `design.md` editorial rules (plain language,
  active voice, no jargon; number/date formatting per `design.md`).
- FR-K4: Every explainer MUST offer a path into the qualification flow.
- FR-K5: Explainer and hub pages MUST render and navigate correctly on iPad Safari.
- FR-K6: Coverage explainers MUST be presented as polished multi-section pages with
  in-page navigation/anchors (per Expressive Mode), not a single undifferentiated block.

**Guided qualification → lead**
- FR-Q1: The flow MUST route into a Residential or Commercial branch and ask only
  branch-relevant questions.
- FR-Q2: The Commercial branch MUST capture industry/profession early and adapt
  subsequent questions to it. Industry granularity is a **curated short list** (~8–12
  categories) — inherited decision; reconfirm if changed. `[NEEDS CLARIFICATION: confirm
  the residential/commercial question depth target for the rebuild — Q9]`
- FR-Q3: The flow MUST present one step at a time, explain key terms inline, show a
  progress indicator, and allow back/forward navigation.
- FR-Q4: Personal/contact details MUST be requested only after substantive
  qualification questions (deferred-PII ordering); contact is the final step.
- FR-Q5: The flow MUST include a bot honeypot field per the inherited security model and
  MUST NOT require a login.
- FR-Q6: Needs/gap identification MUST use the pure rules engine (`js/rules.js`) reading
  **broker-editable thresholds** from settings/defaults — never hard-coded constants
  (inherited decision; `rule-defaults.json` / `rule_settings`).
- FR-Q7: The flow MUST render and operate on iPad Safari (tap targets ≥44px, no
  hover-only states, inputs ≥16px per `design.md`).

**Lead summary**
- FR-L1: On completion the app MUST produce a prioritized needs/gaps summary for the
  user, presented as framed/tiered recommendations with rationale (not a flat list).
- FR-L2: The summary MUST be explicitly labelled as a lead — not a quote, price, or
  bound policy (verifiable copy/disclaimer check; `.disclaimer` present).
- FR-L3: The app MUST produce and submit a broker-facing lead containing the user's
  responses, identified needs/gaps, and captured contact details.
- FR-L4: A lead is usable with **name + one contact method (email or phone) + domain
  (residential/commercial)** (inherited decision); a partial completion meeting this
  MUST still yield a lead.
- FR-L5: Lead submission MUST follow `data.md` — anon/publishable key, INSERT-only into
  `leads` under RLS, no SELECT; secrets server-side only. `[NEEDS CLARIFICATION: is
  Supabase provisioned for this build, or does v1 ship against the STUB client first —
  Q4]`

**Cross-cutting**
- FR-X1 (anonymity): hub, qualification, and lead MUST be fully usable without any
  login/account (inherited decision).
- FR-X2 (geography): coverage terminology, "minimum vs adequate" framing, and examples
  are **US-oriented** (inherited decision).
- FR-X3 (theme): the app MUST set `data-theme="slate-blue"` on root `<html>`
  (inherited decision; CLAUDE.md Design Theme).
- FR-X4 (data safety): any backend/user-supplied text rendered in the DOM MUST use
  `textContent`, never `innerHTML` (per `global.md`).
- FR-X5 (imagery): iconography and imagery MUST be **inline SVG / owned assets** — no
  icon fonts, no external image/icon CDNs (per `design.md`; GitHub Pages hosting).
  `[NEEDS CLARIFICATION: confirm in-repo inline-SVG illustration/iconography is the
  imagery strategy (vs. licensed photography) — Q5]`
- FR-X6 (motion): all non-essential motion MUST honor `prefers-reduced-motion`.
- FR-X7 (routing): the app MUST support deep-linkable views (landing, each section, each
  coverage, the flow, the summary) so content is shareable/navigable.

## 8. Success criteria
- SC1: A visitor can go end-to-end on iPad Safari — land → open a coverage explainer →
  enter and complete the qualification flow → see a needs summary — with no dead-ends.
- SC2: A completed flow produces and submits a broker lead containing responses,
  prioritized needs/gaps, and contact details.
- SC3: The needs summary never presents itself as a quote, price, or bound policy
  (verifiable copy/disclaimer check).
- SC4: Knowledge-hub explainers exist for **all 14** coverages, each with the FR-K2
  structure, passing the editorial/formatting rules.
- SC5: The landing and section pages meet `design.md` Expressive Mode and the
  `research.md` Part 2 polish bar (real hero, section rhythm, inline-SVG
  iconography/imagery, considered empty/loading/success states, tasteful motion) —
  judged against the Lemonade/Policygenius reference bar, not mere functionality.
- SC6: UI conforms to `design.md` (components, spacing, tap targets) with `slate-blue`
  applied; passes the generic S1–S4 UI suite plus project scenario S5.
- SC7: `js/rules.js` unit tests pass (`node --test js/rules.test.mjs`) and thresholds
  come from settings/defaults, not hard-coded constants.
- SC8: `prefers-reduced-motion` disables non-essential motion (verifiable).

## 9. Open clarifications (consolidated — for Phase 2)
Most v1 product decisions are **inherited** (anonymous; slate-blue; broker-editable
rules; US; lead delivery = persisted lead + broker email; no broker UI; usable-lead
minimum). The genuinely open items for the *rebuild* are:
1. **Q4 — Backend timing (FR-L5):** build the front-end first against the existing
   **STUB** Supabase client (per CLAUDE.md "provisioning deferred"), or provision
   Supabase as part of this build so lead submit is live at first merge?
2. **Q5 — Imagery strategy (FR-X5, non-goals):** confirm **in-repo inline-SVG
   illustration + iconography** (no stock licensing, no external image CDNs) as the
   imagery approach for Expressive Mode.
3. **Q7 — Coverage depth (FR-K2):** full template incl. authored **scenario** for all
   14 coverages in v1, or scenarios for a deep subset with the rest at the base template?
4. **Q8 — Contrast pairs (S-K3):** dedicated contrast-pair pages as a first-class page
   type in v1, or contrast handled inline within explainers?
5. **Q9 — Questionnaire depth (FR-Q2):** target depth/length of the
   Residential/Commercial question sets for the rebuild (e.g. ~6–10 steps per branch)?
6. **Q6 — Usable-lead minimum (FR-L4):** confirm the inherited minimum (name + one
   contact + domain) still holds for the rebuild.
7. **Q-ambition — Reference confirmation:** confirm Lemonade + Policygenius remain the
   binding polish bar, and that breadth (all 5 sections + 14 coverages) is preferred
   over going deeper on fewer (no MVP-trimming).

> Phase 2 (`clarify`) will resolve these with the user and append a `## Clarifications`
> section before any planning. **Build pauses here for the user.**

---

## 10. Clarifications (Phase 2 — resolved 2026-06-17)

Resolved with the user (AskUserQuestion). Items not explicitly asked were resolved to
their stated default and are recorded here as decisions.

**Explicitly decided (rebuild):**
- **C-Q4 — Backend timing (FR-L5):** **Stub first.** Build the full Expressive
  front-end against the existing **STUB** Supabase client; lead submit is exercised in
  the UI but not persisted yet. Real Supabase provisioning (leads + rule_settings
  migration, RLS anon-INSERT-only, `notify-lead` Edge Function) is a focused
  **follow-up pass**, not part of this front-end build. Aligns with CLAUDE.md
  "provisioning deferred."
- **C-Q5 — Imagery strategy (FR-X5):** **Inline-SVG, owned.** Hand-built inline-SVG
  illustration + one icon per concept, authored in-repo. No icon fonts, no external
  image/icon CDNs, no stock licensing. Warmth carried by custom geometric illustration
  on the `slate-blue` palette.
- **C-Q7 — Coverage depth (FR-K2):** **All 14, full template + scenario.** Every
  coverage ships the complete multi-section treatment including an authored real-world
  "what if" scenario with a dollar anchor. (Most fields already exist in
  `content/coverage.json`; a `scenario` field is added per coverage.)
- **C-Q8 — Contrast pairs (S-K3):** **Inline within explainers.** Disambiguation is a
  "how it compares" section inside each relevant coverage explainer — no dedicated
  contrast-pair page type in v1.

**Resolved to default (override anytime):**
- **C-Q6 — Usable-lead minimum (FR-L4):** unchanged — **name + one contact method
  (email or phone) + domain (residential/commercial)**.
- **C-Q9 — Questionnaire depth (FR-Q2):** target **~6–10 steps per branch**
  (substantive context first, contact last). Commercial industry = curated short list
  (~8–12 categories). Tunable during plan/implement.
- **C-Ambition — Reference bar:** confirmed — **Lemonade + Policygenius** remain the
  binding polish bar; **breadth is preferred** (all 5 sections + 14 coverages) over
  trimming to fewer. No minimal-MVP reduction.

**Requirement adjustments from the above:**
- FR-L5 → v1 ships against the STUB client; live persistence/email deferred to a
  follow-up Supabase pass (still governed by `data.md` when built).
- FR-K2 → a `scenario` field is authored for **all 14** coverages in `coverage.json`.
- S-K3 / FR-K-contrast → contrast handled as an in-explainer section, not a separate
  page; no new routing for contrast pairs.
- FR-X5 → imagery = inline-SVG / owned assets only.

**Phase 2 complete. Next: Phase 3 (`plan`) — pauses for user approval before any build.**
