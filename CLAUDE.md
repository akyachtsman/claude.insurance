# CLAUDE.md — claude.insurance

## Imported Directives
https://raw.githubusercontent.com/akyachtsman/claude.directives/main/directives/global.md
https://raw.githubusercontent.com/akyachtsman/claude.directives/main/directives/git.md
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
Nunito (body), blue accent (`--color-accent: #2F6AF6`), soft tints, large radii. Self-hosted OFL fonts in
`css/fonts/`. Set via `data-theme="harbor"` on root `<html>`; tokens in
`css/tokens.css`. Marketing site and the Keep portal share this one identity.
- **Design Theme:** `harbor` (Direction C — blue/soft)

## Application Architecture
- `index.html` — app shell; sets `data-theme="harbor"`, loads `js/main.js` (ES module)
- `js/main.js` — hash router: public (`#/`, `#/residential`, `#/commercial`, `#/coverage/:id`, `#/qualify`, `#/summary`) + the Keep (`#/keep` = landing/home, `#/keep/login`, `#/keep/list` = My Entities, `#/keep/entities` = Relationships map, `#/keep/entity/:id`, `#/keep/asset/:id`, `#/keep/policy/:id`, `#/keep/add-asset`, `#/keep/add-entity`, `#/keep/documents`, `#/keep/account`, `#/keep/security`). A route guard sends unauthenticated Keep routes to login. Origin-aware back via a router nav stack (`js/nav.js`). Toggles `body.in-keep` to swap site chrome.
- `js/views/` — public marketing views: `landing.js`, `section.js`, `coverage.js`, `qualify.js`, `summary.js`.
- `js/keep/` — the Keep feature, split by layer:
  - `js/keep/views/` (rendering) — `keep.js` (entry: login, landing/home with renewals report + at-a-glance boxes, documents, account, security, add-entity), `entities.js` (My Entities list/cards/map + entity detail + card drag-reorder), `assets.js` (assets table + asset detail + add-asset), `policies-view.js` (policy detail + request form + My requests), `shell.js` (shared chrome: app frame, header menus, search, back-nav, doc download, formatters), `relmap-view.js` (Relationships-map SVG engine).
  - `js/keep/logic/` (pure, unit-tested, no DOM) — `analysis`, `depreciation`, `ownership`, `policies` (presentation facts), `requests` (lifecycle), `entity-display`, `entity-types`, `relmap` (layout math), `search`, `docfile`, `data` (offline fixture + `ASSET_META`).
- **The Keep (v2, live):** invite-only client portal — entities (`Me` default + businesses/trusts) → assets → policies → coverage analysis. Reads/writes live Supabase under RLS via `js/supabase.js`; real Supabase Auth login gate. `js/keep/logic/data.js` is now the **offline test fixture + `ASSET_META`** (not the app's data source); `js/keep/logic/analysis.js` (asset → coverage analysis; reuses `rules.js`; tests `js/keep/logic/analysis.test.mjs`); `js/keep/logic/depreciation.js` (pure per-asset-type actual-cash-value depreciation engine; straight-line ACV to a per-type salvage floor, non-depreciating for property/land/valuables; surfaced as an Assets-table column + a "Value & depreciation" schedule on the asset detail page; tests `js/keep/logic/depreciation.test.mjs`); `css/keep.css` (Direction C portal styles, `k-` prefixed). Reachable by URL, unlinked from the public nav. A demo ribbon marks it as the seeded demo account.
- `js/rules.js` — pure needs/gap engine `(profile, settings) → needs[]`; thresholds come from settings (broker-editable), never hard-coded. Tests: `js/rules.test.mjs` (`node --test js/rules.test.mjs`)
- `js/supabase.js` — live data client (`@supabase/supabase-js`, **vendored** at `js/vendor/supabase-js.js` — see that directory's README): a session-less public client for anonymous lead capture + rule settings, and an authenticated client for the Keep (auth, per-user reads, writes). Adapts DB rows → the nested shape the views expect; `js/keep/logic/data.js` remains as the offline test fixture + `ASSET_META`. Service-role key never shipped. **No mocked/hard-coded data path ships:** the app *always* reads/writes real Supabase. A stubbed `supabase.js` exists only in the offline Playwright harness (a scratchpad-only overlay, never committed) so UI geometry/render can be checked without network or auth; it is not part of the repo or the deployed app.
- `js/format.js`, `js/dom.js` — formatting helpers and `textContent`-only DOM helpers
- `content/` — `coverage.json` (hub topics), `questionnaire.json` (branched schema + glossary), `rule-defaults.json` (seed thresholds mirroring `rule_settings`)
- `supabase/migrations/` — applied schema (provisioned): `leads` + `rule_settings` (public/anon side) and `profiles` (+ `reminder_email`/`reminder_schedule` prefs) + `entities` (kinds: `personal`/`business`/`trust`/`person`) + `entity_relationships` (directed owner/trustee links between a client's entities) + `assets` + `policies` (the Keep, auth-keyed). RLS on every table, default-deny. Demo data seeded live; `supabase/seed/` documents the seed in run order (`base_demo.sql` → `entity_relationships_demo.sql` → `assets_held_demo.sql`). The `notify-enhancement` Edge Function (enhancement-request emails) and `desk-ask` are deployed and ACTIVE; the `notify-lead` / `notify-renewal` functions are still to come.

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
| Unit tests | `node --test $(find js -name '*.test.mjs')` |
| Contrast guardrail | `node .github/scripts/check-contrast.js` |
| Job bounds guard | `python3 .github/scripts/check-job-bounds.py` |
| Workflow reference guard | `python3 .github/scripts/workflow-ref-guard.py` |
| Viewport classes guard | `node .github/scripts/check-ui-viewports.js --tests-dir .github/scripts/ui-tests` |

**Local Playwright ceiling.** In an agent sandbox **S1/S4/S7/S8 pass on
chromium; S5/S6 cannot; the webkit profiles cannot run at all.** Two causes,
both environmental — never "fix" a local failure from either.

- **No webkit or firefox anywhere in the fleet's sandbox image** (verified
  across three sandboxes, 2026-08-26): it ships chromium only, so `tablet` and
  `iphone` fail at launch in ~3ms. Installing webkit is not the fix; CI has it.
- **The bundled browser has no working HTTPS path to any external host through
  the proxy**, so S5/S6 cannot load `rule_settings` and compute a `.need`.
  Confirmed with the one-command discriminator: `curl` to the Supabase REST
  endpoint returns **200 with the real settings**, while chromium fetching the
  *same URL* throws `Failed to fetch`. A 200 from curl beside a browser failure
  is proof of environment.

Vendoring the Supabase client (2026-08-26) fixed the *module-load* half of this
and recovered S7/S8 — the app now boots offline. It does **not** fix the
*runtime-XHR* half, which is why S5/S6 still cannot pass here.

**Failure duration classifies these before you open a log:** ~3ms and uniform =
the browser never launched; times out at the action budget with a 200 page = the
app cannot fetch; real elapsed time with real DOM and a named assertion = an
actual defect, treat it as one.

## Project-Specific Security Constraints
- **Public anonymous lead capture (accepted trade-off):** the questionnaire is anonymous (no login), so the client uses the Supabase **anon/publishable key** and can INSERT into `leads`. Mitigated by RLS: anon has **INSERT-only** on `leads` with column/shape checks and **no SELECT** (no lead harvesting), and **SELECT-only** on `rule_settings`. A honeypot field guards against trivial bots; revisit a CAPTCHA if abused.
- **No third-party code on the render path (2026-08-26).** The Supabase client
  is **vendored** (`js/vendor/supabase-js.js`, pinned 2.112.4) rather than
  imported from `https://esm.sh/@supabase/supabase-js@2`. That import put a
  third party on the critical path of every render including the authenticated
  Keep, at a **floating major**, and an ES module import cannot carry an
  integrity hash — so an esm.sh outage took the app down and a compromised build
  there would have executed holding a user's session. **Accepted cost:** a
  pinned bundle does not self-update; `js/vendor/README.md` carries the
  regenerate command, the sha256 and the revisit trigger (any client security
  advisory, and every `/refresh-repo`).
- **Secrets stay server-side:** the email provider key lives only in the Edge Functions (`notify-enhancement` today; `notify-lead` when it ships). No service-role key is ever shipped to the client.
- **No broker-facing UI in v1:** brokers consume leads via Supabase + email, so no privileged read path exists in the static app.
- **Shared Supabase account (accepted trade-off, temporary):** this project (`insurance`, ref `bdsegmjcgfmgzuxwiplj`) and `apfp` (ref `qnjrwbgxywkdfbfuzwas`) share one Supabase account/org, and a Supabase PAT is account-wide — so the MCP credential can reach both. Accepted for now (both pre-production, same owner). **Before production: split into per-project Supabase accounts/orgs** so a leaked PAT can't cross projects.
- **Operating rule — single-project scope:** from this repo's sessions, only ever touch the `insurance` project (`bdsegmjcgfmgzuxwiplj`). **Never** read from or write to `apfp` (`qnjrwbgxywkdfbfuzwas`). (Best enforced by adding `--project-ref=bdsegmjcgfmgzuxwiplj` to the Supabase MCP config in the web environment.)

## Project-Specific Coding Standards
- **Collapsible reveals (always):** any control that *expands* to show extra content — a button that reveals a panel, an inline expander, an accordion — MUST give the user an obvious way to collapse it back. Use a toggle with a rotating chevron/back arrow and `aria-expanded`, and never leave revealed content with no way to close it. Dropdowns/menus must also close on click-outside and Escape. Applies to every new feature or expanded button.
- **Origin-aware back (always):** any back / return / cancel control MUST return the user to the page they actually navigated *from*, not a hardcoded destination. The router records the previous route; back controls navigate to it, falling back to the hierarchical parent only when there's no prior in-app page (e.g. a deep link or fresh load). Never assume the parent in the breadcrumb is where the user came from (they may have arrived from a notification, search, or the documents view). Applies to every new feature or button.
- **Non-overlapping connectors (always):** in the Relationships map — or any node-and-edge diagram — no two connectors from *different* sources may run collinear so they merge into one visible line, and none may run behind a box. Every distinct relationship stays traceable to exactly one owner→owned pair. Give same-orientation runs that share a corridor their own lane/offset; break a *perpendicular* crossing with a small gap — never an arc or loop (which reads as a node or a join). One source fanning out through a single shared trunk (a bus) is fine — that is one relationship, not two; two *different* owners sharing a line is not. Deconflict as a routing pass, then **verify geometrically before shipping** — count cross-source overlaps and lines-behind-boxes programmatically (a visual glance misses collinear overlaps, and hash-nav serves cached JS so the eye can't confirm the new build). Applies to every change that routes edges.

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

## Upstream Divergences (deliberate — `/refresh-repo` must DIFF, not revert)

Synced from `claude.directives` @ `1d57879` (#316). These are **intentional** local
departures from the templates. A refresh that silently restores any of them
breaks this repo; each is listed so the next session diffs rather than "fixes".

| Divergence | Why it must stay |
|---|---|
| `LIVE_TARGET` in `app.spec.js` | **Load-bearing; absent upstream.** Skips S2/S3/S9 when `APP_URL` is localhost. Without it those scenarios run against a static server with no backend and fail — and since #244 made `qa.yml`'s ui-tests job **blocking**, that reds every push to `main`. |
| `readCredentialFromClaude()` | Upstream is env-only (`ce2140a`). Kept so local runs work without the secret; the credential is already in this file's UI Test Configuration table, so reading it here exposes nothing new. |
| S5–S9 instead of upstream's NAV / CTRL / ENTRY / DISMISS | S5–S9 cover *this* app (see Project-Specific Test Scenarios). Upstream's four are **deliberately not carried**. Revisit NAV only if this app gains multi-level drill-down with an in-app back control — it self-skips otherwise, so its downside is bounded. |
| `TEST_AUTH_EMAIL` **must stay unset** | The Keep's login ships **both fields prefilled**. #309's identifier ladder matches accessible names `/email\|user\|login/`, and our field is labelled "Username" — setting the secret would overwrite the working prefilled value and break a login that otherwise succeeds. Password-only is correct here. |
| S2/S3 navigate to `#/keep/login` | Upstream's S2 loads `./`, which here is **public marketing with no gate** — `detectAndAuth` returns `'none'` and every auth assertion goes vacuous. Upstream cannot know this route, and its own S2 failure text prescribes exactly this fix ("point this scenario at the login route"). Since this repo supplies a credential, upstream's S2 verbatim would now **throw** here. |
| `check-contrast.js` carries `css/tokens.css` | This repo's design contract predates the `styles/` Repo Structure Standard. Upstream's path is **kept alongside**, not replaced, so the file stays a superset and the next refresh diffs cleanly. Reported upstream: `CANDIDATES` should be configurable. |
| `qa.yml` has a `unit-tests` job | No upstream equivalent. `node --test` over `js/**/*.test.mjs` plus `html-validate` — a deterministic blocking gate needing no browser or backend (#202). |
| `qa.yml` `UI_PATHS` uses `css/` | Upstream's breadth, this repo's directory names. The **previous local regex matched only `index.html`**, so a PR touching nothing but `js/` or `css/` set `ui=false` and skipped the browser job entirely — on an app that is almost entirely `js/` and `css/`. Fixed by adopting upstream's shape. |
| S9 keeps its own auth assertions | S9 reads the prefilled password back before overwriting, and asserts the form *was* prefilled. The generic kit has no notion of "the form already holds a working credential" and fills destructively — an upstream gap this project's login proves. S9 is the reference implementation; do not replace it with the generic verifier. |

**Threshold values.** Never cache an upstream threshold — record the pointer.
Where a config format forces a literal (`timeout-minutes` accepts no expression),
the value is cached because it must be and **the pointer travels in the comment
beside it**. See `qa-live.yml` / `qa-response.yml` (120, `claude.directives#301`)
and `qa.yml` (120 — it now calls the `ui-suite` composite, so it answers to the same enforced floor, not the advisory browser one). A temporary "don't do X until fixed" belongs in
the defective template upstream, not copied into N downstream files.

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

## Session Settings & Permissions (`.claude/settings.json`)
- **Settings load at SESSION START.** Nothing merged into `.claude/settings.json`
  affects the session that merged it — a permissions change is in force only from
  the *next* session. Never conclude a change "didn't work" by testing it in the
  session that made it.
- **A correct-looking `permissions.allow` is not evidence that anything is
  pre-approved.** While **auto mode** is active a classifier decides, and
  `permissions` and `autoMode` are separate settings keys — the classifier does
  not read `permissions.allow`. Denials under auto mode name *"the Claude Code
  auto mode classifier"*, never a permission rule. Verified here at `d31486f`:
  this repo carries the 12-entry scheduling allowlist, no `ask`, and **no
  `autoMode` block**; `claude.directives` and `claude.prop` match.
- **Status — diagnosis, not proven fix.** The auto-mode explanation is
  `claude.directives`' reading of why the allowlist has never taken effect. It is
  unconfirmed: the classifier blocks a session from writing its own live settings,
  and that guard is correct — a session should not widen its own permissions
  outside a reviewable diff. **Do not add an `autoMode` block speculatively;** the
  exact JSON arrives from upstream once it is confirmed working there.

## Session Start
1. Read all Imported Directive URLs above fully
2. Verify the directives-toolkit plugin attached (commands/agents resolve) per global.md → Skill Bootstrap
3. Confirm active branch: `git branch --show-current`
4. Run `/env-chk` and report status
