# CLAUDE.md — claude.insurance

## Imported Directives
https://raw.githubusercontent.com/akyachtsman/claude.directives/main/directives/global.md
https://raw.githubusercontent.com/akyachtsman/claude.directives/main/directives/design.md
https://raw.githubusercontent.com/akyachtsman/claude.directives/main/directives/test.md
https://raw.githubusercontent.com/akyachtsman/claude.directives/main/directives/data.md

---

## Project Overview
- **Project name:** claude.insurance
- **Live URL:** https://akyachtsman.github.io/claude.insurance/
- **Stack:** Static SPA — plain HTML + vanilla ES modules (no framework/build), CSS design tokens; Supabase (Postgres + RLS + Auth + Edge Functions) for leads, broker-editable rule settings, and the Keep portal; hosted on GitHub Pages. *(Live: `js/supabase.js` runs the real `@supabase/supabase-js` client — public path anonymous, the Keep authenticated.)*
- **Branch policy:** Develop on a `claude/<name>` feature branch; PRs target `main`

## Design Theme
Project identity is **"Direction C" (Soft consumer)** — Quicksand (display) +
Nunito (body), violet accent, soft tints, large radii. Self-hosted OFL fonts in
`css/fonts/`. Set via `data-theme="harbor"` on root `<html>`; tokens in
`css/tokens.css`. Marketing site and the Keep portal share this one identity.
- **Design Theme:** `harbor` (Direction C — violet/soft)

## Application Architecture
- `index.html` — app shell; sets `data-theme="harbor"`, loads `js/main.js` (ES module)
- `js/main.js` — hash router: public (`#/`, `#/residential`, `#/commercial`, `#/coverage/:id`, `#/qualify`, `#/summary`) + the Keep (`#/keep` = landing/home, `#/keep/login`, `#/keep/list` = My Entities, `#/keep/entities` = Relationships map, `#/keep/entity/:id`, `#/keep/asset/:id`, `#/keep/policy/:id`, `#/keep/add-asset`, `#/keep/add-entity`, `#/keep/documents`, `#/keep/account`, `#/keep/security`). A route guard sends unauthenticated Keep routes to login. Origin-aware back via a router nav stack (`js/nav.js`). Toggles `body.in-keep` to swap site chrome.
- `js/views/` — `landing.js`, `section.js`, `coverage.js`, `qualify.js`, `summary.js`, and `keep.js` (the authenticated portal: login, landing/home with renewals report + at-a-glance boxes, My Entities, Relationships map, entity/asset/policy detail, add-asset/add-entity, documents, account, security, coverage analysis)
- **The Keep (v2, live):** invite-only client portal — entities (`Me` default + businesses/trusts) → assets → policies → coverage analysis. Reads/writes live Supabase under RLS via `js/supabase.js`; real Supabase Auth login gate. `js/keep/data.js` is now the **offline test fixture + `ASSET_META`** (not the app's data source); `js/keep/analysis.js` (asset → coverage analysis; reuses `rules.js`; tests `js/keep/analysis.test.mjs`); `css/keep.css` (Direction C portal styles, `k-` prefixed). Reachable by URL, unlinked from the public nav. A demo ribbon marks it as the seeded demo account.
- `js/rules.js` — pure needs/gap engine `(profile, settings) → needs[]`; thresholds come from settings (broker-editable), never hard-coded. Tests: `js/rules.test.mjs` (`node --test js/rules.test.mjs`)
- `js/supabase.js` — live data client (`@supabase/supabase-js` from esm.sh): a session-less public client for anonymous lead capture + rule settings, and an authenticated client for the Keep (auth, per-user reads, writes). Adapts DB rows → the nested shape the views expect; `js/keep/data.js` remains as the offline test fixture + `ASSET_META`. Service-role key never shipped.
- `js/format.js`, `js/dom.js` — formatting helpers and `textContent`-only DOM helpers
- `content/` — `coverage.json` (hub topics), `questionnaire.json` (branched schema + glossary), `rule-defaults.json` (seed thresholds mirroring `rule_settings`)
- `supabase/migrations/` — applied schema (provisioned): `leads` + `rule_settings` (public/anon side) and `profiles` (+ `reminder_email`/`reminder_schedule` prefs) + `entities` (kinds: `personal`/`business`/`trust`/`person`) + `entity_relationships` (directed owner/trustee links between a client's entities) + `assets` + `policies` (the Keep, auth-keyed). RLS on every table, default-deny. Demo data seeded live; `supabase/seed/` documents the seed in run order (`base_demo.sql` → `entity_relationships_demo.sql` → `assets_held_demo.sql`). The `notify-lead` / `notify-renewal` Edge Functions are still to come.

## Backend (Supabase — provisioned)
- **Project:** `insurance` · ref `bdsegmjcgfmgzuxwiplj` · URL `https://bdsegmjcgfmgzuxwiplj.supabase.co` (us-west-1)
- **Auth:** Supabase Auth (broker invite + password). RLS keys on `auth.uid()`.
- **Write model:** clients have full CRUD on their **own** entities/assets; `policies` are **read-only to clients** (broker-written via service-role, the system of record).
- **Keys:** publishable/anon key → client (safe in browser, RLS is the guard); `service_role` key → `DB_SERVICE_KEY` GitHub secret, server-side only. `DB_URL` = the project URL.
- **Migrations** live in `supabase/migrations/` and were applied via the Supabase MCP (versions match `list_migrations`). Front-end is wired to the live project; the Keep reads/writes real data under RLS. Three demo logins are seeded (a bare username is expanded to `<name>@example.com` by `signIn`): `user` / `keep-demo-2026` (client view, owns the seeded data; prefilled on the login screen), `broker` / `keep-demo-2026` (broker view; reviews and sends to underwriting), and `underwriter` / `keep-demo-2026` (underwriter view; owns the underwriting → approved/declined decision). Request lifecycle: requested → broker_review → underwriting → approved (+ declined).

## Required Commands
| Purpose | Command |
|---|---|
| Validate HTML | `npx html-validate index.html` |
| Validate workflow YAML | `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/qa.yml'))"` |

## Project-Specific Security Constraints
- **Public anonymous lead capture (accepted trade-off):** the questionnaire is anonymous (no login), so the client uses the Supabase **anon/publishable key** and can INSERT into `leads`. Mitigated by RLS: anon has **INSERT-only** on `leads` with column/shape checks and **no SELECT** (no lead harvesting), and **SELECT-only** on `rule_settings`. A honeypot field guards against trivial bots; revisit a CAPTCHA if abused.
- **Secrets stay server-side:** the email provider key lives only in the `notify-lead` Edge Function. No service-role key is ever shipped to the client.
- **No broker-facing UI in v1:** brokers consume leads via Supabase + email, so no privileged read path exists in the static app.
- **Shared Supabase account (accepted trade-off, temporary):** this project (`insurance`, ref `bdsegmjcgfmgzuxwiplj`) and `apfp` (ref `qnjrwbgxywkdfbfuzwas`) share one Supabase account/org, and a Supabase PAT is account-wide — so the MCP credential can reach both. Accepted for now (both pre-production, same owner). **Before production: split into per-project Supabase accounts/orgs** so a leaked PAT can't cross projects.
- **Operating rule — single-project scope:** from this repo's sessions, only ever touch the `insurance` project (`bdsegmjcgfmgzuxwiplj`). **Never** read from or write to `apfp` (`qnjrwbgxywkdfbfuzwas`). (Best enforced by adding `--project-ref=bdsegmjcgfmgzuxwiplj` to the Supabase MCP config in the web environment.)

## Project-Specific Coding Standards
- **Collapsible reveals (always):** any control that *expands* to show extra content — a button that reveals a panel, an inline expander, an accordion — MUST give the user an obvious way to collapse it back. Use a toggle with a rotating chevron/back arrow and `aria-expanded`, and never leave revealed content with no way to close it. Dropdowns/menus must also close on click-outside and Escape. Applies to every new feature or expanded button.
- **Origin-aware back (always):** any back / return / cancel control MUST return the user to the page they actually navigated *from*, not a hardcoded destination. The router records the previous route; back controls navigate to it, falling back to the hierarchical parent only when there's no prior in-app page (e.g. a deep link or fresh load). Never assume the parent in the breadcrumb is where the user came from (they may have arrived from a notification, search, or the documents view). Applies to every new feature or button.

## Agent Workflow
1. Use a `claude/<name>` feature branch
2. For a non-trivial feature, run `/sdd-loop` (`specify` → `clarify` → `plan` → `tasks`) before coding — separate WHAT from HOW; trivial changes skip to step 3
3. Implement changes in [main source file] — or `/sdd-loop analyze` then `/sdd-loop implement` to check consistency and work the task list
4. Run Required Commands above — all must pass
5. Prefer `qa-pipeline`; run steps individually only if it fails:
   `test-verifier` → `pr-review-toolkit:code-reviewer` → `/security-review` (if security-relevant) → `pr-readiness-reviewer`
6. Open PR to `main`

## UI Test Configuration
Read by `ui-tester` and the Playwright kit at runtime — fill in before invoking agents:
| Key | Value |
|---|---|
| App URL | `https://akyachtsman.github.io/claude.insurance/` |
| Public path | Anonymous — no login (the marketing site + questionnaire) |
| Keep credential (valid) | `user` / `keep-demo-2026` (client view, prefilled) · `broker` / `keep-demo-2026` (broker view). Bare username → `<name>@example.com`. |
| Keep credential (invalid) | any other password → `.k-error` on the login form |
| Primary nav button | `Find what coverage I need` |
| Primary content selector | `.card` |
| Nav cards | `['Residential','Commercial']` (hub coverage sections) |
| Playwright test directory | `.github/scripts/ui-tests` |
| Key selectors | home: `.app-header h1` · choice steps: `.choices .choice` · contact: `#contact-name` · summary: `.need`, `.disclaimer` · error: `.error` |

## Project-Specific Test Scenarios
Authoritative list of coverage beyond the generic S1–S4 suite — the ui-tester
adds one `app.spec.js` scenario per row, numbered from S5. Fill in before
invoking agents (the ui-tester stops and asks if this table is missing).
| # | Feature | What to verify | Failure indicator |
|---|---|---|---|
| S5 | Residential qualification flow | From the hub, "Find what coverage I need" → choose "For my household" → answer each step → contact step (name + email/phone) appears last → summary lists ≥1 coverage `.need` and shows the "not a quote" disclaimer | Flow stalls, contact step appears before substantive questions, summary shows no needs, or the lead/quote disclaimer is missing |
| S6 | Commercial qualification flow | As S5 but choose "For my business"; industry-first questioning; contact via phone only → summary lists ≥1 `.need` and the "not a quote" disclaimer | Commercial branch stalls, no needs computed, or disclaimer missing |
| S7 | Summary empty state | Deep-link `#/summary` with no prior answers → a friendly "No summary yet" empty state (the store is in-memory) | Blank page, crash, or JS error instead of the empty state |
| S8 | Contact validation (deferred-PII guardrail) | On the contact step: submitting with no name shows `.error`; name without email/phone shows an "email or phone" error; the step is not left until valid | A lead is accepted without a name or any contact method |
| S9 | Keep auth gate | Deep-link `#/keep` while signed out → redirects to the login form (`.k-authcard`). Submitting the prefilled demo credential reaches the dashboard (`.k-h1` "Welcome back"); a wrong password shows `.k-error` and stays on login. Sign-out returns to login. | Unauthenticated `#/keep` renders the dashboard, valid login fails to enter, or invalid login silently proceeds |

## Reporting Requirements
Agents write evidence to `.agent-reports/`:
- `implementation-summary.md`, `test-report.md`, `ui-test-report.md`
- `playwright-results.json`, `screenshots/` (on failure)
- `code-review-report.md`, `test-coverage-report.md`, `security-review-report.md`, `pr-readiness-report.md`

## Safety Rules for Agents
- Reviewer agents must not edit code unless explicitly instructed.
- Test commands must not require production credentials.
- Destructive commands, data resets, migrations, or deploys require explicit approval.
- If a check can't run locally, explain why and name the closest substitute.

## Session Start
1. Read all Imported Directive URLs above fully
2. Verify the directives-toolkit plugin attached (commands/agents resolve) per global.md → Skill Bootstrap
3. Confirm active branch: `git branch --show-current`
4. Run `/env-chk` and report status
