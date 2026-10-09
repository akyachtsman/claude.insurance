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
- `js/main.js` — hash router: public (`#/`, `#/residential`, `#/commercial`, `#/coverage/:id`, `#/qualify`, `#/summary`) + the Keep (`#/keep` = landing/home, `#/keep/login`, `#/keep/list` = My Entities, `#/keep/entities` = Relationships map, `#/keep/entity/:id`, `#/keep/asset/:id`, `#/keep/policy/:id`, `#/keep/add-asset`, `#/keep/add-entity`, `#/keep/documents`, `#/keep/insurance` = all policies, `#/keep/requests` = My requests, `#/keep/request/:id`, `#/keep/assets` = all assets, `#/keep/grid`, `#/keep/help` = Help desk, `#/keep/account`, `#/keep/security`). A route guard sends unauthenticated Keep routes to login. Origin-aware back via a router nav stack (`js/nav.js`). Toggles `body.in-keep` to swap site chrome.
- `js/views/` — public marketing views: `landing.js`, `section.js`, `coverage.js`, `qualify.js`, `summary.js`.
- `js/keep/` — the Keep feature, split by layer:
  - `js/keep/views/` (rendering) — `keep.js` (entry: login, landing/home with renewals report + at-a-glance boxes, documents, account, security, add-entity), `entities.js` (My Entities list/cards/map + entity detail + card drag-reorder), `assets.js` (assets table + asset detail + add-asset), `policies-view.js` (policy detail + request form + My requests), `shell.js` (shared chrome: app frame, header menus, search, back-nav, doc download, formatters), `relmap-view.js` (Relationships-map SVG engine), `help-view.js` (the Help desk page).
  - `js/keep/logic/` (pure, unit-tested, no DOM) — `analysis`, `depreciation`, `ownership`, `policies` (presentation facts), `requests` (lifecycle), `entity-display`, `entity-types`, `relmap` (layout math), `search`, `docfile`, `help` (Help-desk question validation, suggestion chips, answer shaping), `asset-meta` (`ASSET_META` — the
    only one of these on the render path). The offline fixture is **not** here:
    it lives in `js/keep/fixtures/sample.mjs`, deliberately outside `logic/`.
- **The Keep (v2, live):** invite-only client portal — entities (`Me` default + businesses/trusts) → assets → policies → coverage analysis. Reads/writes live Supabase under RLS via `js/supabase.js`; real Supabase Auth login gate. `js/keep/logic/asset-meta.js` holds `ASSET_META` (asset-type icon/colour/label — on the render path);
  `js/keep/fixtures/sample.mjs` is the **offline test fixture**, Node-only and
  deliberately outside `logic/` so it stays off the browser graph. They were one
  file (`js/keep/logic/data.js`) until 2026-10-05: because `js/supabase.js`
  imported the map from it, the whole file sat in `index.html`'s `MODULES` and
  ~13KB of sample data was fetched and evaluated on **every** page load,
  including the anonymous marketing site. `check-asset-manifest.js` now asserts
  no `.mjs` is reachable from `js/main.js`, so it cannot come back. `js/keep/logic/analysis.js` (asset → coverage analysis; reuses `rules.js`; tests `js/keep/logic/analysis.test.mjs`); `js/keep/logic/depreciation.js` (pure per-asset-type actual-cash-value depreciation engine; straight-line ACV to a per-type salvage floor, non-depreciating for property/land/valuables; surfaced as an Assets-table column + a "Value & depreciation" schedule on the asset detail page; tests `js/keep/logic/depreciation.test.mjs`); `css/keep.css` (Direction C portal styles, `k-` prefixed). Reachable by URL, unlinked from the public nav. A demo ribbon marks it as the seeded demo account.
- `js/rules.js` — pure needs/gap engine `(profile, settings) → needs[]`; thresholds come from settings (broker-editable), never hard-coded. Tests: `js/rules.test.mjs` (`node --test js/rules.test.mjs`)
- `js/supabase.js` — live data client (`@supabase/supabase-js`, **vendored** at `js/vendor/supabase-js.js` — see that directory's README): a session-less public client for anonymous lead capture + rule settings, and an authenticated client for the Keep (auth, per-user reads, writes). Adapts DB rows → the nested shape the views expect; it imports `ASSET_META` from `js/keep/logic/asset-meta.js` and nothing from the offline fixture, which is what keeps `js/keep/fixtures/sample.mjs` off the browser graph. Service-role key never shipped. **No mocked/hard-coded data path ships:** the app *always* reads/writes real Supabase. A stubbed `supabase.js` exists only in the offline Playwright harness (a scratchpad-only overlay, never committed) so UI geometry/render can be checked without network or auth; it is not part of the repo or the deployed app.
- `js/dom.js` — `textContent`-only DOM helpers. **There is no `js/format.js`** —
  it was deleted in `2be517a` (zero importers) and this line claimed it for
  months afterwards. The formatters live in `js/keep/views/shell.js` (`money`,
  `dateFromDays`, `dateShort`, `expiryBadge`) and `js/keep/logic/policies.js`
  (`formatPremium`); the public views have no money formatter at all.
- `js/store.js` — in-memory questionnaire answer store (why deep-linking
  `#/summary` has nothing to show — scenario S7)
- `js/content.js` — fetches + caches `content/*.json`; `findTopic` lookup
- `js/components/` — `ui.js` (marketing blocks), `progress.js`, `glossary.js`.
  **Public path only** — nothing under `js/keep/` imports from here. The Keep's
  generic widgets live in `js/keep/views/shell.js`.
- `js/icons.js`, `js/svg.js`, `js/motion.js` — sprite icons, SVG element helper,
  reveal/count-up observers
- `js/test-settings.mjs` — test-only fixture (reads `content/rule-defaults.json`
  so the unit tests exercise the real seed values); never in `index.html`
- `content/` — `coverage.json` (hub topics), `questionnaire.json` (branched schema + glossary), `rule-defaults.json` (seed thresholds mirroring `rule_settings`), `help-guide.json`
  (the Help desk's 15-topic corpus — **read by both halves**: the browser for the
  suggestion chips and the credited-source titles, the `help-ask` Edge Function
  for the prompt, so chips, prompt and credits cannot drift apart. Every topic's
  `route` must resolve to a real `case` in `dispatchKeep`; all 15 were checked
  against `js/main.js` when it was written)
- `css/` — `tokens.css` (design tokens), `base.css`, `components.css`,
  `forms.css`, `views.css`, `motion.css` (public site) + `keep.css` (portal,
  `k-` prefixed); self-hosted OFL fonts in `css/fonts/`
- `docs/data-model.md` — the canonical label/field reference behind the "one
  canonical label" standard above
- `specs/` — **frozen** point-in-time SDD record for feature 001, not current
  architecture; see `specs/README.md` for its known divergences from the code
- `scripts/setup-playwright.sh` — local browser setup
- `learnings.jsonl` — append-only session learnings (`/learn`)
- `.github/workflows/` — 8 workflows: `qa.yml`, `qa-live.yml`, `qa-response.yml`,
  `ci-monitor.yml`, `ci-notify.yml`, `codex-monitor.yml`, `pages-monitor.yml`,
  `pages-retry.yml`. `.github/actions/` holds the shared composite actions
  (`ui-suite`, `secret-scan`); `.github/scripts/` the guard scripts and
  `ui-tests/`; `.github/workflow-ref-required.json` the required-watcher list.
- `supabase/migrations/` — applied schema (provisioned): `leads` + `rule_settings` (public/anon side) and `profiles` (+ `reminder_email`/`reminder_schedule` prefs) + `entities` (kinds: `personal`/`business`/`trust`/`person`) + `entity_relationships` (directed owner/trustee links between a client's entities) + `assets` + `policies` (the Keep, auth-keyed) + **`help_queries`** (feature 003's throttle log, applied 2026-10-09 — server-only: `authenticated` holds *nothing* on it, `service_role` holds `select, insert, delete` by explicit grant). RLS on every table, default-deny. ⚠️ Three migrations landed 2026-10-09 and the two security ones are recorded under *Project-Specific Security Constraints* below rather than here: `20261005120000_enhancement_request_stage_guard` (staff may no longer set any request status from any status) and `20261005120100_profiles_role_not_self_assignable` (`authenticated` UPDATE on `profiles` narrowed to `reminder_email, reminder_schedule`; INSERT revoked). Demo data seeded live; `supabase/seed/` documents the seed in run order (`base_demo.sql` → `entity_relationships_demo.sql` → `assets_held_demo.sql`). The `notify-enhancement` Edge Function (enhancement-request emails) is deployed
  and ACTIVE, with its source in `supabase/functions/`. The `notify-lead` /
  `notify-renewal` functions are still to come.
  - **`help-ask`** (feature 003, `supabase/functions/help-ask/`) — the Help desk
    endpoint. **Deploy with the DEFAULT — `verify_jwt` ON.**
    ⚠️ This line said `--no-verify-jwt` for five commits, on two claims that were
    both false and both testable here all along. `desk-ask` is deployed with
    `verify_jwt: true`, which makes it a live control; probed 2026-10-07:
    an OPTIONS preflight with no Authorization returns **the stub's own body**
    with `x-deno-execution-id` set (so the flag does **not** block CORS), while a
    POST with no Authorization and a POST with a malformed bearer are both
    refused by the gateway with **no execution id** (so the function never runs).
    The flag therefore costs nothing and stops junk traffic before it is a
    billable invocation. `supabase/config.toml` carries no `[functions.help-ask]`
    block, deliberately — and note that only the CLI reads that file at all; the
    Supabase MCP deploy tool takes `verify_jwt` explicitly and defaults to true.
    Written, **not merged and not deployed** — ⚠️ this said "Written and merged"
    while PR #254 was still open, which is the kind of claim that makes a reader
    stop looking for the branch. See the owner gate below for the full order. Until then `#/keep/help` renders and every ask shows the plain
    "not available" notice — FR-17's single failure
    path, which is why the page is shippable ahead of the deploy.
  - ⚠️ **`desk-ask` is a retired stub, not part of this system — and NOT an
    older name for `help-ask` above.** The two are easy to confuse because 003
    was first planned to deploy straight over this stub (`specs/003-help-desk/plan.md`,
    Key decision 1, revised); that was rejected precisely so this record could
    stay unambiguous. `desk-ask` is still
    deployed here and reads ACTIVE, which an earlier version of this line listed
    alongside `notify-enhancement` as though both were working features. Its
    source (fetched 2026-10-05) is a 410 responder whose own comment says it
    "was deployed by mistake into the wrong project and has been neutralized: it
    reads nothing, calls nothing, and stores nothing. Safe to delete entirely."
    Nothing in `js/` references it. It is deliberately **not** vendored into
    `supabase/functions/` — the fix is to delete the function (Dashboard → Edge
    Functions → desk-ask → Delete), which needs owner approval as a production
    change. Until then it is a live JWT-verified endpoint that does nothing.
- `supabase/proposed/` — migrations **written but not applied**, awaiting owner
  approval. `supabase/migrations/` means "live and matching `list_migrations`";
  this directory exists so that stays true. See its README.

### ⚠️ Feature 003 owner gate — the authoritative order

Three places gave different versions of this (5 steps, 2 prerequisites, 6 steps).
This is the one to follow; the others defer to it.

1. ✅ **DONE 2026-10-09** — `help_queries` is live, as
   `supabase/migrations/20261006120000_help_queries.sql`. Its explicit
   `grant ... to service_role` is load-bearing, not tidiness. Client probes 1-5
   from its footer all return 42501, run as a real client session.
2. ✅ **DONE 2026-10-09 in substance** — `revoke insert on public.profiles from
   authenticated` is live (applied as step 2 of
   `migrations/20261005120100_profiles_role_not_self_assignable.sql`, which
   carries the identical statement), so the invite check is a real gate: a client
   `insert into profiles` now returns 42501, measured as a client session. The
   only part of `supabase/proposed/20261006_profiles_no_client_insert.sql` still
   unrun is its `drop policy` line, which is redundant (the policy is now
   narrower *and* dormant) and cannot be issued through the Supabase MCP — see
   the DROP note at the end of this list.
3. ⏳ **OWNER ACTION — not doable from a session.** Turn public sign-up off in
   Supabase Auth. Measured ON (`disable_signup: false`), which makes the Security
   page's "Invite-only access" card untrue. There is no Supabase MCP tool for
   auth config and the Management API needs a PAT no session holds. ⚠️ Step 2
   *has* closed the spend half of this (a self-signed-up account can no longer
   obtain a `profiles` row, so it can never reach a paid ask); what is still
   untrue is the product's own claim.
4. ✅ **DONE — already true, verified 2026-10-09, nothing to do for the demo.**
   All three seeded accounts hold a `profiles` row with the right role
   (`user@example.com` → `client`, `broker@` → `broker`, `underwriter@` →
   `underwriter`), and those are the only three rows in `auth.users`. This step
   remains in the **invite runbook** for every future client, because nothing
   creates a row automatically: no trigger, no client insert after step 2, and
   `service_role` has no INSERT on that table — so it must be done as `postgres`
   (the dashboard SQL editor). Without it the Keep works and the Help desk
   refuses every question, showing the same notice as an outage.
   ⚠️ **AND THE RUNBOOK HAS A SECOND ITEM NOW, BEFORE THE FIRST REAL CLIENT:
   rotate the broker and underwriter passwords out of this repo, or move the demo
   accounts to a separate project.** Those two staff logins were repaired on
   2026-10-09 (they had never worked — see the Backend section), and this file
   publishes their passwords. A staff role is not the same exposure as the
   published *client* credential: that one reaches its own rows only, because
   every other table keys on `owner = auth.uid()` with no role escape, whereas
   `er_broker_select` / `er_underwriter_select` read **every** client's
   enhancement requests and the update policies write them (status-constrained
   since `20261009210000`, still unconstrained on `owner`/`subject`/`body`).
   Accepted today on a **measured** precondition — `auth.users` holds exactly
   three rows, all `@example.com`, and `enhancement_requests` holds one row owned
   by the demo client, so there is no real client data to expose — and that
   precondition expires with the first invite. Raised by an automated security
   review of the repairing commit; recorded rather than acted on because it is a
   credential decision on the owner's project, and rotating silently would break
   both the logins this file documents and the ui-tester that consumes them.
5. ⛔ **OWNER ACTION — THE ONE HARD BLOCKER.** Set `ANTHROPIC_API_KEY` as an Edge
   Function secret. No session can do this: the key is the owner's and is not in
   this environment. `mcp__Supabase__create_edge_function_secret` exists, so once
   the value is in hand a session can set it — the missing thing is the value,
   not the tool. Until it is set, `hasKeys` is false and every ask renders FR-17's
   notice, which is the same thing a client sees today, so nothing regresses by
   waiting.
   ⚠️ **SET THE ANTHROPIC CONSOLE WORKSPACE SPEND LIMIT IN THE SAME SITTING.**
   This warning used to live in step 6 (the deploy) — wrong place, and the reason
   matters: **spend becomes possible when the KEY is set, not when the function is
   deployed.** The function is deployed and keyless today, and it bills nothing.
   The moment a key exists, `qa-live`'s S10 asks **4 real questions per Pages
   deploy** without anyone touching the UI. The code's caps are the first line;
   the Console limit is the backstop if they have a bug.
6. ⏸️ **DELIBERATELY WAITS FOR STEP 5 — one MCP call, not started.** Deploy
   `help-ask` **with the default `verify_jwt` (ON)** — see the `help-ask`
   entry above for the probe that reversed the earlier `--no-verify-jwt` advice.
   ⚠️ **A session CAN do this** (`mcp__Supabase__deploy_edge_function`, `files`
   = the three modules' contents, `entrypoint_path: "index.ts"`,
   `verify_jwt: true`), and one was started on 2026-10-09 and then **stopped on
   purpose**. The reasoning, because "I could, so I did" is the wrong default
   here: the tool takes file CONTENT inline, so deploying from a session means
   re-emitting ~75KB verbatim, `prompt.ts` among it — the one module that defines
   what data crosses the Anthropic boundary. A single-character corruption there
   is a safety defect, and **FR-17 renders every failure as the same quiet
   notice**, so a corrupted deploy is indistinguishable from an undeployed one
   until somebody reads the function logs. Against that: with no
   `ANTHROPIC_API_KEY` the deployed function answers nothing, so an early deploy
   buys **zero** working behaviour. Non-zero risk, zero present benefit — so it
   goes with step 5, in one sitting, where the result can be checked against a
   real answer rather than against a notice that means nothing.
   ⚠️ **It is THREE modules — `index.ts`, `handler.ts`, `prompt.ts` — and they
   deploy together.** `index.ts` imports the other two, so pasting it alone into
   the Dashboard editor fails at import, which FR-17 then renders as the same
   quiet notice as everything else. Deploy the whole `supabase/functions/help-ask/`
   directory (the `.test.mjs`/`.test.ts` files are harmless but need not ship).
   ⚠️ Also set an **Anthropic Console workspace spend limit** before or with this
   step. The code's caps are the first line; the Console limit is the backstop if
   they have a bug, and it is named as the backstop in this file's security
   constraints without ever having been a step here.
7. **Merge PR #254, and wait for the Pages deploy to finish.**
8. Ask one question as a signed-in client and confirm an answer renders. FR-17
   makes every failure look identical, so this is the only step that proves the
   deploy worked. If it still shows the notice, read the function logs: the
   `where` field names the stage (`guide`, `records`, `reserve`, `provider`).

### ⚠️ THE SUPABASE MCP WILL NOT RUN A `DROP` FROM THIS ENVIRONMENT (measured 2026-10-09)

Found while applying steps 1-2, and it is a constraint on *how migrations are
written here*, not a one-off.

| statement | result |
|---|---|
| `create table if not exists …` | returns instantly, applied |
| `alter table … add column if not exists …` | returns instantly, applied |
| `alter policy … with check (…)` | returns instantly, applied |
| `grant …` / `revoke …` | returns instantly, applied |
| `drop policy if exists …` | **hangs 60s, applies nothing** |
| `drop table if exists …` | **hangs 60s, applies nothing** |

True of **both** `apply_migration` and `execute_sql`. **Postgres is not the
bottleneck**: `set local lock_timeout = '5s'` and `set local statement_timeout =
'15s'` never fire, and `pg_stat_activity` shows nothing waiting on a lock — so
the 60s is the MCP layer, not a blocked statement. Four timeouts, zero effect,
confirmed by reading `pg_policies` and `supabase_migrations.schema_migrations`
after each.

**What to do about it, and what NOT to do.** Write the statement as `ALTER
POLICY` where that reaches the same end state — it does for every `DROP POLICY` +
`CREATE POLICY` pair in this repo, and it is the better statement anyway, since
there is no window in which the table has no policy for that role. **Do not route
a DROP through a `DO $$ … execute '…' $$` block to get past the classifier**:
whatever that gate is for, evading it is not a session's call.

Consequence for `apply_migration` specifically: it was unusable for all three of
these, so they were applied with `execute_sql` and the
`supabase_migrations.schema_migrations` row was written by hand (version, name,
statements), which is what `apply_migration` does. Versions match the filenames
in `supabase/migrations/`, so `list_migrations` still agrees with the directory.

⚠️ **One piece of litter, and it needs one line from the owner.** A table
`public._mcp_write_probe` exists in `public` — it was the single-statement probe
that established the above (CREATE worked, so writes were possible at all), and
`drop table` then hung, which is exactly the finding. It has no grants, no RLS, no
rows and nothing references it. It carries a `COMMENT` saying all of this. Remove
it in the Dashboard SQL editor: `drop table public._mcp_write_probe;`

⚠️ **Verification comes AFTER the merge, and that ordering is forced, not a
preference.** This list had them the other way round — verify at 7, merge at 8 —
and that gate could never be cleared. `help-ask` fetches its corpus from
`${APP_URL}/content/help-guide.json`, i.e. the **served** GitHub Pages copy, and
returns `unavailable` when that fetch is not ok (`index.ts` `loadGuide` →
`handler.ts`). `content/help-guide.json` lives only on this feature branch, so
until the merge that URL is a 404 — **measured 2026-10-07: 404, while
`content/coverage.json` beside it returns 200.** So the old step 7 could only
ever produce the quiet notice, and the list itself says FR-17 makes that
indistinguishable from every other failure. An operator following it would either
stall on an unclearable step or merge without the one proof it calls the only
proof.
Merging first is safe for exactly the reason the `help-ask` entry already gives:
an undeployed or unreachable function renders FR-17's single notice, not a broken
page. If step 8 fails, the fix is a follow-up PR, not a revert.
(An `APP_URL` override pointing at a host that serves the branch's corpus would
also work, and is the escape hatch if a pre-merge proof is ever required.)

## Backend (Supabase — provisioned)
- **Project:** `insurance` · ref `bdsegmjcgfmgzuxwiplj` · URL `https://bdsegmjcgfmgzuxwiplj.supabase.co` (us-west-1)
- **Auth:** Supabase Auth (broker invite + password). RLS keys on `auth.uid()`.
- **Write model:** clients have full CRUD on their **own** entities/assets; `policies` are **read-only to clients** (broker-written via service-role, the system of record).
- **Keys:** publishable/anon key → client (safe in browser, RLS is the guard); `service_role` key → `DB_SERVICE_KEY` GitHub secret, server-side only. `DB_URL` = the project URL.
- **Migrations** live in `supabase/migrations/` and were applied via the Supabase MCP (versions match `list_migrations`). Front-end is wired to the live project; the Keep reads/writes real data under RLS. Three demo logins are seeded (a bare username is expanded to `<name>@example.com` by `signIn`): `user` / `keep-demo-2026` (client view, owns the seeded data; prefilled on the login screen), `broker` / `keep-demo-2026` (broker view; reviews and sends to underwriting), and `underwriter` / `keep-demo-2026` (underwriter view; owns the underwriting → approved/declined decision). Request lifecycle: requested → broker_review → underwriting → approved (+ declined).
  ⚠️ **TWO OF THOSE THREE LOGINS DID NOT WORK UNTIL 2026-10-09, and this line said
  they did.** `broker@` and `underwriter@` returned **HTTP 500 "Database error
  querying schema"** from `/auth/v1/token` — for as long as they had existed.
  Cause: they were created with a hand-written `insert into auth.users` that left
  `confirmation_token`, `recovery_token`, `email_change_token_new` and
  `email_change` **NULL**, where `user@` has `''`. GoTrue scans those into
  non-nullable Go strings, so a NULL fails the scan and surfaces as an error that
  names the *schema* and says nothing about the row — which is why the symptom
  never led anyone to the cause. Repaired by
  `migrations/20261009210100_auth_users_null_token_columns.sql`; all three now
  return 200 with a token, measured. **Nothing covered it:** S9 signs in as the
  CLIENT, and S11–S13 fake their own sessions — so the broker and underwriter
  views, and the whole request lifecycle above, had never been exercised by
  anybody. Found only because a *security* fix needed a real broker session to
  verify. Create future auth users through the dashboard or the Admin API; the
  seed's prerequisite note now says so.

## Required Commands
| Purpose | Command |
|---|---|
| Validate HTML | `npx html-validate index.html` |
| Validate workflow YAML | `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/qa.yml'))"` |
| Unit tests | `node --test $(find js supabase/functions -name '*.test.mjs')` |
| Contrast guardrail | `node .github/scripts/check-contrast.js` |
| Job bounds guard | `python3 .github/scripts/check-job-bounds.py` |
| Workflow reference guard | `python3 .github/scripts/workflow-ref-guard.py` |
| Viewport classes guard | `node .github/scripts/check-ui-viewports.js --tests-dir .github/scripts/ui-tests` |
| Asset manifest guard | `node .github/scripts/check-asset-manifest.js` |
| Undefined-call guard | `node .github/scripts/check-undefined-calls.js` |
| Keep back-route classification | `node .github/scripts/check-keep-back-routes.js` |
| Python compiles clean | `python3 .github/scripts/check-py-warnings.py` |
| ui-suite env parity | `python3 .github/scripts/check-ui-suite-env.py --kit-dir .github/scripts/ui-tests` |

**Required watchers (`.github/workflow-ref-required.json`).** The guard checks
two different things and only that file supplies the second: rule 1 is that
every `workflow_run` name **resolves**; rule 2 is that a **required** watcher
never goes **missing**. Without an entry, a refresh can delete a `workflow_run`
trigger outright — or repoint it at some other real workflow — and the guard
stays green, because nothing dangles. `pages-retry.yml` is registered against
`pages-build-deployment`: it watches GitHub's **managed** Pages build, so there
is no local file whose deletion would signal the breakage. Drop the entry only
in the same change that deliberately stops it watching. The other watchers are
not registered — doing so asserts their current lists are invariants, a broader
claim than has been established. **The file holds no comments; JSON has none,
and a `_comment` key is read as a workflow filename and fails the guard.**

**Local Playwright ceiling — MEASURED 2026-10-06, replacing a wrong record.**
The previous version of this section said *"the webkit profiles do not run at
all"* and *"no webkit or firefox in the sandbox image"*, re-verified 2026-10-05
by listing `/opt/pw-browsers`. **Both claims were wrong, and the method was the
one `test.md` forbids.** That section says: *"Absent is not unavailable — a
browser missing from the image may be installable. Run the ladder rather than
judging by eye."* This file even stated the principle while recording an
eye-check as verification; the tool that settles it
(`.github/scripts/browser-ladder.js`) was not installed here until this refresh,
which is the whole reason the wrong answer survived two sessions.

What is actually true, measured by running it:

| check | result |
|---|---|
| `browser-ladder.js webkit` | **LAUNCHES** at rung `install --with-deps` |
| `browser-ladder.js firefox` | **LAUNCHES** at rung `install` |
| `--project=tablet` (webkit), S1 + S7 | **2 passed**, 15.5s |
| `--project=iphone` (webkit), S1 + S7 + S8 | **3 passed**, 14.5s |

So the webkit profiles RUN LOCALLY. They need one `playwright install
--with-deps webkit` first; absent from the image is not absent from the
sandbox. A stale ceiling reads as current and silently suppresses a check that
would catch a real defect — this one suppressed two whole viewport profiles.

**What still does not run here: S5/S6/S9**, which need a live Supabase read the
sandbox browser cannot complete. Re-measured 2026-10-08: S5 and S6 still fail
locally, and they fail identically on the pre-change spec — checked explicitly
before attributing the local suite's state to a new change.

**S11–S13 DO run here, on all four projects** (measured 2026-10-08: 12 passed,
~32s, desktop + tablet + mobile-chrome + iphone). They are the Keep's first
locally-executable authenticated scenarios, and the reason they work is that the
route guard reads `localStorage` rather than the network — see the S11–S13 record
below. That does not change the S5/S6/S9 line: those exercise real reads, and
these intercept them.

⚠️ **The ladder grades browser STARTUP only, and says so itself:** *"network
egress, DNS, TLS, filesystem limits and every other sandbox constraint are all
still open questions."* A launching browser is not a passing suite.

⚠️ **Do NOT treat "curl 200 + browser failure" as proof of environment.** That
inference was retracted upstream (`claude.directives` #331, `d886513`) and is
unsound in both directions: curl succeeding shows the *host* is reachable, but
the browser failing is equally consistent with a real app defect — a JS
exception before the fetch, a bad URL, a selector regression. It decides
nothing. Likewise **do not classify by failure duration.** Grade on **what
actually happened** — read the log and name the assertion — never on a cheap
correlate.

Vendoring the Supabase client (2026-08-26) fixed the *module-load* half and
recovered S7/S8 — the app boots offline. It did not change the *runtime
request* half, which is why S5/S6 still fail here.

**What would make this record wrong** (re-check before relying on it): the
sandbox gains a browser egress path; the proxy configuration changes; S5/S6 stop
depending on a live Supabase read; or `browser-ladder.js` stops reporting
LAUNCHES for webkit or firefox. Re-check by **running the ladder and the
profile**, never by listing a directory.

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
  advisory, and every `/refresh-repo`). Reproducibility is pinned by
  `js/vendor/package-lock.json` and `npm ci` — pinning only the two *named*
  packages left transitive deps on ranges, so the recorded sha256 was not
  actually reproducible. The regenerate block is **run from the repository
  root** and enters `js/vendor/` itself — do not `cd` there first. Before that
  `cd` existed the block wrote to the root and left the deployed bundle
  untouched, so a security refresh would have verified a file nobody serves.
- **Secrets stay server-side:** the email provider key lives only in the Edge Functions (`notify-enhancement` today; `notify-lead` when it ships). No service-role key is ever shipped to the client. `ANTHROPIC_API_KEY` (feature 003) is the same: an Edge Function secret only, never a client one — a browser-held model key is a blank cheque drawn on the owner's account, readable by anyone who opens devtools.
- **Anthropic is a sub-processor as of feature 003 (the Help desk).** `help-ask`
  sends the question the client typed, the `content/help-guide.json` corpus, and
  a **compact digest** of that client's own records to the Claude API to ground
  the answer. The digest is **exactly these columns** (`help-ask/handler.ts` — the logic moved there so it could be executed):
  entities `name, kind`; assets `name, type, value`; policies `line, carrier,
  number, status, effective_date, renewal_date, premium_amount, premium_period,
  coverages`.
  ⚠️ **`status` and `effective_date` were added 2026-10-09 — a CORRECTNESS fix,
  not an enrichment.** The prompt told the model to work out `"still active"` and
  the digest carried only `renewal_date`, so a **cancelled** policy, or one whose
  cover had not started, read as active: a future renewal date looks exactly like
  an active policy renewing later. Answering "is my flood policy still active?"
  wrongly is the worst error this feature can make, because reading a policy
  state back is precisely what it is for. Both columns had existed in `policies`
  all along and neither was selected; found by Codex.
  What it costs in disclosure is small and checkable: `effective_date` is
  **already rendered to the client** on the policy detail page ("Effective"), and
  `status` is broker-written policy state — not contact details, credentials or
  document content. The prompt now names both and **forbids the inference it used
  to invite** ("a renewal date in the future does NOT by itself mean a policy is
  active"). Two tests gate this list against the code and **both failed on the
  change**, which is exactly their job: `handler.test.mjs`'s sentinel sweep
  ("no more, no less") and `schema.test.mjs`'s documented-column list.
  **`coverages`
  was added 2026-10-06 and is the widest of these** — it is the broker-written
  jsonb the policy view renders limits from, so coverage LABELS and LIMITS now
  cross the boundary (capped at 20 lines per policy, since it is unbounded and
  re-sent on every question). It is in because the prompt lists "Your flood
  policy's dwelling limit is $400,000" as an ALLOWED fact and nothing loaded the
  column it lives in, so the feature could not answer its own headline example.
  Reading a limit back is a fact; whether the limit is *enough* is the
  determination the boundary refuses. Policy numbers are in
  because "read back what's on my file" is a question the desk is *for* — and
  until 2026-10-06 that column was **selected and then discarded**, so this
  paragraph over-stated what crossed the boundary while the feature
  under-delivered. Re-check this list against `ownRecords`'s `facts.push` calls,
  not just its `select`.
  ⚠️ **Take the names from the TABLES, not from the nested shape the views
  consume.** This function shipped selecting `assets.kind` and
  `policies.policy_number`; the columns are `type` and `number` (`js/supabase.js`
  renames them on the way through, which is where the wrong names came from).
  PostgREST answers a missing column with `{ data: null, error }`, the error was
  discarded, and every client's records read as "nothing on file yet" — on a
  feature whose premise is answering from their records. `supabase/functions/
  help-ask/schema.test.mjs` is now a gate on it, and reproduced the bug before
  the fix. What this means in practice:
  - It is **owner-scoped server-side**, from the JWT — never from the request
    body. The browser already holds those rows under RLS so sending them with the
    question would be simpler, and is the one shape that cannot be made safe: a
    crafted body is a request to ground an answer on records the caller does not
    own. (Feature 002's review found exactly that as an IDOR.)
  - **No contact details, no credentials, no document contents and no other
    client's rows** go in the digest — the column list above is the whole of it,
    and the row **ids never cross the boundary** — the join keys stay inside the
    function, and `prompt.ts`'s `RecordFact` is `{kind, name, label, value}`.
    `supabase/functions/help-ask/prompt.ts` renders it. That module is pure
    and unit-tested, so everything that leaves the project is reviewable in one
    file. Widening the `select` widens what is disclosed; treat it as a change to
    this constraint, not an implementation detail.
  - **Spend is capped before the call, not after:** 20 asks per client per hour
    **and 400 across all clients per day**, reserved in `help_queries` *ahead* of
    the model call and released if nothing was billed — which includes a provider
    HTTP error (a rejected request generates no tokens), but NOT a timeout, where
    billing is unknown and must resolve the same way as billed. A failed model call
    is still billed, so recording usage on success only is a bypass. A throttle
    that cannot count **fails closed**. The aggregate cap is not redundant: the
    per-client one is keyed on `owner`, and this file publishes three demo
    credentials — while Supabase Auth **self-signup, if enabled, makes the number
    of accounts unbounded and that cap with it. Check before deploying.** The
    trade-off is stated in the code: one abuser can take the desk down for
    everyone, which is the same trade the Console spend limit makes, earlier.
  - **Neither channel is sanitise-then-concatenate any more**, and the history is
    why. The question used fixed `<question>` delimiters defended by a regex;
    that regex was exact-match (four escapes), then loose (a ReDoS: 14.8s on a
    100k name), and still missed `<\/question>`, a zero-width space inside the
    word, fullwidth and HTML-entity forms. Records had the same shape and were
    forgeable with a plain newline. Both were redesigned rather than patched
    again, per `global.md` → *Review Rounds Have to Terminate*:
    **the question block carries a per-request nonce** (`<question-a1b2c3…>`), so
    there is no fixed string a client can type to close it; and **every record
    value is JSON-encoded**, so the boundary is syntactic and no content can
    create structure. `deFence` and a control-character flatten remain as belt,
    not as the boundary.
  - **CORS stays `Access-Control-Allow-Origin: *`, deliberately.** Credentials
    travel in an `Authorization` header, not cookies, and `Allow-Credentials` is
    unset, so there is no ambient-credential CSRF and a hostile page cannot read
    the token cross-origin. Echoing one origin would be mild hardening, and it
    is still not taken — but ⚠️ **the reason recorded here has expired.** It read
    "not taken in the same change as the `--no-verify-jwt` decision", which dates
    the caution to a decision this feature **reversed**: the deploy is now
    `verify_jwt` ON (see the `help-ask` entry), so a reader meeting this line
    first would take the old flag for current advice. The caution itself still
    holds, against the deploy that has not happened yet: the function is
    undeployed, FR-17 renders every failure as one notice, and the 2026-10-07
    probe showed the gateway flag and CORS touch the *same* request path — the
    preflight reaches the function, an unauthenticated POST never does. Changing
    both at once is how a deploy fails for a reason nobody can distinguish.
    Revisit once owner-gate **step 8** has proved one real answer renders. (This
    said "step 7" — written before the gate was reordered in the same round, so
    it pointed at what is now the merge. The proof is step 8.)
  - An Anthropic Console workspace spend limit is the backstop if that has a bug.
- **No broker-facing LEAD UI:** brokers consume *leads* via Supabase + email —
  there is no lead-reading path in the static app. ⚠️ The second half of this
  line used to read "so no privileged read path exists in the static app",
  which **stopped being true when the Keep shipped broker/underwriter views.**
  `js/keep/views/policies-view.js` renders staff controls off `role`, and
  `enhancement_requests` carries four role-keyed RLS policies
  (`er_broker_select/update`, `er_underwriter_select/update`) that let staff read
  and write **every** client's requests from the browser. That is a privileged
  read path in the static app, and the next constraint is why it matters.
- **⚠️ PERMISSIVE RLS POLICIES `OR` THEIR `using` AND THEIR `with check`
  *INDEPENDENTLY* — a lesson, not a one-off, and it cost a HIGH finding on
  2026-10-09.** It is not "some one policy must satisfy both clauses": for an
  UPDATE, Postgres needs *some* applicable policy's `using` to admit the OLD row
  and *some* applicable policy's `with check` to admit the NEW one, and those can
  be **different policies**. Both `enhancement_requests` UPDATE policies are
  PERMISSIVE and `to public`, so both apply to every authenticated caller.
  `20261005120000_enhancement_request_stage_guard.sql` put the role in `using`
  and the allowed statuses in `with check`, which reads as "a broker may write
  the broker statuses" and **means nothing of the kind**: a broker passed `using`
  via its own policy and `with check` via the *underwriter's*, whose check named
  statuses and no role — so a broker could still set `approved`, the single
  transition the migration existed to prevent.
  **Reproduced in a throwaway PostgreSQL 16.13** before fixing: as written, the
  broker's `approved` update SUCCEEDED; with the role predicate repeated inside
  each `with check`, it raises *"new row violates row-level security policy"*
  while broker→underwriting and underwriter→approved both still pass. Then
  **verified on the live project as a real broker session**: HTTP 403 / 42501,
  row unmoved. Fix: `20261009210000_er_stage_guard_role_in_with_check.sql`.
  **The duplicated predicate is load-bearing**, not redundancy — deleting it from
  either clause reopens the hole. RESTRICTIVE policies are *not* the alternative
  here: they AND together, so these two as restrictive would require a caller to
  be both roles at once and no staff account could update anything.
  ⚠️ **And note what nearly let it ship:** the migration's own post-apply probe
  asserted `pg_policies.with_check IS NOT NULL`, which passes against the broken
  version. A probe must assert the DENIAL, not the presence of a clause. Caught
  by an automated security review of the applying commit — not by the probe, not
  by CI, and not by the review rounds on the PR.
- **✅ CLOSED 2026-10-09 — `profiles.role` was self-assignable.** Kept here rather
  than deleted, because the shape of the hole is the reason the fix is a column
  `REVOKE` and not a policy.
  **What it was:** `authenticated` held table-level `UPDATE` on `public.profiles`
  (every column, `role` included) and the only policy on it was
  `using (id = auth.uid()) with check (id = auth.uid())` — no column restriction,
  no trigger. So one PostgREST call from the browser,
  `supabase.from("profiles").update({ role: "broker" }).eq("id", uid)`, promoted
  any signed-in client to staff, reachable with the demo credential this file
  publishes and the login screen prefills.
  **Why a column grant and not a policy:** RLS evaluates whole rows, and `with
  check` sees only the NEW row, so it cannot express "this column may not
  change". Column-level privileges are the only mechanism in Postgres that says
  it without a trigger.
  **Applied as** `supabase/migrations/20261005120100_profiles_role_not_self_assignable.sql`
  (via `ALTER POLICY` rather than the written `DROP`+`CREATE` — see the DROP note
  in the owner-gate section). `authenticated` now holds `UPDATE` on
  `reminder_email, reminder_schedule` **only**, and no `INSERT` at all.
  **Verified as a real client session**, not service-role — a password grant
  against `/auth/v1/token`, then PostgREST with that bearer:
  `role='broker'` → **HTTP 403 / 42501**; `reminder_email=true` → **204** (the
  Account page's own write still works, which is the half a probe checking only
  the denial would miss); `insert into profiles` → **403 / 42501**;
  `select id, role` → **200, one row**.
  **What the fix did NOT close, and is still live:** `er_broker_update` has no
  `with check` on `owner`/`subject`/`body`, so a *genuine* broker or underwriter
  can still rewrite those columns on any client's enhancement request, not just
  the status. Narrower than before (no client can become one), and recorded in
  `supabase/migrations/20261005120000_enhancement_request_stage_guard.sql`.
- **⚠️ `service_role` HAS NO TABLE PRIVILEGES IN THIS PROJECT (live, measured
  2026-10-06).** Not a trade-off — a fact that invalidates the obvious way to
  write a server-side reader, and it nearly shipped feature 003 dead.
  `has_table_privilege('service_role', 'public.<t>', 'SELECT')` is **false** for
  `profiles`, `entities`, `assets`, `policies` and `enhancement_requests`; it
  holds only `REFERENCES/TRIGGER/TRUNCATE`, is a member of no other role, and
  **`BYPASSRLS` skips POLICIES, not PRIVILEGES.** Supabase's "service_role reads
  everything" default does not hold here.
  **Consequence for any Edge Function:** a service-role read of a client table
  returns `42501`. `help-ask` was written that way and would have refused every
  caller on its first query the moment it deployed — rendered by FR-17 as the
  same quiet notice as "not deployed yet", so nothing would have shown why. It
  now reads client records through the **caller's own client** (anon key + their
  JWT), where `authenticated` does hold SELECT and RLS scopes rows to
  `owner = auth.uid()` — which is also stronger, since RLS cannot be removed by
  editing a `.eq()` out of the handler. `service_role` is used for `help_queries`
  alone, and that works only because `supabase/proposed/20261006_help_queries.sql`
  grants it explicitly.
  **⚠️ NOW MEASURED, AND WORSE THAN "VERIFY BEFORE RELYING":** this said *"the
  deployed `notify-enhancement` reads `enhancement_requests` under the same key,
  so it has the same denial. Verify before relying on its emails."* Verified
  2026-10-09, both halves:
  - `has_table_privilege('service_role', …)` is **false** for SELECT, INSERT and
    UPDATE on `profiles`, `entities`, `assets`, `policies`,
    `enhancement_requests`, `leads` and `rule_settings` — every table in the
    schema. The sole exception is **`help_queries`**, where SELECT and INSERT are
    true *because `20261006120000` granted them explicitly*. That is direct
    confirmation that the grant in that migration is load-bearing rather than
    tidiness, which is what its comments claim.
  - `notify-enhancement/index.ts` builds an `admin` client from
    `SUPABASE_SERVICE_ROLE_KEY` (line 87) and its **first** database call is
    `admin.from("enhancement_requests").select("*")…maybeSingle()` (line 100),
    with three `update`s on the same table after it (lines 137, 189, 211).
  So the function returns `42501` on the first query of **every** invocation. It
  is not "unverified" — it is **non-functional**, and this file lists it as
  "deployed and ACTIVE", which reads as working. No enhancement-request email has
  ever been sent.
  **The remedy is one statement**, and it is deliberately NOT applied here:
  `grant select, update on public.enhancement_requests to service_role;`
  Widening `service_role`'s reach over a client table is a security decision, not
  a bug fix — and feature 003 deliberately went the other way, reading client
  records through the **caller's own** client so RLS still scopes them. The same
  question applies here and should be answered on purpose: whether this function
  needs cross-client reach at all, or should take the caller's JWT like
  `help-ask` does. Outside feature 003's scope; recorded so it is a decision
  rather than a surprise.
- **⚠️ OPEN — public sign-up is ENABLED, so "invite-only" is not true today
  (live, measured 2026-10-06).** `GET /auth/v1/settings` on the project returns
  `disable_signup: false`, `external.email: true`, `mailer_autoconfirm: false`.
  No trigger or policy in `supabase/migrations/` enforces invitation. So anyone
  can create an account against this project, confirm a mailbox, and sign in —
  and `js/main.js`'s Keep guard only requires a session.
  **What it contradicts, in the product's own words:** the Security page card
  "Invite-only access — Accounts exist only by broker invitation. There is no
  public sign-up to your portal." (`js/keep/views/keep.js`), this file's own
  "invite-only client portal", and `content/help-guide.json`'s security topic —
  which the Help desk is grounded on, so the desk would repeat the claim to a
  client who asked.
  **Blast radius is narrow but not nil.** RLS keys every table on
  `owner = auth.uid()`, so a self-made account sees an empty Keep and no other
  client's data. What it costs is spend: `HOURLY_CAP` is per ACCOUNT, so 20 paid
  asks per account an hour, and about twenty accounts exhaust the shared
  `DAILY_TOTAL_CAP` and refuse the desk to every real client for a day.
  **✅ THE SPEND HALF IS NOW CLOSED (2026-10-09).** `help-ask` requires a
  `profiles` row before it will reserve a slot or spend anything, and that row is
  no longer client-writable: `revoke insert on public.profiles from authenticated`
  is live (`migrations/20261005120100_profiles_role_not_self_assignable.sql`,
  which carries the same statement as the proposed `..._no_client_insert.sql`).
  Measured as a client session: `insert into profiles` → **HTTP 403 / 42501**.
  Nothing creates such a row otherwise — no trigger, and `service_role` has no
  INSERT on the table either — so a self-signed-up account can authenticate, see
  an empty Keep, and **never reach a paid ask**. The check is a boundary now, not
  defence in depth.
  ⚠️ **What is still open is the PRODUCT CLAIM, and only an owner can close it:**
  turn off "Allow new users to sign up" in Supabase Auth, or the Security card
  stays untrue. There is no Supabase MCP tool for auth config and the Management
  API needs a PAT no session holds — so this cannot be done from here, and
  re-measuring `GET /auth/v1/settings` is the way to confirm it when it is.
  Deliberately NOT reworded to match the current setting — the wording describes
  the intended state, and the config is what is wrong.
- **Shared Supabase account (accepted trade-off, temporary):** this project (`insurance`, ref `bdsegmjcgfmgzuxwiplj`) and `apfp` (ref `qnjrwbgxywkdfbfuzwas`) share one Supabase account/org, and a Supabase PAT is account-wide — so the MCP credential can reach both. Accepted for now (both pre-production, same owner). **Before production: split into per-project Supabase accounts/orgs** so a leaked PAT can't cross projects.
- **Operating rule — single-project scope:** from this repo's sessions, only ever touch the `insurance` project (`bdsegmjcgfmgzuxwiplj`). **Never** read from or write to `apfp` (`qnjrwbgxywkdfbfuzwas`). (Best enforced by adding `--project-ref=bdsegmjcgfmgzuxwiplj` to the Supabase MCP config in the web environment.)

### Auth-gate readiness: proven, not windowed (wired 2026-10-06)

`test.md` → *Playwright* makes "no auth gate found" a **window** unless the
project turns it into a proof: the kit settles, looks, and reports absence, and
absence at time T is not absence at T+1 — so an app whose gate-deciding request
is still in flight produces a green on auth that was never exercised.

This repo had the defect in its plumbed-through form, which is worse than not
having the feature: `.github/scripts/ui-tests/tests/app.spec.js` already carried
`awaitAuthReady()` reading `TEST_AUTH_READY_SELECTOR` / `TEST_AUTH_READY_REQUEST`,
and **neither `qa.yml` nor the `ui-suite` composite passed them**, so the
function could only ever take its `'windowed'` branch. The code's own comment
promises *"A CONFIGURED CONDITION THAT NEVER RESOLVES IS LOUD, not a silent
fallback"* — a promise it could not keep, because nothing could configure it.
Found by `check-ui-suite-env.py`, which exists for exactly this (#320), on its
first run here.

Now wired: `qa.yml` passes `vars.TEST_AUTH_READY_SELECTOR`,
`vars.TEST_AUTH_READY_REQUEST` and `vars.TEST_AUTH_SUCCESS_SELECTOR` into the
composite. They are **repository variables, not secrets** — a masked selector is
unreadable in a failure message.

⚠️ **Still unset, so the answer is still `windowed` — the plumbing is fixed, the
proof is not.** To get a decided answer, set as repository *variables*:
`TEST_AUTH_READY_SELECTOR` to a selector matching **either** outcome:
`.k-authcard, .k-welcome__h` — the login card **or** the signed-in home heading.
One naming only the gate times out on every signed-in run.

⚠️ **NOT `.k-h1` — an earlier version of this very paragraph said to use it, and
that would have turned `qa-live` red on the first run after the variable was
set.** `.k-h1` appears on Entities, Policies, Documents, Account, Assets and the
add/request forms, and on **neither** the login card (its title is `.k-atitle`)
nor the signed-in home view, which is where a successful login lands —
`go("#/keep")` → `el("h1", { class: "k-welcome__h", … })` (`js/keep/views/keep.js:178`).
S9 already asserts `.k-welcome__h` for exactly this reason, with its own comment
saying why not the bare text.

`TEST_AUTH_SUCCESS_SELECTOR` is **optional and arguably redundant here**: S9
already proves the dashboard renders after a real login. If you set it, use
`.k-welcome__h`. A configured condition that never resolves FAILS rather than
falling back, by design — which is why the wrong selector is loud, not silent.

### ⚠️ OPEN — the Help desk's credit lines bypass the canonical-label modules

**Found by review round 4, verified 2026-10-07. Recorded, not fixed** — it is a
real breach of this file's own *"One canonical label, one shared module
(always)"* rule, and there is no minimal fix.

Under "Based on", `help-view.js` renders what the function sent, and the function
sends `` `${clipField(f.name)} — ${clipField(f.label)}: ${clipField(f.value)}` ``
straight off the row. So the client sees:

| the desk shows | every other Keep screen shows | via |
|---|---|---|
| `Me — type: personal` | `UBO` / `You` | `entity-display.js` |
| `type: auto` | `Vehicle` | `ASSET_META` |
| `$900000` | `$920K` | `money` (`shell.js`) |
| `2027-03-12` | `Mar 12` | `dateShort` (`shell.js`) |
| `$2400 / yr` | `$2,400 / yr` | `formatPremium` (`policies.js`) |

**Why the one-line fix is wrong.** The obvious move — send raw values and format
in the view — changes the prompt, because **the same `facts` array feeds both**:
`buildPrompt({ question, topics, facts, today })` and the credit lines read the
identical objects. Turning `value: "$900000"` into `900000` changes what the
model is grounded on and what CLAUDE.md's disclosure paragraph documents as
crossing the boundary. `handler.ts` says in terms that the premium period is
carried *because* "$2,400" alone is ambiguous to a reader — that formatting is
deliberate, for the model.
A correct fix needs a **separate client-facing projection** alongside the
model-facing one: the wire sends `{kind, name, label, value}` plus raw typed
fields, and the view dispatches on `(kind, label)` through the shared modules.
That touches the prompt (this feature's safety-critical surface), the wire
contract, the disclosure record and tests on both sides. It is a presentation
defect, not a correctness or security one, and it is not worth doing hurriedly
inside the safety boundary. `dateShort` takes **days, not an ISO string**, so
reuse is not a drop-in either.
Also missing while this stands: the entity **subtype** ("LLC") is never sent, so
"what kind of entity is Coastal Cafe?" can only answer "business".

### ✅ RESOLVED — `help-view.js`'s answer branch is executed (S11–S13, 2026-10-08)

Was OPEN: `specs/003-help-desk/plan.md` Key decision 3 names the view the only
**model-independent** layer — it renders the AI label (FR-10) and the broker
channel (FR-8) on every answer regardless of payload — and nothing ran that
branch. S10 self-skips off `LIVE_TARGET` locally, reaches only the NOTICE branch
live until `help-ask` deploys, and its broker assertion sits behind
`if (answer present)` so it is skipped on exactly the runs that cannot answer.

**Closed by S11, S12 and S13** — three scenarios that need no backend and no paid
call, all four viewport projects green locally (webkit included). What each one
asserts lives in the **Project-Specific Test Scenarios** table below and nowhere
else: a second copy here would be the two-records-one-fact drift this file has
been bitten by more than once.

**How it works, and why it is not the overlay this file forbids.** The guard calls
`getSession()` (`js/main.js:97`), which reads `localStorage` with **no network
call** while unexpired, then passes `session.user` into `ensureData()` — so
`/auth/v1/user` is never requested. The storage key is read off the vendored
client itself (`sb-${hostname.split(".")[0]}-auth-token`), and the corpus is
fetched **relatively**, so the local static server serves the real 15-topic file
and credits resolve through the real corpus. Only `/rest/v1/*` and
`/functions/v1/help-ask` are intercepted, with `page.route`. **Nothing touches the
app's modules** — the real client, adapter and views run unmodified, which is the
distinction from the committed `supabase.js` overlay this file rules out (that
rule is about a mocked DATA PATH shipping in the app).
The REST fixture is keyed on the **bearer's `sub`**, not on the seeded user, so
S13's identity switch is genuinely owner-scoped the way RLS is.

**Mutation-tested, 10 of 10 caught**, including the two historical defects: gating
the broker channel on the model-controlled `reason`, and dropping the owner stamp
from the restore (which reproduces the sign-out leak a security review caught
after the fact). ⚠️ **One mutation survived the first version** — deleting the AI
label from the in-flight branch — because the in-flight assertions used
`toHaveCount`, which RETRIES: by the time it polled, the response had arrived and
the answer had restored the label, so it passed against the wrong state (visible
in the duration: 1.4s instead of 6.3s). A transient state cannot be checked with
a retrying assertion. `routeHelpAsk` now takes a **gate** the test releases, so
the response cannot have arrived and one non-retrying snapshot is exact.

### ✅ RESOLVED — every credited destination has an origin-aware way back (2026-10-08)

Found writing S13, fixed the same day. FR-11 invites the client to follow a
credited source to check an answer, and the destinations are the Keep's own
screens — so a one-way trip makes the invitation hollow.

⚠️ **THE RECORD OF THIS, WRITTEN HOURS EARLIER, OVERSTATED IT TWICE.** It said
`originBackRow()` is "rendered by only three call sites" and named
`#/keep/insurance` as the gap. Both were products of grepping for ONE spelling:
- **`backLink()` is also origin-aware** — it calls `originHref(fallback)`, and it
  has nine call sites. A per-function scan for `originBackRow` alone reported 16
  of 18 views as having nothing.
- **`kProgress`'s cancel is too** — `renderKeepAddAsset` passes
  `() => go(originHref("#/keep"))`, so the add-asset form was never missing one;
  it renders `.k-back` inside `.k-progress`, not `.k-backrow`, so a probe keyed on
  `.k-backrow` read it as absent.
- A shared helper in `entities.js` gives `#/keep/list` and `#/keep/grid` theirs,
  which the per-function scan attributed to `renderKeepEntities` only.

**Measured against the running app** (the offline S11–S13 harness, navigating from
`#/keep/help` and reading `.k-backrow a.k-back, .k-progress .k-back`), the real
gap was **three views of fifteen**: `#/keep` (home), `#/keep/assets` and
`#/keep/insurance`. Every other route already said "Back to help".

Fixed by adding `originBackRow()` to those three, plus `#/keep/assets` to
`KEEP_LABELS` so a control pointing AT the assets table names it instead of
reading a bare "Back". Home is the debatable one and is in deliberately: `home` is
a credited topic, and `originBackRow()` renders nothing without an in-app prior.

⚠️ **"Unless you actually arrived from somewhere" read narrower than it is, and
that wording hid a real defect for a day.** Two corrections, both from an
independent review of `7ed36e1` (round 7, 2026-10-09) that measured a **real form
login** rather than a deep link:

1. **The post-login landing page had a "Back" to the login card.**
   `renderKeepLogin` succeeds with `go("#/keep")` and `nav.track` runs on the
   login route too, so `#/keep/login` is the previous entry on the first screen of
   **every** signed-in session — and it starts with `#/keep`, so the prefix test
   admitted it. `dispatchKeep` renders that card for `sub === "login"` with no
   session check, so following the link showed a signed-in client the login form.
   Fixed in **one shared predicate**, `originRoute()` in `shell.js`, which
   `originHref` (nine `backLink` call sites + `kProgress`'s cancel) and
   `originBackRow` both now go through; S13 asserts `.k-backrow` count 0 right
   after the second sign-in. The earlier verification could not have caught it:
   it covered deep links and credited destinations, and only a real sign-in builds
   that stack.
   ⚠️ **`#/keep/login/` and `#/keep/login?x=1` route to the login card too** —
   `main.js` filters empty path parts — so the first version of the exclusion, an
   exact string compare, missed both. The pattern is anchored and admits a
   trailing `/` or a query string. Measured, not reasoned about.
1b. **Single-use forms were offered as back destinations as well**, found by the
   next review round against the same predicate: `#/keep/add-asset`,
   `#/keep/add-entity` and `#/keep/request/:id` are all routes the app navigates
   *away from* on success, so pointing a back control at one invites a second
   submission — on the request form that is a **duplicate enhancement request**.
   `KEEP_LABELS` already declined to name these routes, so before this they were
   both unnamed and offered: a bare "Back" to a blank form. Now excluded in the
   same predicate. `#/keep/requests` (the list) deliberately does not match.
   ⚠️ **`request` is matched BARE, and the first version of this got that wrong** —
   caught by Codex on the PR. `#/keep/request` with no id is the *general*
   enhancement form, linked from "New request" on My requests and from global
   search, and it submits to `#/keep/requests`, whose `backLink("#/keep","home")`
   then pointed straight back at the form it had just submitted. So the one route
   the exclusion was added for was the one it missed.
   ⚠️ **AND THEN THE DENY-LIST WAS REPLACED, because it had now failed twice.**
   `#/keep/login` and the bare `#/keep/request` were the same violated invariant —
   "a back control points somewhere harmful" — two rounds apart, and `global.md` →
   *Review Rounds Have to Terminate* says that when the same mechanism fails again
   across rounds the mechanism is in the wrong place: **redesign rather than patch
   it a third time.** A deny-list is incomplete by construction — a route added
   later is a candidate omission and nothing fails when one is missed.
   So `originRoute()` now reads an **allow-list**, `BACK_ELIGIBLE` in `shell.js`,
   keyed on the Keep sub-route (18 routes: 14 eligible, 4 not — `login` and the
   three single-use forms). Inverted, forgetting a route costs a **missing** back
   control, which is cosmetic, instead of one pointing at a login card or a
   submitted form. `keepSubRoute()` mirrors `main.js`'s own parse (strip query,
   split, drop empties), so the trailing-slash and query-string variants cannot
   diverge from what the router thinks a hash names.
   The other half is **`node .github/scripts/check-keep-back-routes.js`** (now in
   Required Commands and `qa.yml`): it asserts the table's keys are **exactly**
   `dispatchKeep`'s cases — set equality, not containment, so a stale entry cannot
   outlive its route either — and **fails closed**, reporting that it could not
   run rather than comparing two empty sets. Mutation-tested on four cases:
   dropped classification, stale entry, renamed table, router case removed.
   ⚠️ **AND `dispatchKeep` HAS TWO ROUTE FORMS, NOT ONE** — the first version of
   the guard only really read one. `login` is answered by an **early return above
   the switch**, because it must render before `getSession()` is consulted, and
   the guard hardcoded that single route (`if (/sub === "login"/)`). So a second
   session-free route added the same way (`if (sub === "reset-password") return
   …`) would have been invisible to the scan, left unclassified, and the guard
   would still have printed "18 routes match" — set equality advertised while a
   whole syntactic form was exempt. Found by Codex, with the mutation already run.
   The pre-switch region is now read per STATEMENT, and the distinction it draws
   is real: a returning statement comparing `sub` to string literals contributes
   those routes, while `if (!session) return renderKeepLogin()` is route-
   independent and correctly ignored. A returning statement that mentions `sub`
   in a shape the scan cannot read **fails the guard by name** rather than being
   skipped — that is what stops the next novel shape being silently exempt too.
   Re-mutated 6/6: the second early return (`===`, `==`, and split over lines),
   an unreadable `AUTH_ROUTES.has(sub)` (fails closed), a route-independent early
   return (correctly ignored), and a commented-out `case` (correctly ignored,
   since both files are now comment-stripped before scanning).
   ⚠️ One mutation **survived** the pre-redesign assertions and is worth keeping in
   mind: deleting the regex's `(?:[/?]|$)` tail passed, because the suite proved
   the exclusions it had added and nothing proved what they must **not** swallow.
   S13 now asserts both directions (`#/keep/requests`, the list, must stay a valid
   origin), and all three behavioural mutations against the allow-list fail it.
2. **A lateral app-bar tab switch counts as "somewhere".** Click Policies while on
   Entities and Policies shows "Back to entities". That is **pre-existing** —
   `#/keep/list` and `#/keep/grid` have always behaved this way — and it is what
   the origin-aware standard asks for, so it stays; but the three new call sites
   are app-bar destinations, so it is now visible on every tab switch rather than
   only after a credit. Recorded, not changed: scoping the row to
   `prev === "#/keep/help"` would make the control *not* origin-aware, which is
   the standard it was added to satisfy.

**Verified by measurement, not inspection**: all 15 Keep routes now return to
`#/keep/help` after a credit; and in a FRESH browser context a deep link to
`#/keep`, `#/keep/assets`, `#/keep/insurance` and `#/keep/list` shows **no** back
row, with an in-app visit then a reload going `true → false`.
⚠️ The first suppression check was a false positive: `page.goto` to a different
HASH does not reload the document, so the nav stack survived and the row stayed.
A fresh context or a reload is required to test this at all.
S13 now clicks the destination's own control instead of `page.goBack()`, and
asserts the suppression. Both mutation-tested: removing the row from Policies
fails with "no in-app way back to Help", and making `originBackRow()` render
without a prior fails with "freshly loaded page".

Still true and deliberately unchanged: the add-asset cancel reads a static
**"Back"** rather than naming the origin, because `kProgress`'s label is fixed
while its destination is computed. Cosmetic, and it belongs to the form widget
rather than to this flow.

### ⚠️ `authEpoch()` — why an OWNER-scoped guard is not enough in this app

`js/supabase.js` exports a login generation, bumped on every `signIn` and
`signOut` and on nothing else. Any view that caches something private across
navigations binds to it.

**It exists because owner-scoping cannot fence people apart here.** The login
screen prefills ONE shared demo credential, so two different people signing into
the SAME account on a shared machine is the ordinary case, not a contrived one —
this file already records exactly that for `help_queries`' RLS ("every visitor
using that demo authenticates as the SAME owner, so `using (owner = auth.uid())`
is not a per-person fence there"). The Help desk's answer cache and its in-flight
completion guard were both owner-scoped, had been through **three review rounds**
on owner-scoping alone, and still let A's question, answer and credited record
values reach B after a sign-out and sign-in on that one account. Found by Codex,
round 17.

⚠️ **NOT folded into `invalidate()`**, which three data writes also call — the
cached answer would vanish whenever a client added an asset.

**What is and is not load-bearing, measured rather than asserted:**
| guard | mutation result | kept because |
|---|---|---|
| epoch check on completion | **fails S19b** | it is the fix |
| epoch in the restore check | **fails S19** | it is the fix |
| owner comparison (both places) | **survives** | a third auth entry point that forgot to bump would leave the epoch equal across two clients; that one case, and nothing else |
| the bump in `signOut` | **survives** | the route guard means nobody reaches a cached view while signed out, and the next `signIn` bumps first — kept so the primitive's stated contract holds for its next consumer |

The two survivors are labelled as survivors **in the code**, up front. Twice in
this PR a guard's comment kept calling it load-bearing after it had stopped
being so, and both times the correction came a round later.

### ⚠️ Recorded — the shared-cap retry time is approximate by construction

`help-ask` refuses on the aggregate daily cap and tells the client how long to
wait. That number is derived from the oldest row that has to expire, and the
count it indexes into **cannot be made exact without a schema change.**

The original bug (Codex, 2026-10-09): the count was `total`, which includes every
**concurrent reservation** — and each rejected request deletes its own row on the
way out. With 399 retained rows, two simultaneous asks both see 401, both pick
the oldest retained row, and both promise a wait of up to **24 hours** while the
table drops straight back to 399 and the next ask is admissible immediately.

Now counted from **survivors**: rows in the window older than a 5-second grace,
so anything that might be a peer about to release is excluded. Symmetric in the
race, unlike filtering on the request's own timestamp — a peer that reserved
microseconds *earlier* is excluded too. Deliberately conservative: it can tell a
client to retry sooner than strictly possible (they get another refusal, which is
cheap and honest) and it will not promise a wait that is not real. Two tests pin
both directions; the mutation back to `total` fails with a 64,800s promise.

⚠️ **AND THE FIRST VERSION OF THAT FIX DID NOT ACTUALLY FIX IT**, which is the
part worth keeping. It *omitted* `retryAfter` for the concurrent case, on the
strength of a comment — inherited from the code before it — claiming the consumer
would then say "in a few minutes". **It does not.** `rateLimitNotice`
(`js/keep/logic/help.js`) reads a `scope: "shared"` refusal with no number as
**"Please try again tomorrow"**, so omitting the number reproduced the same ~24h
overstatement *in the view*. Found by Codex, who read the consumer rather than
the fix. Two halves now:
- the function sends a **short** number (the grace window in seconds), not
  nothing — a positive value is what keeps the view off its `|| "tomorrow"`
  fallback, and it distinguishes "clears in seconds" from "could not be read",
  which still omits and still says tomorrow, correctly;
- the view no longer says *"reached its limit for today … in about a minute"*.
  Under 90s — `waitPhrase`'s own first bucket, so the two cannot disagree about
  what counts as short — it reads "The help desk is briefly at its limit."
Both mutation-tested, on both sides of the wire.

⛔ **THE EXACT ANSWER NEEDS THE RESERVE AND THE COUNT TO BE ONE ATOMIC
STATEMENT** — a Postgres function, so a migration and an owner decision. Until
then a burst of 400 genuine asks inside the grace window reports the same short
wait, which is the understating direction. Not approximated further on purpose.

### ⚠️ Recorded — `check-undefined-calls.js` cries wolf on regex literals

Its own comment says it is "deliberately conservative: it under-reports rather
than cry wolf." On a **regex literal** it does the opposite: `/^#\/keep\/help(?:[/?]|$)/`
is read as a call to an undeclared `help`, and the guard fails. Hit 2026-10-09
writing the Help route check.
Worked around rather than fixed, and the workaround is better code anyway: the
check parses the hash the way `main.js` does (strip query, split, drop empties)
instead of matching a second regex that could disagree with the router — the same
reasoning as `keepSubRoute` in `shell.js`. The guard's parser is not touched
because distinguishing a regex literal from division is not something to get
half-right inside a shared guard. Expect it again on any regex containing
`word(`.

### ⚠️ A `.k-h1` VISIBILITY ASSERTION AFTER A NAVIGATION CHECKS NOTHING

Found 2026-10-09 writing S15, and it had been latent in S13 since the day before.
**Every** Keep inner page renders a `.k-h1`, so
`await expect(page.locator('.k-h1')).toBeVisible()` immediately after a `goto`
passes **against the heading of the page being left**. It waits for nothing: the
test moves on before the destination has mounted, and two async renders race.

It surfaced as `locator.fill` failing with *"element was detached from the DOM"*
— which reads like a race in the **app** and is not one. Measured with a
MutationObserver: arriving at Help produces two childList additions to `<main>`
within ~100 ms (the router clears, then `renderKeepHelp()` mounts after awaiting
`loadHelpGuide()`), and is stable after that. The interaction was landing inside
that window because the preceding assertion had not waited at all.

Fixed by making all nine of them name their own page. **Measured** headings, not
guessed: `list`/`grid` "Entities", `assets` "Assets", `insurance` "Policies",
`requests` "My requests", `request` "Request a policy enhancement", `account`
"Account", `documents` "Documents", `help` "Help". S11–S15 then went 5/5 on three
consecutive runs where they had been intermittent.

This is the same class as the dead `.app-header h1` selector recorded in the UI
Test Configuration table: **an assertion that cannot fail is not a check.** The
difference is that a dead selector fails loudly and this one passes quietly.

### ⚠️ OPEN (owner decision) — the route guard is a net, not a proof

`check-keep-back-routes.js` asserts `BACK_ELIGIBLE`'s keys are exactly
`dispatchKeep`'s routes. Its **scan has now been fixed twice**, both times on a
Codex finding, both times because a route can be selected in a shape the scan
did not read:

| version | hole | found by |
|---|---|---|
| 1 | only the `case` labels, plus a **hardcoded** `login` early return | Codex |
| 2 | `sub === "lit"` inside a returning statement — defeated by **aliasing the boolean** (`const r = sub === "x";` has no `return`, and `if (r) return …` no longer mentions `sub`) | Codex, mutation in hand |

Version 3 stops enumerating shapes and asks instead *"is there anything here I
cannot account for?"* — any `sub` comparison outside a returning statement, or
any `sub` mention inside one without a readable literal, **fails the guard by
name**. Mutation-tested 5/5: the alias case, a non-literal comparison, a plain
second route, a route-independent early return (correctly ignored) and the real
`const [sub, id] = rest;` (clean).

⚠️ **It is still not a proof.** It is sound against every construct that mentions
`sub`; it is **not** sound against a route selected without mentioning `sub` at
all — `const r = rest[0]; if (r === "x") return …` is invisible to it, and no
text scan sees that without becoming a parser.
**What bounds the harm is the allow-list, not the guard:** a route
`BACK_ELIGIBLE` has never heard of is simply not offered, so an unseen route
costs a *missing* back control. Cosmetic, not a leak. That is why the inversion
came first.

⛔ **THE SOUND FIX NEEDS AN OWNER RULING, because it rewrites core routing.**
Make the dispatch **table-driven**: one route table that both `js/main.js` and
`BACK_ELIGIBLE` derive from, so there is nothing to keep in sync and nothing to
scan. `dispatchKeep` is an 18-case switch calling 18 different render functions,
so this is a change to the app's router, not to the Help desk — well beyond the
feature the guard arrived with. Deliberately not smuggled in.
`global.md` → *Review Rounds Have to Terminate* is the reason this is written
down now rather than after a third failure: a mechanism that fails a third time
gets reverted or redesigned, not patched again. **The next failure of this scan
is not another patch.**

### ⚠️ Recorded — S10 spends real money on every Pages deploy

`qa-live` runs after each Pages deploy with `retries: 1`, and S10 asks a real
question as the shared demo `user`.
⚠️ **4 paid calls per clean run, up to 8 on a failing one — not "up to 2", which
is what this said.** S10 carries no project filter, and `playwright.config.js`
declares **four** projects (desktop, tablet, mobile-chrome, iphone), so
`npx playwright test --list | grep -c S10` returns **4**. Measured by review
round 5; I had counted the scenario, not its instantiations.
That makes the **20/hour per-account** cap the sharp edge: about **5 clean runs**
exhausts it (2-3 failing ones), not "ten deploys" — and after owner-gate step 7
those 4 CI asks run *before* the operator's own step-8 proof, so a burst of
deploys can make step 8 fail for rate-limiting rather than for anything real.
Not fixed because every option is a trade: a dedicated CI account needs a
`profiles` row and another credential in secrets; skipping the ask removes the
only live proof the answer path works. Flagged so the first "why is the demo desk
rate-limited?" has an answer. (The *flake* half of this finding WAS fixed — S10's
settle was 45s against the function's own 60s ceiling.)

### ⚠️ Recorded — `max_tokens: 8192` against a 60s non-streaming timeout

The provider call is non-streaming with a 60s request timeout and `max_tokens:
8192`, chosen to leave thinking room. Filling that budget inside the timeout needs
roughly **137 output tokens/second** sustained; a long thinking trace that misses
it ends as a **billed timeout** whose reservation is deliberately kept ("billing
unknown" resolves as billed), so the client loses a slot and sees the quiet
notice. Raised by review round 5 as reasoned, not measured — nobody here has
timed Opus 5.5 against this budget. Streaming would remove the cliff entirely and
is the fix if owner-gate step 8 or early use shows timeouts. Worth watching in the
function logs for `where: "provider"` with no status.

### ⚠️ Recorded — `help-ask` reads only the LEGACY Supabase key names

`index.ts` reads `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Supabase
documents the legacy keys as working "until the end of 2026". When they stop,
`hasKeys` goes false and FR-17 renders that as the same "not available" notice as
every other failure — so the feature would die quietly on a date, not on a
deploy. Worth adding the new names as a fallback before then; not done here
because the correct new names should be read off Supabase's docs at the time, not
recalled.

### ⚠️ OPEN — the Keep's app bar overflows horizontally from 761px to 1044px

**Measured 2026-10-06** (headless chromium, local static server, the offline
stub harness). Not introduced by feature 003 — `#/keep`, `#/keep/documents` and
`#/keep/help` all overflow identically, with the same culprits and the same
`scrollWidth: 1045` — and recorded here so it is not rediscovered or mistaken
for a Help-desk defect.

`.k-bar__in` lays out brand (175px) + `.k-nav` (450px) + `.k-bar__rt` (352px)
with no wrap and no shrink, so the bar needs **1045px**. `.k-nav` is hidden only
below 760px (`@media (max-width: 760px)`), which is why the band starts one pixel
above that line and ends exactly where the viewport reaches the bar's intrinsic
width:

| viewport | result |
|---|---|
| 390, 600, 740, 759, 760 | ok (nav hidden) |
| **761 … 1040** | **OVERFLOW, `scrollWidth` 1045 every time** |
| 1045, 1046, 1100, 1280 | ok |

**It covers the Playwright `tablet` profile (810px),** which CLAUDE.md's measured
ceiling says runs locally — so this is reachable by the suite today. S4 checks
overflow at **390px only**, where the nav is already hidden, which is why it has
never gone red.

**Deliberately NOT fixed in the 003 PR**, because there is no minimal fix:
raising the hide breakpoint to 1044px would strip the main nav for every tablet
user with no hamburger to replace it, and shrinking the 240px search box saves
80px against a ~235px shortfall. It needs a design answer about the Keep's
chrome at tablet width, and that is a change to every Keep page, not to this
feature. Verify any fix across the whole band, not at one width.

## Project-Specific Coding Standards
- **Collapsible reveals (always):** any control that *expands* to show extra content — a button that reveals a panel, an inline expander, an accordion — MUST give the user an obvious way to collapse it back. Use a toggle with a rotating chevron/back arrow and `aria-expanded`, and never leave revealed content with no way to close it. Dropdowns/menus must also close on click-outside and Escape. Applies to every new feature or expanded button.
- **Origin-aware back (always):** any back / return / cancel control MUST return the user to the page they actually navigated *from*, not a hardcoded destination. The router records the previous route; back controls navigate to it, falling back to the hierarchical parent only when there's no prior in-app page (e.g. a deep link or fresh load). Never assume the parent in the breadcrumb is where the user came from (they may have arrived from a notification, search, or the documents view). Applies to every new feature or button.
- **One canonical label, one shared module (always):** every label shown in any
  view derives from one canonical record field, through one shared module
  (`js/keep/logic/entity-display.js` for entities). Labels are never
  re-synthesized per view — that is what caused the "You · personal" (map) vs
  "UBO" (table) divergence. Promoted here from `docs/data-model.md`, which held
  it as a binding `**Rule:**` while nothing in the repo pointed at that file, so
  a newcomer following this document would never have found it.
- **Non-overlapping connectors (always):** this is now **ratified upstream** as
  `design.md` → *Diagrams & connectors* (owner ruling, 2026-09-24). **Follow the
  upstream section; it is the authority.** The summary below is kept only
  because this repo's Relationships map is the surface it governs — do not treat
  this copy as the rule, and delete it in favour of a pointer at the next
  `/refresh-repo`.
  No two connectors from *different* sources may run collinear so they merge
  into one visible line, and none may run behind a box — route around it with a
  bend. Every distinct relationship stays traceable to exactly one owner→owned
  pair. Give same-orientation runs that share a corridor their own lane/offset;
  break a *perpendicular* crossing with a small gap — never an arc or loop
  (which reads as a node or a join). One source fanning out through a single
  shared trunk (a bus) is fine — that is one relationship, not two; two
  *different* owners sharing a line is not. Deconflict as a routing pass, then
  **verify geometrically before shipping** — count cross-source overlaps and
  lines-behind-boxes programmatically (a visual glance misses collinear
  overlaps, and hash-nav serves cached JS so the eye can't confirm the new
  build), against the **served** build, not the local file.
  **Two upstream provisions this local copy was missing** (added 2026-10-05,
  found by `/audit-repo` diffing the local standard against the ratified one):
  (1) if edges carry labels, each label sits on its own edge's lane, never in a
  shared corridor where it could attach to a neighbour; (2) the native
  `artifact-diagramming` skill owns this ground and should be read before
  drawing one — the blocking criteria above sit on top of it, and where the
  skill is silent it decides.

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
| Keep credential (valid) | `user` / `keep-demo-2026` (client view, prefilled) · `broker` / `keep-demo-2026` (broker view) · `underwriter` / `keep-demo-2026`. Bare username → `<name>@example.com`. ⚠️ **The broker and underwriter logins returned HTTP 500 until 2026-10-09** (NULL GoTrue token columns — see the Backend section). All three verified 200 on that date. This row is **agent input**, so a credential listed here that cannot sign in becomes a test that can never pass. |
| Keep credential (invalid) | any other password → `.k-error` on the login form |
| Primary nav button | `Find what coverage I need` |
| Primary content selector | `.coverage-card` (`.card` is dead CSS — no JS or HTML emits it; only `.card-grid` is used) |
| Nav cards | `['Residential','Commercial']` (hub coverage sections) |
| Playwright test directory | `.github/scripts/ui-tests` |
| Key selectors | home: `.hero h1` · choice steps: `.choices .choice` · contact: `#contact-name` (built as `contact-${f.id}` from `content/questionnaire.json` — grep for the literal finds nothing) · summary: `.need`, `.disclaimer` · error: `.error` · Keep: `.k-authcard` (login card), `.k-error` (login failure), `.k-welcome__h` (signed-in home heading — **not** `.k-h1`, which is on the inner pages only), help desk: `.k-help__input` (ask box), `.k-help__a` (answer), `.k-help__notice` (unavailable), `.k-help__ai` (the AI-generated label — present in BOTH states) |

⚠️ **The PUBLIC selectors in that row were verified against the rendered page on
2026-10-05** (headless chromium, local static server) — not read off the source.
**The Keep selectors were not, and one of them was wrong.** They were added under
the same heading without being rendered, because the Keep needs a live backend the
sandbox browser cannot reach — and `.k-h1` was listed as the dashboard heading when
the dashboard uses `.k-welcome__h`. Corrected 2026-10-06 from the source
(`js/keep/views/keep.js:178`) and from S9, which already asserted the right one.
A claim of verification that covers only part of a row is the same defect as the
dead selector it was written to fix. `home` was `.app-header h1`, which matches **nothing**: there is no
`.app-header` anywhere in `js/`, `css/` or `index.html`, and the home `h1` is
`main > section.hero > … > h1.hero__title`. `.site-header` exists but is the
nav bar and contains no `h1`. This is the same dead-selector failure as the
`.card` entry in the row above, which was fixed while this one was left — and
this table is **agent input**, so a dead selector here becomes an assertion
that can never pass. Re-verify against the page, not the stylesheet: `.card`
was live CSS with no emitter, and `#contact-name` is the reverse — correct,
but invisible to grep because the id is interpolated.

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
| S9 | Keep auth gate | Deep-link `#/keep` while signed out → redirects to the login form (`.k-authcard`). Submitting the prefilled demo credential reaches the dashboard (`.k-welcome__h`, "Welcome back, …"); a wrong password shows `.k-error` and stays on login. Sign-out returns to login. | Unauthenticated `#/keep` renders the dashboard, valid login fails to enter, or invalid login silently proceeds |
| S10 | Help desk page | Signed in, open `#/keep/help` → heading `.k-h1` "Help", the AI-generated label (`.k-help__ai`) present **before** any question is asked, suggestion chips (`.k-chiptog`) and the ask box (`.k-help__input`). Submitting a blank question shows `.k-error` and sends nothing. Submitting a real question yields **either** an answer (`.k-help__a`) or the unavailable notice (`.k-help__notice`) — never a blank region, and the `.k-help__ai` label is present in the answer case too | The AI-generated label is missing in either state, a blank question reaches the endpoint, or the answer region stays empty after an ask |
| S11 | Help desk — the ANSWER branch (offline harness, **runs locally**) | Seeded session + `page.route`: the AI label is present before the ask, **while the request is held open**, and in the answer; the question is echoed; `.k-help__src` credits the topic by its **corpus title** (not the wire id) and carries the record line; `.k-help__broker` renders on a payload whose `reason` is `answered`, with a link to `#/keep/insurance`; exactly one `.k-help__ai` | The label is dropped in any of the three states, the broker channel is gated on the wire's `reason`, a credit renders as its id, or the record line is missing |
| S12 | Help desk — the NOTICE branch (offline harness, **runs locally**) | A 404 from the function yields exactly one `.k-help__notice`, the label present, **no** `.k-help__a` and **no** `.k-help__broker`. A blank question shows `.k-error` and reaches the endpoint zero times | The notice state has no label, an answer renders beside a failure, the broker channel appears under an outage, or a blank question is sent |
| S13 | Help desk — back flow and two-identity isolation (offline harness, **runs locally**) | Arriving from `#/keep/list`, Help's back row points at that page (origin-aware). Following a credit, the **destination's own** back control points at `#/keep/help` and returning restores the answer and the question; a reload then shows **no** back row (no in-app origin). Then a real sign-out and sign-in as a second client: no `.k-help__a`, no `.k-help__src`, an empty ask box — and the page still works for them | A back control is hardcoded or missing on a credited destination, one renders on a freshly loaded page, returning from a credit loses the answer, or any part of the previous client's ask survives a sign-out |
| S14 | Help desk — the SIGN-OUT RACE, owner check (offline harness, **runs locally**) | Client A asks with the response **held open**; A signs out via `#/keep/account`; client B signs in and **asks nothing**; only then is the response released. Nothing of A's may render into B's page or be cached under B's id — checked again after leaving and returning, since the cache is read on render. ⚠️ **B deliberately does not ask**: that keeps the generation state unchanged so the owner captured before the await is the ONLY guard in play. An earlier version had B ask, which let both owner-check mutations pass. | The previous client's answer, credits or question reach the next client, on screen or via the cache |
| S15 | Help desk — the BUSY GATE survives a rerender (offline harness, **runs locally**) | Ask, navigate away, return before it settles: the rerendered controls must be disabled, and **re-enabling them in the page and calling `form.requestSubmit()` must still send nothing** — asserted on the endpoint's REQUEST COUNT, because that is what costs money. Then the answer must reach the render **on screen** (not the detached one that asked), and a fresh ask afterwards must reach the endpoint. ⚠️ Both halves were added because the first version passed with the gate deleted (it was testing `disabled`, which blocks the handler by itself) and with the gate LEAKED (controls re-enable via `setBusy`, whatever the gate does). | A rerender mid-ask starts a second paid provider call, the answer never reaches the screen, or the gate leaks and locks the desk |
| S16 | Help desk — a second client asks mid-flight (offline harness, **runs locally**) | A asks (held), A signs out, B signs in and **asks their own question** — which must reach the endpoint, since the gate is keyed on the owner and a bare boolean would lock B out over a departed client's call. A's older answer lands **first**: it must not render into B's page **and must not re-enable B's controls**, since B's own request is still in flight — `setBusy(false)` used to run before the owner check, which left an enabled form the gate then silently refused. Then B's own lands and must survive a leave-and-return. | The second client is locked out, their form is enabled while their own call is running, or the first client's late answer displaces theirs |
| S17 | Help desk — a stale render must not MOUNT (offline harness, **runs locally**) | Hold `content/help-guide.json` with `page.route`, start the first Help visit, navigate to `#/keep/list`, then release: the stale `renderKeepHelp()` must not `mount()` over Entities, the URL must not move, and Help must still work on a later visit. ⚠️ The corpus fetch is the ONLY await in that function and the real one is too fast to race, so holding it is the scenario. | A page the client navigated to is replaced by Help while the URL names the other route |
| S18 | Help desk — an OLDER render must not mount over a NEWER one (offline harness, **runs locally**) | Same setup with **one gate per corpus request**: start render 1, go away and back (render 2), then release render 2's fetch FIRST. Type into render 2's ask box, release render 1, and that typed value must survive. ⚠️ Releasing them in ORDER is not a test — the continuations run in await order and the newer render mounts last by luck; a mutation removing the generation check survived that version. S17's hash check cannot catch this (the hash still says Help) and the generation check cannot catch S17's (nothing calls the function again, so the generation never moves). | An older render replaces the newer one with a blank form, or two Help views are mounted at once |
| S19 | Help desk — sign-out must END the desk, SAME account (offline harness, **runs locally**) | Ask and get an answer, sign out, then sign back in **with the same prefilled demo credential** — a different person at the same machine. No `.k-help__a`, no `.k-help__src`, no `.k-help__q`, empty ask box. ⚠️ **Every other identity scenario switches to a DIFFERENT client, so all of them pass against an owner-scoped guard.** This one cannot: `getUser()?.id` is identical, and CLAUDE.md already records that `owner = auth.uid()` is not a per-person fence on the shared demo credential. | A completed answer, its question or its credited record values survive a sign-out |
| S19b | Help desk — an in-flight answer after a same-account sign-out (offline harness, **runs locally**) | As S19 but the response is **held** across the sign-out and sign-in, then released: it must not render into the next person's view and must not be cached for them (checked by leaving and returning, since the cache is read on render). The desk must still work for them. | The previous session's answer lands in the next person's page or cache |
## Upstream Divergences (deliberate — `/refresh-repo` must DIFF, not revert)

Synced from `claude.directives` @ `1d57879` (#316). These are **intentional** local
departures from the templates. A refresh that silently restores any of them
breaks this repo; each is listed so the next session diffs rather than "fixes".

| Divergence | Why it must stay |
|---|---|
| `LIVE_TARGET` in `app.spec.js` | **Load-bearing; absent upstream.** Skips S2/S3/S9 when `APP_URL` is localhost. Without it those scenarios run against a static server with no backend and fail — and since #244 made `qa.yml`'s ui-tests job **blocking**, that reds every push to `main`. |
| `readCredentialFromClaude()` | Upstream is env-only (`ce2140a`). Kept so local runs work without the secret; the credential is already in this file's UI Test Configuration table, so reading it here exposes nothing new. |
| S5–S10 instead of upstream's NAV / CTRL / ENTRY / DISMISS | S5–S10 cover *this* app (see Project-Specific Test Scenarios). Upstream's four are **deliberately not carried**. Revisit NAV only if this app gains multi-level drill-down with an in-app back control — it self-skips otherwise, so its downside is bounded. |
| `TEST_AUTH_EMAIL` **must stay unset** | The Keep's login ships **both fields prefilled**. #309's identifier ladder matches accessible names `/email\|user\|login/`, and our field is labelled "Username" — setting the secret would overwrite the working prefilled value and break a login that otherwise succeeds. Password-only is correct here. |
| S2/S3 navigate to `#/keep/login` | Upstream's S2 loads `./`, which here is **public marketing with no gate** — `detectAndAuth` returns `'none'` and every auth assertion goes vacuous. Upstream cannot know this route, and its own S2 failure text prescribes exactly this fix ("point this scenario at the login route"). Since this repo supplies a credential, upstream's S2 verbatim would now **throw** here. |
| ~~`check-contrast.js` carries `css/tokens.css`~~ **RESOLVED — adopted upstream** | No longer a divergence. The template now checks `styles/tokens.css` **or** `css/tokens.css` by default and takes `--tokens <file>` for anything else, which is exactly what was reported. Row kept only so the next refresh does not re-add it as a finding; delete it after one more sync. |
| `qa.yml` has a `unit-tests` job | No upstream equivalent. `node --test` over `js/**/*.test.mjs` plus `html-validate` — a deterministic blocking gate needing no browser or backend (#202). |
| `qa.yml` `UI_PATHS` uses `css/` | Upstream's breadth, this repo's directory names. The **previous local regex matched only `index.html`**, so a PR touching nothing but `js/` or `css/` set `ui=false` and skipped the browser job entirely — on an app that is almost entirely `js/` and `css/`. Fixed by adopting upstream's shape. |
| `cron-notify.yml` is **absent** (not a deliberate divergence — a gap) | `global.md` → *Repo Structure Standard* lists it among the **8 unconditional** workflows; this repo has the other 7 plus `pages-retry.yml`. **Inert today:** no workflow here has a `schedule:` trigger, so there is nothing for it to notify about, and `workflow-ref-guard` stays green because nothing references it — exactly the blind spot that guard cannot see. Install it with the first scheduled workflow, or record it here as deliberate. Found by `/audit-repo` 2026-10-05. |
| `pages-retry.yml` keeps a `concurrency` group **and an obsolescence check** | Both absent upstream. Each retry job re-runs the **original SHA** of the run that triggered it, so two managed Pages runs failing in one outage start two independent retries — and the older one can **redeploy stale content over the newer commit**. The group (which this repo had before #249 and lost by adopting the template verbatim) only serializes: **a concurrency group is mutual exclusion, not FIFO** — GitHub guarantees no ordering for queued runs, so it does *not* close the stale overwrite. What closes it is the check in the step, which skips the rerun when a newer run of the same workflow exists. `cancel-in-progress: false` is deliberate: a retry already re-running a failed deploy must finish, or the site stays on the failed build. **The check keys on `workflow_run.workflow_id`, never on a name** — the managed Pages workflow is `pages-build-deployment` in the *workflows* API but `pages build and deployment` in the *runs* API, so a name filter matches nothing and the guard silently never fires. **NOT yet reported upstream** (no write access to `claude.directives` from here and the peer session was unreachable) — carry it at the next `/refresh-repo`: the template needs *both* the concurrency group **and** the obsolescence check, since serializing alone does not order queued runs. Also tell them their `timeout-minutes` comment says the worst case is 5.2 min; it is 6.5 min (90s initial + 20+40+80+160s), though `timeout-minutes: 10` still bounds it. |
| `awaitAuthReady` consults an already-arrived response | **Absent upstream; a real bug in the upstream kit, found by Codex on #253 and reproduced before fixing.** `page.waitForResponse()` resolves only on a FUTURE response — Playwright does not replay ones already received — and every caller arms it AFTER awaiting `page.goto()`. So a readiness request that completes DURING navigation is missed and the wait times out, failing S2/S3/S4 with *"never resolved"* on a request that did arrive. Measured: `TEST_AUTH_READY_REQUEST=tokens.css` failed S4 at 25000ms; with the fix it passes in 6.8s, and the SELECTOR and default paths are unchanged. The fix is an `auto` fixture recording matching responses from before the body navigates, plus a check ahead of the wait. The SELECTOR path never had this race (`waitForSelector` with `state:'attached'` matches an element already present), which is why only the REQUEST branch is touched. **Report upstream at the next `/refresh-repo`** — the whole kit has it, and a refresh that takes the kit verbatim would delete this. |
| `renderWitness` extended to S5–S10 | Upstream's fixture ships on its own four scenarios (NAV/CTRL/ENTRY/DISMISS), which this repo deliberately does not carry — so adopting it verbatim would have left **every** scenario here witness-less and the viewport gate reporting SCHEDULED-only forever. Upstream's own rule is "EVERY scenario below requests `renderWitness` AND calls `renderWitness();` as its first statement", so extending it to S5–S10 is following that rule, not diverging from it. Measured 2026-10-06: `disposition: RENDERED laptop,tablet,phone`. |
| S9 keeps its own auth assertions | S9 reads the prefilled password back before overwriting, and asserts the form *was* prefilled. The generic kit has no notion of "the form already holds a working credential" and fills destructively — an upstream gap this project's login proves. S9 is the reference implementation; do not replace it with the generic verifier. |

### ✅ Rulebook synced 2026-10-06 (was six weeks / 43 commits stale)

Synced to `bbfdcfc` on 2026-10-06, from `1d57879` @ 2026-08-26 — 43 commits. The
nine sections below are the owner rulings that had accumulated in that window;
they are now read and in force, and are listed so the provenance stays visible:

| section | ruling |
|---|---|
| `global.md` → *"Proceed" — the Standing Directive* | 2026-08-27 |
| `global.md` → *A Knowing Deviation Is an Escalation* | 2026-09-02 |
| `global.md` → *Review Rounds Have to Terminate* | 2026-09-10 |
| `global.md` → *Parallel Tasking via Subagents* | 2026-09-10 (amended) |
| `global.md` → *Automations* | 2026-09-24 |
| `global.md` → *Subagent Model Selection* | 2026-09-24 |
| `design.md` → *Charts & data display* | 2026-09-24 |
| `design.md` → *Diagrams & connectors* | 2026-09-24 |
| `test.md` → *Playwright* | 2026-09-24 |
| `git.md` → *Fallback reviewer when Codex is down* | 2026-09-29 |

⚠️ **The sentence that used to sit here was wrong, and wrong in a way
`global.md` names explicitly.** It read: *"`claude.directives` is not in this
session's GitHub scope, so the SHA delta could not be computed from here."* It
can be. `claude.directives` is a **public** repo, and `global.md` →
*Repository Scope* draws the line this confused: **ACT scope** is hard-limited
to this session's repo, **READ scope is unrestricted for public repos**, and
that section says in terms *"NEVER claim a public repo 'can't be seen' — that
confuses ACT scope with READ scope."* `/refresh-repo` Phases 2–3 run over git
transport for exactly this reason. Verified 2026-10-06: one `add_repo` call
reported read access already available, a shallow clone succeeded, and the
file-level delta came back in one `git diff`. What is genuinely unavailable for
an unattached repo is the **GitHub API** surface — issues, PRs, the github MCP
— never git reads.
Two consequences already found and handled: *Diagrams & connectors* duplicates
this repo's local connector standard (now deferring to it, with two missing
provisions restored), and *Charts & data display* mandates the native `dataviz`
skill for any chart — this repo draws SVG for icons and the relationships map
but no charts, so nothing is in breach there today.

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
