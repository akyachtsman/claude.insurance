# Competitive Discovery — Broker-Branded Insurance App

**Status:** Discovery (pre-spec). Feeds `/sdd-loop specify`.
**Date:** 2026-06-16
**Product (from brief):** A broker-branded app that (1) **educates** prospects via a
plain-language **knowledge hub** on home/auto/business coverages, (2) **qualifies**
them via a guided questionnaire that identifies needs/gaps and outputs a **lead
summary for the broker** (no binding, no payment, no real-time quoting), and (3)
post-signup offers **asset protection** — inventory assets (home, vehicles,
valuables, business equipment) and surface per-asset suggestions (gaps,
under-insurance flags). Sections: **Residential** (home, auto) and **Commercial**
(business). Primary users: the broker's prospects and existing clients.

## Method & caveats
Eight market leaders analyzed in parallel against a fixed rubric (IA, core flows,
education depth, onboarding/conversion, category tooling, trust, UX strengths /
weaknesses, relevance to our three facets). **Public pages only**; ToS/robots
respected; no auth, no scraping. Most first-party sites returned HTTP 403 to
automated fetches, so findings lean on WebSearch snippets + third-party teardowns
(reviews, UX case studies) cross-referenced against each site's own URL taxonomy.
IA and page-template findings are high-confidence; exact live field-by-field
layouts are inferred, not screenshot-verified. **Patterns are synthesized — no
copy, branding, or visual design is reproduced.**

## Targets
| # | Site | Why chosen | Facet focus |
|---|------|-----------|-------------|
| 1 | Policygenius | Marketplace/broker; education→questionnaire→agent handoff; "Insurance Checkup" needs/gap tool | Knowledge, Qualification, (gap) |
| 2 | NerdWallet Insurance | Gold-standard education taxonomy (personal + business) | Knowledge |
| 3 | The Zebra | Auto/home comparison; ZIP-first questionnaire; glossary/guides | Knowledge, Qualification |
| 4 | Lemonade | Conversational "Maya" onboarding; per-item "Extra Coverage" scheduling | Qualification, Asset protection |
| 5 | CoverWallet (Aon) | Digital SMB broker; coverage×industry IA; conditional gap prompts | Knowledge, Qualification (commercial) |
| 6 | NEXT Insurance | Industry-first SMB questionnaire; by-trade/by-state gap education | Knowledge, Qualification (commercial) |
| 7 | Hiscox | SMB scenario-based education; 20-sec anonymous policy selector; Underinsurance Report | Knowledge, Qualification (commercial) |
| 8 | Insureon | Online agency/broker; single application → agent handoff (closest lead-model analog) | Qualification (commercial lead) |

## Relevance matrix (How strongly each informs our facets)
| Site | (a) Knowledge hub | (b) Qualification→lead | (c) Asset protection | Single most useful idea |
|------|:---:|:---:|:---:|---|
| Policygenius | High | High | Med | "Insurance Checkup" → prioritized **to-do-list** gap output; calculators that **explain the why** |
| NerdWallet | High | High | Low | **One-concept-per-page** template; **contrast-pair** explainers (collision vs comprehensive); separate residential/commercial trees |
| The Zebra | High | High | Low/Med | **ZIP-first, deferred-PII** funnel; **tiered output** (Min/Better/Best/Customize) with one pre-recommended |
| Lemonade | High | High | **Med/High** | **One-question-at-a-time branching** intake; **per-item asset add** (description, value, photo, receipt/appraisal) |
| CoverWallet | Med/High | High | Low/Med | **Dual coverage × industry IA**; conditional gap prompts ("employees → workers' comp"); peer-benchmark nudges |
| NEXT | High | High | Med | **Industry-first questioning**; auto-built recommended coverage package; "minimum vs adequate limits" framing |
| Hiscox | High | High | Low/Med | **Profession-first** personalization; **scenario-driven** education; **20-sec anonymous needs selector** |
| Insureon | High | High | Low/Med | **Implicit-account lead capture** (emailed credential at submit); **agent contact embedded in results** |

## Patterns to adopt, by facet

### (a) Knowledge hub
- **One concept per page, consistent template** (NerdWallet): definition → what it
  covers / doesn't → who needs it → typical cost. Scannable and reusable.
- **Contrast pairs** to disambiguate confusable terms (collision vs comprehensive,
  GL vs workers' comp, MedPay vs PIP).
- **Scenario-driven plain language** (Hiscox, Lemonade): concrete relatable stories
  and dollar anchors instead of jargon.
- **Clean Residential vs Commercial split** (NerdWallet) — distinct mental models,
  cross-linked but not co-mingled. This is the structural spine of our two sections.
- **Coverage × topic foldering** within each section (Lemonade `/explained/category/…`,
  CoverWallet coverage↔industry matrix).
- **Curated guided sequence**, not just an SEO article pile (fixes NerdWallet's
  fragmentation weakness): a recommended learning path per coverage area.

### (b) Qualification → lead
- **Low-friction, deferred-PII start** (The Zebra ZIP-first): open with painless
  context questions; collect contact details only once intent is established.
- **One-question-at-a-time, branching** intake (Lemonade Maya): adapt questions to
  prior answers; explain terms inline at the moment of decision.
- **Industry/profession-first for Commercial** (NEXT, Hiscox, CoverWallet): the
  first commercial question is the trade, which conditions everything after and lets
  us pre-select likely coverages.
- **Conditional gap prompts** (CoverWallet): answers trigger needs flags
  ("you have employees → workers' comp", "you own the building → commercial property").
- **Prioritized to-do-list output** (Policygenius Insurance Checkup) + **tiered
  framing** (The Zebra Min/Better/Best) with one option recommended and the rationale shown.
- **"Minimum vs adequate" gap framing** (NEXT): name the gap between legal minimums
  and real-world adequacy — the core of our under-insurance value.
- **Lead capture that survives drop-off** (Insureon implicit account): persist the
  partial profile so the broker still gets a usable lead summary.
- **Explicit "this is a lead summary, not a quote/bind"** framing — our differentiator
  and a trust safeguard (see pitfalls).

### (c) Asset protection (post-signup)
- **Per-item add flow** (Lemonade Extra Coverage): description, value, photo, and
  receipt/appraisal — a clean, repeatable pattern for our asset inventory.
- **Sublimit / under-insurance messaging** (Lemonade): explain when a category
  exceeds default limits (e.g., jewelry theft sublimit) → drives the per-asset flag.
- **Replacement-cost / coverage-ratio heuristics** (NerdWallet: personal property
  ≈ 50–70% of dwelling) — bake into the gap engine as default rules.
- **Greenfield opportunity (validated across ALL eight):** none offers a true
  **portfolio-level asset inventory with automated per-asset under-insurance flags**.
  This is our clearest differentiation — competitors stop at profile-level or
  item-by-item scheduling without a holistic gap overview.

## Pitfalls to avoid (observed across competitors)
1. **No progress indicator** on long questionnaires → abandonment (Policygenius).
2. **Delayed / email-only / login-gated results** break momentum (Policygenius, Insureon, Zebra).
3. **Speed-over-comprehension**: a 90-second flow can rush users into under-insurance
   they don't understand (Lemonade, NEXT) — our broker-in-the-loop model is the antidote.
4. **Lead-gen trust backlash**: "no spam / no data sale" promises undercut by
   aggressive follow-up (Zebra, CoverWallet). Be explicit and honest about what the
   broker receives and how they'll follow up.
5. **Post-handoff service drop-off / agent churn** (CoverWallet, Policygenius):
   protect the existing-client (asset-protection) experience; set realistic
   ongoing-support expectations.
6. **Conversion-gated education** (CoverWallet, Insureon): keep the knowledge hub
   genuinely open and broker-neutral — no quote wall.
7. **No personalization/memory** of what a user read or owns (NerdWallet) — we can
   connect hub → questionnaire → asset profile into one continuous, remembered journey.

## Recommended starting version (hybrid)
A **continuous funnel** that no single competitor offers end-to-end, assembled from
the best-fit patterns:

1. **Knowledge hub (NerdWallet structure + Hiscox/Lemonade voice).** Two top-level
   sections — **Residential** (home, auto) and **Commercial** (business). One
   concept per page, consistent template, contrast pairs, scenario-driven plain
   language, and a curated guided path per coverage area (not a flat article list).
2. **Guided qualification (Lemonade interaction + The Zebra sequencing + NEXT/Hiscox
   commercial tailoring).** One-question-at-a-time, branching, inline term
   explanations; ZIP/context-first with deferred PII; **industry-first** routing for
   Commercial. Conditional gap prompts. Output = a **prioritized, tiered needs
   summary** with rationale → packaged as a **broker lead summary** (explicitly not a
   quote/bind). Persist partial profiles so drop-offs still yield a lead.
3. **Asset protection (Lemonade per-item flow + the validated whitespace).** Post-signup
   asset inventory across home / vehicles / valuables / business equipment using a
   Lemonade-style per-item add pattern, then a **portfolio view with automated
   per-asset under-insurance flags and gap suggestions** — the differentiator absent
   from every competitor. Coverage-ratio and category-sublimit heuristics drive the flags.

**Trust spine throughout** (synthesized from Policygenius/Hiscox/Lemonade): up-front,
plain statement of what the broker receives and how follow-up works; data-handling
transparency; scenario/example-led credibility; honest "lead, not a bound policy"
framing. The broker-in-the-loop human review is positioned as the antidote to the
self-serve under-insurance risk competitors exhibit.

**Sequencing for MVP:** Knowledge hub + Qualification→lead first (the acquisition
loop, valuable on day one and lower-risk technically), with Asset protection as the
post-signup retention/cross-sell layer that depends on accounts — aligns with the
brief's "convert on the way in, retain after."

## Open questions for `clarify` (from brief + discovery)
1. **Auth/accounts** — anonymous hub + questionnaire, account only at asset-protection?
   (Discovery favors low-friction, deferred/implicit accounts.)
2. **Broker view vs client-only** — is the broker lead-review surface in MVP scope, or
   does the lead summary just get delivered (e.g., emailed/exported) for v1?
3. **Manual asset entry vs import** — Lemonade-style manual per-item add is the
   proven low-tech pattern; "import" (photos/receipts/integrations) raises scope.
4. **Suggestion rules: fixed vs broker-configurable** — start with fixed heuristics
   (coverage ratios, category sublimits, minimum-vs-adequate limits) or expose
   broker-tunable thresholds?
5. **Lead delivery mechanism** — how does the broker actually receive the lead summary
   (in-app queue, email, export)? Ties to Q2.
6. **Geographic scope / data** — US-centric coverage concepts dominate the references;
   confirm target market (affects terminology, "minimum vs adequate" rules, examples).

## Sources
Per-site source URLs are listed in each agent's full analysis; primary references include
policygenius.com, nerdwallet.com/insurance & /business/insurance, thezebra.com,
lemonade.com, coverwallet.com, nextinsurance.com, hiscox.com, insureon.com, and
third-party teardowns/reviews (NerdWallet, MoneyGeek, U.S. News, Trustpilot,
FitSmallBusiness, AdvisorSmith, UX case studies). All public; patterns synthesized, not copied.
