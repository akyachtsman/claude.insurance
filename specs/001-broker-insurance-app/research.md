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

---

# Part 2 — Experiential & Visual Discovery (2026-06-17)

**Status:** Second discovery pass for the **rebuild**. Feeds `/sdd-loop specify`.
**Why this pass:** the original discovery (Part 1) is strong on IA/flows but explicitly
*not* visually verified. The rebuild brief raises the bar to an **Expressive Mode**
experience (real hero/landing, display type scale, inline-SVG iconography + imagery,
polished multi-section pages, tasteful scroll motion) benchmarked to **Lemonade** and
**Policygenius**. This pass studied the **visual/experiential craft** (hero treatment,
visual language, layout richness, imagery/iconography, motion) and the **deeper coverage
taxonomy** the rebuild requires.

> **Scope deltas from Part 1 (per rebuild brief):**
> - **Asset protection → v2** (out of v1 scope; Part 1 treated it as a third facet).
> - **Deeper sections.** Residential = home, auto, **renters, umbrella, life, flood**.
>   Commercial = **BOP, general liability, commercial property, professional liability,
>   workers' comp, cyber, commercial auto, umbrella**.
> - **In-app purchase / payments / real-time quoting** remain non-goals.

## Method & caveats (Part 2)
Eight references analyzed in parallel against an **experiential rubric** (hero/first
impression · visual language · layout richness & section patterns · imagery/iconography
· motion/interaction · education depth · trust/conversion). **Public pages only;
ToS/robots respected; patterns synthesized, not cloned.** Nearly all first-party sites
returned **HTTP 403** to automated fetches, so visual-craft specifics lean on design
teardowns, UX case studies, brand/press write-ups, and verified URL taxonomy. **IA,
copy, flow, and content depth are high-confidence; exact hex/typeface/motion tokens are
inferred** — flagged where it matters and worth a manual Mobbin/browser pass before
final visual polish.

## Targets (Part 2)
| # | Site(s) | Role in this pass |
|---|---------|-------------------|
| 1 | **Lemonade** | Consumer-expressive **polish bar** — illustration, 3-color discipline, conversational intake |
| 2 | **Policygenius** | Editorial-marketplace **polish bar** — display type, "how it works", contrast-pair needs result |
| 3 | The Zebra | Playful brand, ZIP-first deferred-PII funnel, tiered output, in-context micro-education |
| 4 | Ethos / Ladder | Modern **life** insurance — sensitive-product hero, persistent CTA, calculator-as-destination |
| 5 | NerdWallet Insurance | Hub **content-craft** — one-concept-per-page template, contrast pairs, residential/commercial split |
| 6 | NEXT Insurance | Modern **SMB/commercial** — industry-first IA, coverage×trade pages, live package building |
| 7 | Hiscox | Commercial **scenario education** — profession-first 20-sec selector, "what if" stories + $ anchors |
| 8 | Coalition / Vouch | Design-forward **B2B/cyber** — promise-first hero, active-risk data module, proof-stat bands |

## The polish/richness bar (what the build MUST hit)
Synthesized across all eight; this is the explicit standard the rebuild is held to —
research must raise the *look*, not just the flow.

1. **A real hero, not a form.** Full-width opening: a calm, confident display headline +
   one-line promise + a single dominant CTA + a supporting visual (inline-SVG
   illustration/graphic). One big idea, one action (Lemonade, Policygenius, Ethos).
2. **One-idea-per-band landing rhythm.** Vertical scroll of alternating, breathing
   sections — hero → "how it works" (numbered + inline-SVG icons) → value/section bands →
   **stat/proof strip** → trust → repeat-CTA. Varied backgrounds for depth; generous
   whitespace; premium through restraint (Lemonade, Policygenius, Ethos, Coalition).
3. **Disciplined token system.** One ink, one neutral ground, **one decisive accent**
   used only for action/identity — our `slate-blue`; resist a second accent. Let a strong
   **display type scale** + whitespace carry hierarchy (Lemonade, NerdWallet). Restraint
   reads as authority for insurance.
4. **Inline-SVG iconography + owned illustration/imagery.** One consistent icon per
   concept; rounded/dimensional illustration or purposeful photography to carry warmth —
   **no stock-photo soup, no icon fonts/CDNs** (Lemonade illustration; Hiscox/Ethos
   real-people photography where the product is human).
5. **Tasteful scroll motion.** Scroll-reveal fades/slide-ups on section bands, **animated
   stat count-ups**, gentle data/diagram animation (esp. cyber "risk picture"). Always
   honor `prefers-reduced-motion`; no bounce/spin/flash (all; Coalition motion).
6. **Considered states.** Designed empty/loading/success states — e.g. a short scripted
   "searching/assembling your needs" reveal between questionnaire and summary makes the
   result feel earned (The Zebra loader; Lemonade conversational cadence).

## Experiential patterns to adopt, by surface (synthesize — do NOT clone)

### Landing / home
- **Editorial display hero** with one promise + one CTA + supporting inline-SVG visual
  (Policygenius "smarter way" register; Lemonade restraint).
- **Three-step "how it works"** band with inline-SVG icons that visually narrates the
  deferred-PII story: *learn → see your needs → connect with a licensed broker*
  (Policygenius, Ethos — interleave short proof between steps).
- **Stat/proof band as trust currency** (counts/outcomes, animated count-up) instead of a
  partner-logo wall — fits an anonymous, no-login app (Lemonade, Coalition, Hiscox).
- **Recurring trust strip component**: "anonymous · we never sell your data · no sales
  calls · this is a lead summary, not a quote" — rendered as a calm designed band, not
  fine print (Policygenius, The Zebra, Ethos). Maps to our anon/RLS INSERT-only posture.
- **Persistent/sticky primary CTA** on long Expressive pages (Ladder/Ethos "Get my price").

### Knowledge hub (Residential + Commercial)
- **Mirror the residential/commercial split** as two parallel trees with identical verbs
  and an identical page template — same mental model, different domain (NerdWallet).
- **Codify a coverage-page template** as a content schema and render every coverage
  identically in Expressive Mode:
  `definition → covers[] → excludes[] (what it does NOT cover) → whoNeedsIt →
  typicalCost{amount, table} → scenario → faqs[]` (NerdWallet template + Hiscox/Lemonade
  voice). Make the **covered/not-covered two-column block** and a cost/limits table the
  hero visual — tables beat decoration for comprehension.
- **Contrast-pair explainers** as a first-class page type ("X vs Y — do you need both?":
  collision vs comprehensive, HO-3 vs HO-5, term vs whole life, GL vs professional
  liability, GL vs workers' comp) — convert ambiguity to decisions, cross-link both
  sides (NerdWallet).
- **Scenario stories with dollar anchors** as the core education unit, esp. Commercial:
  each coverage gets one concrete "what if" claim narrative + a $ figure (Hiscox, Lemonade).
- **In-context micro-education**: glossary as inline tooltips on questionnaire fields, not
  a separate page — teach where confusion happens (The Zebra).
- **Sticky TOC + anchor nav + FAQ accordion** for long pages; a calculator/estimator as
  the single interactive centerpiece — useful motion, not spectacle (NerdWallet,
  Policygenius, Ethos/Ladder).

### Guided qualification → lead
- **Deferred-PII, context-first start** — substantive coverage/business questions first,
  one at a time, branching; contact (name/email/phone) only at the **final** step
  (Lemonade Maya, The Zebra ZIP-first, Hiscox 20-sec selector). Matches our `qualify.js`
  state machine and the S5 scenario.
- **Visible progress + back/forward** — explicitly *fix* the gap Policygenius/Lemonade
  long flows have. Cheap polish win our state machine owns.
- **Industry/profession-first routing for Commercial** — first question is the trade; it
  conditions everything after and pre-seeds likely coverages (NEXT, Hiscox, NerdWallet
  BOP eligibility framing). A **by-profession / coverage×trade** on-ramp pre-fills the
  profile.
- **Conditional gap prompts** driven by answers ("employees → workers' comp"; "own the
  building → commercial property") — sourced from broker-editable `rule_settings`, never
  hard-coded (CoverWallet, NEXT).
- **"Minimum vs adequate limits" framing** per coverage with concrete by-trade gap
  scenarios — the narrative core of our gap engine (NEXT, Hiscox).
- **Active-risk / "risk picture" module** for cyber — a scroll-revealed inline-SVG
  exposure motif paired with the needs output; make the *data* the visual (Coalition).

### Lead summary (result)
- **Contrast-pair / tiered needs result** — render `rules.js` output as framed cards
  (*Essential vs Recommended*, à la Policygenius "Optimal vs On-a-budget"; The Zebra
  Min/Better/Best) with one pre-recommended and the **rationale shown** — not a flat list.
- **Pedagogical output** — show the *method* (what drives each recommendation) so the
  result teaches the "why," echoing the calculator pattern (Policygenius, Ladder DIME).
- **Honest "lead summary, not a quote/bind" framing** kept prominent — our differentiator
  and trust safeguard (all; reinforced by competitors' lead-gen trust backlash in Part 1).

## Visual register notes (token-level, inferred — verify before final polish)
- **Lemonade:** ruthless 3-color discipline (charcoal ink + neutral ground + one
  decisive accent), rounded/dimensional shapes, soft low-contrast elevation, commissioned
  illustration over photography. *Our translation:* slate-blue accent, large radii,
  owned inline-SVG illustration.
- **Policygenius/Ethos/Ladder:** calm slate/teal base + one warm CTA accent, strong
  **editorial display type**, lots of white, soft radii/light elevation, real-people
  photography for human products (life). Persistent CTA on long pages.
- **NerdWallet:** maximal restraint — one accent reserved for action/identity, type +
  whitespace do all hierarchy work, **the table is the hero visual**.
- **Hiscox:** "established but modern" — stability neutral + one energetic accent,
  profession photography. *Our translation:* slate for trust + one warm accent (do NOT
  copy Hiscox red).
- **Coalition/Vouch:** deeper tech-forward sub-register for Commercial/cyber (navy base +
  one decisive accent), abstract data-viz motifs, animated diagrams. *Our translation:* a
  slightly deeper Commercial sub-register within the same `slate-blue` token system.

## Updated open questions for `clarify` (rebuild)
Carried/!revised from Part 1, pruned to the v1 rebuild scope (asset protection deferred):
1. **Auth/accounts** — confirm the rebuild stays **fully anonymous** (no login) for hub +
   questionnaire + lead, per current CLAUDE.md security model. (Part 1 Q1, now that asset
   protection is v2, anonymous-throughout is the likely answer.)
2. **Lead delivery mechanism** — Supabase `leads` INSERT + `notify-lead` email Edge
   Function only, no broker UI in v1 (per CLAUDE.md)? Confirm this is the rebuild's
   delivery path. (Part 1 Q2/Q5.)
3. **Suggestion rules** — keep broker-editable thresholds in `rule_settings` /
   `rule-defaults.json` (per CLAUDE.md), fixed for v1 UI? Confirm no broker-tuning UI in
   v1. (Part 1 Q4.)
4. **Geographic scope** — US-centric coverage concepts/terminology and "minimum vs
   adequate" rules; confirm US-only for v1. (Part 1 Q6.)
5. **Imagery production** — Expressive Mode wants owned illustration/imagery. Confirm
   **inline-SVG illustration/iconography built in-repo** (no external image CDNs, no
   stock licensing) is acceptable as the imagery strategy, given GitHub Pages hosting.
6. **Backend timing** — build front-end first against the existing STUB Supabase client
   (per CLAUDE.md "Supabase provisioning deferred"), or provision Supabase as part of this
   rebuild? Affects whether lead submit is live or stubbed at first merge.
7. **Coverage depth per page** — full NerdWallet-style template (definition → covers →
   excludes → who needs it → typical cost + table → scenario → FAQ) for **all 14**
   coverages in v1, or a subset deep + the rest stubbed? Sets the content-authoring bar.

## Sources (Part 2)
All public; patterns synthesized, not copied. Primary references: lemonade.com,
policygenius.com, thezebra.com, ethos.com/ethoslife.com, ladderlife.com,
nerdwallet.com/insurance & /business/insurance, nextinsurance.com, hiscox.com,
coalitioninc.com, vouch.us — plus design teardowns/case studies and brand/press
write-ups (Webstacks, Shadow Digital, Learners.ai, UX Reactor, dt-ux.com, Medium
Design Bootcamp, Casimir Effect motion portfolio, Landingi/Unbounce LP galleries,
brandfetch/logotyp/1000logos brand-asset refs, U.S. News, MoneyGeek, NerdWallet,
Trustpilot, ZenBusiness). Most first-party pages 403'd automated fetch; visual-token
specifics inferred and flagged for a manual Mobbin/browser verification pass.
