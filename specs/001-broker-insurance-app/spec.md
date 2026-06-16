# Spec — Broker-Branded Insurance App

**Phase:** 1 (specify) · WHAT & WHY only
**Feature slug:** `001-broker-insurance-app`
**Inputs:** product brief (2026-06-16) + `research.md` (competitive discovery)
**Constitution:** the imported directives in `CLAUDE.md` (`global.md`, `design.md`,
`test.md`, `data.md`) are binding. Relevant here: plain HTML+JS default, must work
on iPad Safari, plain-language editorial voice and number/date formatting
(`design.md`), `textContent` for any backend/user data, backend governed by
`data.md` (Supabase, RLS always on) **if** persistence is needed.

---

## 1. Vision & Why
A broker-branded web app that **educates and qualifies prospects into leads**, then
helps signed customers **inventory and protect their assets** — converting on the
way in, retaining and cross-selling after. It gives a single broker a credible,
self-serve digital storefront that (a) teaches prospects what coverage means in
plain language, (b) turns that interest into a structured lead the broker can act
on, and (c) keeps existing clients engaged by surfacing under-insurance gaps across
their assets.

**Why it matters:** discovery confirmed competitors do education→lead well but
*none* offers a portfolio-level asset inventory with automated under-insurance
flags — that retention/cross-sell layer is the differentiator. The qualification
output is explicitly a **lead summary, not a bound policy** (no binding, payments,
or real-time quoting), which keeps the broker in the loop as the trusted human.

## 2. Users & Roles
- **Prospect (primary):** an unconverted visitor exploring coverage. Uses the
  knowledge hub and qualification questionnaire. Largely anonymous.
- **Insured client (primary):** a signed customer of the broker. Uses asset
  protection (and may revisit the hub). Requires an identity/account.
- **Broker (secondary):** receives and reviews lead summaries; may review client
  asset profiles. `[NEEDS CLARIFICATION: is a broker-facing review surface in scope
  for v1, or does the lead summary just get delivered (email/export) with no broker
  UI? — brief open item]`

## 3. Top-level structure
Two domains, each spanning the three facets:
- **Residential** — home, auto.
- **Commercial** — business.

## 4. Scope & phasing
Per product decision (phased MVP):
- **MVP (v1):** Facet A (Knowledge hub) + Facet B (Qualification → lead). The
  public-first acquisition loop.
- **Fast-follow (v2):** Facet C (Asset protection), the post-signup retention layer
  (depends on accounts/persistence).

This spec covers all three facets; requirements are tagged **[v1]** or **[v2]**.

## 5. Non-goals (MVP and product-wide)
- **No policy binding or purchase.** Qualification yields a lead, never a policy.
- **No payments / no premium collection.**
- **No real-time quoting** or carrier rate integration. Any figures shown are
  educational ranges, clearly labelled as not quotes.
- **No Supabase Auth / no third-party identity provider assumed** unless `clarify`
  decides accounts are needed (see FR-C and clarifications).
- **No native mobile app** — responsive web only (iPad Safari is a hard target).
- **No multi-broker / multi-tenant marketplace** — single broker brand.

## 6. User stories
**Knowledge hub [v1]**
- S-A1: As a prospect, I can browse coverage topics split into Residential and
  Commercial so I can learn what's relevant to me.
- S-A2: As a prospect, I can read a plain-language explainer for a specific coverage
  (what it covers, what it doesn't, who needs it) so I understand it without jargon.
- S-A3: As a prospect, I can follow a curated path through related topics rather than
  hunting through a flat list.
- S-A4: As a prospect, I can move from any explainer into the qualification
  questionnaire so learning leads to action.

**Qualification → lead [v1]**
- S-B1: As a prospect, I can start a guided questionnaire that routes me to
  Residential or Commercial and asks only relevant questions.
- S-B2: As a commercial prospect, the questionnaire tailors itself to my
  business/industry early so the questions fit what I do.
- S-B3: As a prospect, I answer one focused step at a time with terms explained
  inline, and I see progress.
- S-B4: As a prospect, low-commitment context is asked first and personal/contact
  details only once I've shown intent.
- S-B5: As a prospect, at the end I receive a clear summary of my identified
  needs/gaps, presented as prioritized recommendations — explicitly framed as a
  lead for the broker to follow up, not a quote or bound policy.
- S-B6: As a broker, I receive a structured lead summary (the prospect's answers +
  identified needs/gaps + contact details) so I can follow up.
- S-B7: As a prospect who abandons partway, my partial answers still produce a
  usable lead where contact info was captured.

**Asset protection [v2]**
- S-C1: As an insured client, I can add assets (home, vehicles, valuables, business
  equipment) to a personal inventory.
- S-C2: As an insured client, each asset gets a protection suggestion: recommended
  coverages, gaps, and under-insurance flags.
- S-C3: As an insured client, I can see a portfolio-level overview of where I'm
  likely under-insured across all assets.
- S-C4: As a broker, I can see a client's asset profile and gap flags to drive
  cross-sell. `[NEEDS CLARIFICATION: depends on broker-surface decision in §2]`

## 7. Functional requirements (testable)
Knowledge hub **[v1]**
- FR-A1: The hub MUST present coverage content organized under two sections,
  Residential (home, auto) and Commercial (business).
- FR-A2: Each coverage topic MUST have a structured explainer with, at minimum:
  definition, what it covers, what it does not, and who typically needs it.
- FR-A3: Content MUST follow the design directive's editorial rules (plain language,
  active voice, no jargon; number/date formatting per `design.md`).
- FR-A4: Every explainer MUST offer a path into the qualification questionnaire.
- FR-A5: Content MUST render correctly and be navigable on iPad Safari.
- FR-A6: `[NEEDS CLARIFICATION: how many coverage topics ship in v1, and which? e.g.
  home, auto, BOP, general liability — and is content authored by the broker or
  seeded by us?]`

Qualification → lead **[v1]**
- FR-B1: The questionnaire MUST route the user into a Residential or Commercial
  branch and ask only branch-relevant questions.
- FR-B2: The Commercial branch MUST capture business/industry early and adapt
  subsequent questions to it. `[NEEDS CLARIFICATION: granularity of industry list —
  a short curated set vs. a long trade taxonomy?]`
- FR-B3: The questionnaire MUST present one focused step at a time, explain key terms
  inline, and show progress.
- FR-B4: Contact/personal details MUST be requested only after substantive
  qualification questions (deferred-PII ordering).
- FR-B5: On completion the app MUST produce a prioritized needs/gaps summary for the
  user, explicitly labelled as a lead (not a quote/policy/binding).
- FR-B6: The app MUST produce a broker-facing lead summary containing the prospect's
  answers, identified needs/gaps, and captured contact details.
- FR-B7: The lead summary MUST be delivered to the broker. `[NEEDS CLARIFICATION:
  delivery mechanism — in-app queue, email, export/download? requires backend? —
  brief open item]`
- FR-B8: A partial completion with captured contact info MUST still yield a lead.
  `[NEEDS CLARIFICATION: minimum fields that constitute a usable lead]`
- FR-B9: Needs/gap identification MUST use defined rules. `[NEEDS CLARIFICATION:
  fixed rules vs. broker-configurable thresholds? — brief open item]`
- FR-B10: The questionnaire MUST be operable on iPad Safari (tap targets, no
  hover-only states, ≥16px inputs per `design.md`).

Asset protection **[v2]**
- FR-C1: A client MUST be able to create assets in categories: home, vehicle,
  valuable, business equipment.
- FR-C2: Asset entry method `[NEEDS CLARIFICATION: manual entry only for v2, vs.
  import (photos/receipts/integrations)? — brief open item]`.
- FR-C3: Each asset MUST receive a protection suggestion (recommended coverages,
  gaps, under-insurance flag) from defined rules (ties to FR-B9 decision).
- FR-C4: The app MUST present a portfolio-level under-insurance overview.
- FR-C5: Asset data persistence and access MUST follow `data.md` (Supabase, RLS
  always on; service-role key server-side only). `[NEEDS CLARIFICATION: confirm
  persistence/account model — see cross-cutting below]`

Cross-cutting
- FR-X1 (accounts): `[NEEDS CLARIFICATION: identity model — hub + questionnaire fully
  anonymous; account introduced only at asset protection? what auth method (e.g.
  PIN/login per data.md client-auth pattern)? — brief open item]`
- FR-X2 (geography): `[NEEDS CLARIFICATION: target market/region? affects coverage
  terminology, "minimum vs adequate" rules, and examples — references are US-centric]`
- FR-X3 (branding/theme): the app MUST set a `data-theme` on root `<html>` from
  `design.md`'s color schemes. `[NEEDS CLARIFICATION: which Design Theme? CLAUDE.md
  field is still a placeholder]`
- FR-X4 (data safety): any backend/user-supplied text rendered in the DOM MUST use
  `textContent`, never `innerHTML` (per `global.md`).

## 8. Success criteria
- SC1 [v1]: A prospect can go end-to-end — land → learn a coverage topic → complete
  the questionnaire → see a needs summary — on iPad Safari without dead-ends.
- SC2 [v1]: A completed questionnaire produces a broker lead summary that contains
  the answers, prioritized needs/gaps, and contact details.
- SC3 [v1]: The needs summary never presents itself as a quote, price, or bound
  policy (label/verifiable copy check).
- SC4 [v1]: Knowledge hub explainers exist for the agreed v1 coverage set, each with
  the FR-A2 structure, passing the editorial/formatting rules.
- SC5 [v2]: An insured client can inventory assets across all four categories and see
  per-asset gap flags plus a portfolio under-insurance overview.
- SC6 [all]: UI conforms to `design.md` (components, spacing, tap targets) with the
  chosen theme applied; passes the generic S1–S4 UI suite plus project scenarios.

## 9. Open clarifications (consolidated — for Phase 2)
1. **Accounts/auth model** (FR-X1) — anonymous hub+questionnaire; account only at
   asset protection? Which auth method?
2. **Broker surface** (§2, S-C4, FR-C4) — broker-facing review UI in scope, or
   delivery-only for v1?
3. **Lead delivery mechanism** (FR-B7) — in-app queue / email / export? Backend
   required?
4. **Asset entry** (FR-C2) — manual only vs. import for v2.
5. **Suggestion rules** (FR-B9, FR-C3) — fixed heuristics vs. broker-configurable.
6. **Geographic scope** (FR-X2) — target market/region.
7. **v1 coverage set & content source** (FR-A6) — which topics ship; broker-authored
   vs. seeded.
8. **Commercial industry granularity** (FR-B2) — curated short list vs. long taxonomy.
9. **Usable-lead minimum** (FR-B8) — required fields for a partial lead.
10. **Design Theme** (FR-X3) — which scheme from `design.md`.
