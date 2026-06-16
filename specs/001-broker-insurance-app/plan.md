# Plan — Broker-Branded Insurance App

**Phase:** 3 (plan) · HOW
**Feature slug:** `001-broker-insurance-app`
**Reads:** `spec.md` (incl. resolved §10 Clarifications)
**Constitution:** `global.md` (plain HTML+JS, **no framework / no build / no npm runtime
deps**, iPad-Safari target, `textContent` for dynamic data), `design.md` (slate-blue
theme, components, editorial + number/date formatting), `data.md` (Supabase, **RLS
always on**, service-role/secrets server-side only), `test.md` (S1–S4 + project
scenarios, html-validate, workflow YAML check).

This plan introduces **no scope the spec didn't ask for**. Each decision cites the
requirement it serves.

---

## 1. Architecture at a glance
A **static single-page app on GitHub Pages** (no build step) that talks to **Supabase**
for the two things that need a backend: storing leads and holding broker-editable rule
thresholds. Knowledge-hub content ships as **static JSON in the repo** (no DB needed to
read it). Broker email notification is a **Supabase Edge Function** fired by a database
webhook on lead insert.

```
GitHub Pages (static)                         Supabase (data.md)
┌─────────────────────────────┐               ┌───────────────────────────┐
│ index.html (app shell)      │   anon key    │ leads        (insert-only)│
│ /js  app modules (ES, no    │──────────────▶│ rule_settings(public read)│
│      bundler)               │   read/insert └─────────────┬─────────────┘
│ /css design-system + theme  │                             │ db webhook on insert
│ /content/*.json  hub + Qs   │               ┌─────────────▼─────────────┐
│ /js/rules.js  needs engine  │               │ Edge Function: notify-lead│
└─────────────────────────────┘               │  → email provider (secret)│
        served at /claude.insurance/          └───────────────────────────┘
```

**Why static + Supabase (not a server framework):** `global.md` forbids
build/framework/npm-runtime; `data.md` makes Supabase the sanctioned backend. A static
client with the **anon key** (publishable, RLS-guarded) is the documented pattern. Only
the email step needs a secret, which lives in the Edge Function — never client-side.

## 2. Tech stack
| Concern | Choice | Rationale / trade-off |
|---|---|---|
| Markup/logic | Plain HTML + vanilla **ES modules** (`<script type="module">`), no bundler | `global.md` hard rule; Pages serves modules natively. Trade-off: manual module wiring, no tree-shaking — fine at this size. |
| Styling | Hand-rolled CSS using `design.md` tokens; `data-theme="slate-blue"` on `<html>` | FR-X3. Single stylesheet + CSS custom properties; no Tailwind/SCSS. |
| Routing | Hash-based client routing (`#/hub`, `#/qualify`, …) | No server rewrites needed on Pages; back/forward + deep links work. Trade-off: `#` URLs (acceptable). |
| Backend | Supabase (Postgres + RLS + Edge Functions) | `data.md`. Leads (v1) now; accounts+assets (v2) later on same project. |
| Email | Supabase Edge Function → transactional email provider (e.g. Resend) via DB webhook | Keeps the API key server-side (`data.md`). Provider chosen at implement; abstracted behind the function. |
| Hosting/CI | GitHub Pages + existing `qa.yml` (Static Checks + Playwright) | Already scaffolded; no change. |
| Content | Static JSON in `/content` (hub topics, questionnaire schema) | Versioned, PR-reviewable, html-validate-independent; no DB read path for content. |

## 3. Module structure (repo layout)
```
index.html                     app shell, theme attr, mounts router
css/
  tokens.css                   design.md color/spacing/type tokens (slate-blue)
  app.css                      components (cards, steps, progress, buttons)
js/
  main.js                      bootstrap + hash router
  views/hub.js                 renders hub from content/coverage.json
  views/qualify.js             questionnaire state machine (branch + steps)
  views/summary.js             needs/gap result + "this is a lead, not a quote"
  rules.js                     pure needs/gap engine (input answers + thresholds)
  supabase.js                  thin client wrapper (anon key, insert lead, read rules)
  format.js                    design.md number/date/currency formatting helpers
content/
  coverage.json                hub topics (residential: home, auto; commercial: BOP, GL)
  questionnaire.json           branched question schema + inline term glossary
supabase/
  migrations/0001_init.sql     leads + rule_settings tables, RLS, seed defaults
  functions/notify-lead/       edge function (email on insert)
.github/scripts/ui-tests/      app.spec.js scenarios (S1–S4 + S5+ project rows)
```

## 4. Data model (Supabase)
**`leads`** — captures a qualification outcome (FR-B5/B6/B7/B8).
| col | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| created_at | timestamptz default now() | |
| domain | text check in ('residential','commercial') | FR-B1 |
| industry | text null | commercial only (FR-B2) |
| answers | jsonb | full questionnaire responses |
| needs | jsonb | computed prioritized needs/gaps (FR-B5) |
| contact_name | text | usable-lead min (C8) |
| contact_email | text null | one of email/phone required (C8) |
| contact_phone | text null | |
| is_partial | boolean default false | FR-B7/B8 |

**`rule_settings`** — broker-editable thresholds (C3 / FR-B9 / FR-C3).
| col | type | notes |
|---|---|---|
| id | int pk default 1 (singleton) | |
| settings | jsonb | coverage-ratio floors, category sublimits, min-vs-adequate limits |
| updated_at | timestamptz default now() | |
Seeded with sensible US defaults in the migration; broker edits via Supabase dashboard
until a broker UI exists (no broker UI in v1 per C1).

**RLS (always on, `data.md`):**
- `leads`: anon role **INSERT only** (with column/shape checks); **no SELECT** for anon
  (broker reads via dashboard/service role + email). Prevents lead harvesting.
- `rule_settings`: anon role **SELECT only**; no writes from client.
- Service-role key used only inside the Edge Function (email send), never shipped.

**v2 (asset protection) — designed-for, not built now:** add `app_users`
(client-auth PIN/login per `data.md`), `assets`, and per-user RLS; reuse `rule_settings`
for asset gap flags. Called out so v1 schema choices don't block v2.

## 5. Key flows
**Knowledge hub (FR-A*)** — `hub.js` loads `coverage.json`, renders two sections
(Residential/Commercial) → topic → structured explainer (definition / covers /
doesn't / who-needs). Every explainer has a CTA into `#/qualify?topic=…` (FR-A4). All
dynamic text via `textContent` (FR-X4).

**Qualification (FR-B*)** — `qualify.js` is a state machine over `questionnaire.json`:
1. Branch select → residential | commercial (FR-B1).
2. Commercial: industry early, from a curated ~8–12 list (C7), adapts later steps (FR-B2).
3. One step at a time, inline term glossary, progress bar (FR-B3).
4. **Deferred PII** — contact step only after substantive questions (FR-B4).
5. `rules.js` computes prioritized needs/gaps from answers + `rule_settings` (FR-B5/B9).
6. `summary.js` shows the prioritized result, **explicitly labelled "a lead for your
   broker — not a quote, price, or bound policy"** (SC3, non-goals).
7. `supabase.js` inserts the lead (full or partial w/ contact → C8/FR-B8); insert fires
   the `notify-lead` webhook → broker email (FR-B7).

**Needs/gap engine (`rules.js`)** — pure, deterministic, unit-testable: `(answers,
settings) → needs[]`. No thresholds hard-coded; all read from `rule_settings.settings`
(C3). Same engine reused for v2 asset gap flags.

## 6. Constitution compliance check
- ✅ No framework/build/npm-runtime — ES modules + static CSS (`global.md`).
- ✅ `textContent` for all backend/user data; no `innerHTML` (`global.md`, FR-X4).
- ✅ iPad-Safari: hash routing, ≥16px inputs, no hover-only affordances, tap targets
  (`design.md`, FR-A5/B10).
- ✅ Supabase RLS always on; secret only in Edge Function (`data.md`).
- ✅ slate-blue theme via `data-theme` + tokens (`design.md`, FR-X3).
- ✅ Tests: extends existing Playwright kit; html-validate + workflow-YAML gates already
  wired (`test.md`).
- ⚠️ **Accepted trade-off (record in CLAUDE.md §Security):** anon key + lead-insert is
  public by design; abuse mitigated by RLS insert-only shape checks + (optional) a
  lightweight turnstile/honeypot. No broker UI in v1 → broker reads leads via Supabase
  dashboard + email.

## 7. Risks / open decisions for implement
- **Email provider** (Resend vs. Supabase SMTP) — pick at implement; isolated in
  `notify-lead`. No spec impact.
- **Spam on public insert** — start with honeypot field + RLS shape checks; revisit
  Turnstile if abused. (Not a spec requirement; noted.)
- **Supabase project provisioning** — needs a project + secrets in CI/Pages env; first
  implement task. Uses Supabase MCP per `data.md`.
- **rule_settings editing UX** — dashboard-only in v1 (acceptable per "no broker UI");
  broker config screen is a v2 candidate.

## 8. Mapping to success criteria
SC1 → hub+qualify flow on iPad Safari (Playwright S-row). SC2 → `leads` row contents +
`notify-lead`. SC3 → summary copy assertion. SC4 → `coverage.json` completeness +
editorial check. SC5 → v2. SC6 → design-system + S1–S4 suite with slate-blue.
