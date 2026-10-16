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
  - `js/keep/logic/` (pure, unit-tested, no DOM) — `analysis`, `depreciation`, `ownership`, `policies` (presentation facts), `requests` (lifecycle), `entity-display`, `entity-types`, `relmap` (layout math), `search`, `docfile`, `help` (Help-desk question validation, suggestion chips, answer shaping), `help-model` (the Help desk's model tiers and prices for the broker control — one of THREE copies of that allow-list, gated against the other two by `help-model.test.mjs`), `asset-meta` (`ASSET_META` — the
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
- `supabase/migrations/` — applied schema (provisioned): `leads` + `rule_settings` (public/anon side) and `profiles` (+ `reminder_email`/`reminder_schedule` prefs) + `entities` (kinds: `personal`/`business`/`trust`/`person`) + `entity_relationships` (directed owner/trustee links between a client's entities) + `assets` + `policies` (the Keep, auth-keyed) + **`help_queries`** (feature 003's throttle log, applied 2026-10-09 — server-only: `authenticated` holds *nothing* on it, `service_role` holds `select, insert, delete` by explicit grant). RLS on every table, default-deny. ⚠️ Three migrations landed 2026-10-09 and the two security ones are recorded under *Project-Specific Security Constraints* below rather than here: `20261005120000_enhancement_request_stage_guard` (staff may no longer set any request status from any status) and `20261005120100_profiles_role_not_self_assignable` (`authenticated` UPDATE on `profiles` narrowed to `reminder_email, reminder_schedule`; INSERT revoked). ⚠️ A fifth migration landed 2026-10-14: `20261014001500_help_settings` — a
  **singleton** row holding the Help desk's model tier, broker-readable and
  broker-writable (`authenticated` holds `SELECT` + `UPDATE (model)` only;
  `service_role` holds `SELECT` by explicit grant; `anon` holds nothing;
  **nobody** holds INSERT or DELETE). See *The Help desk model tier* below.
  Demo data seeded live; `supabase/seed/` documents the seed in run order (`base_demo.sql` → `entity_relationships_demo.sql` → `assets_held_demo.sql`). ⚠️ A fourth migration landed 2026-10-13: `20261013005250_stamp_requested_notified` adds a **SECURITY DEFINER** function, `public.stamp_requested_notified(uuid)`, that lets an enhancement request's OWNER set `requested_notified_at` on their own row and nothing else — the only mechanism in Postgres that expresses that, because there is no owner UPDATE policy on the table and column privileges cannot distinguish client from broker (all three personas are the `authenticated` role). It carries an **expected** advisor warning (0029) that must not be "fixed"; the file says why. The `notify-enhancement` Edge Function (enhancement-request emails) is deployed
  and ACTIVE — ⚠️ **but was NON-FUNCTIONAL from the day it shipped until the
  2026-10-13 rewrite, and "ACTIVE" is what hid that.** See the `service_role`
  constraint below for the measurement and the fix. The `notify-lead` /
  `notify-renewal` functions are still to come.
  - **`help-ask`** (feature 003, `supabase/functions/help-ask/`) — the Help desk
    endpoint. **Deploy with the DEFAULT — `verify_jwt` ON.**
    ⚠️ This line said `--no-verify-jwt` for five commits, on two claims that were
    both false and both testable here all along. `desk-ask` WAS deployed with
    `verify_jwt: true`, which made it a live control (it was deleted 2026-10-14 —
    see below; the probe below stands, the control no longer exists); probed 2026-10-07:
    an OPTIONS preflight with no Authorization returns **the stub's own body**
    with `x-deno-execution-id` set (so the flag does **not** block CORS), while a
    POST with no Authorization and a POST with a malformed bearer are both
    refused by the gateway with **no execution id** (so the function never runs).
    The flag therefore costs nothing and stops **keyless** junk traffic before it
    is a billable invocation.
    ⚠️ **"Junk traffic" MEANS KEYLESS, AND `verify_jwt` IS NOT USER
    AUTHENTICATION** — raised by Codex on #271 and correct. The gateway checks
    for a **valid project JWT**, and the publishable/anon key is one: it is
    embedded in the browser bundle (`js/supabase.js`) and public by
    construction. So anyone holding that key reaches the worker, and the
    exposure this flag is credited with closing is *not* closed for them. What
    it does stop is exactly the probe's own two cases — no `Authorization` at
    all, and a malformed bearer. **The user gate is in the handler and always
    was** (`if (!authz) 401`, then `getUser()` must return a user, then every
    read runs as that user under RLS), so this changes no behaviour, only a
    claim. ⚠️ **Not measured from here:** egress is blocked, so the
    publishable-key path has never been exercised against the live gateway, and
    the smoke probe sends no `apikey` — it tests the keyless path only.
    ⚠️ **`supabase/config.toml` now PINS `verify_jwt = true`** for both
    functions; it carried no `[functions.*]` block until 2026-10-14, when a
    deploy measured that an absent block *preserves* the live value rather than
    applying the default. Note that only the CLI reads that file at all; the
    Supabase MCP deploy tool takes `verify_jwt` explicitly and defaults to true.
    ✅ **MERGED AND DEPLOYED** — PR #254 merged 2026-10-11, deployed 2026-10-13, and
    redeployed from the runner's checkout 2026-10-14 (version 2, `verify_jwt: true`,
    id `89dca147`). ⚠️ This line read "Written, **not merged and not deployed**"
    long after both had happened — and before that it read "Written and merged"
    while PR #254 was still open. It has now been wrong in BOTH directions, which
    is why the owner gate below is the authoritative order and this bullet defers
    to it. ⚠️ Deployed is not the same as *deployable*: the deploy PATH is blocked
    on a revoked `SUPABASE_ACCESS_TOKEN` — see *DEPLOY PROVENANCE*.
    When the function is unreachable for any reason, `#/keep/help` renders and
    every ask shows the plain "not available" notice — FR-17's single failure
    path, which is why the page was shippable ahead of the deploy.
  - ✅ **`desk-ask` IS DELETED (owner, Dashboard, 2026-10-14) — verified from a
    session: `list_edge_functions` returns exactly `help-ask` and
    `notify-enhancement`, and the id `57d80051-5070-4f0d-b5a2-d80368dbf293` is
    gone.** It was a retired stub, never part of this system, and **NOT** an older
    name for `help-ask` above — the two were easy to confuse because 003 was first
    planned to deploy straight over it (`specs/003-help-desk/plan.md`, Key
    decision 1, revised); that was rejected precisely so this record could stay
    unambiguous.
    Kept as an entry rather than deleted, for two reasons. **First, so the name
    still resolves:** six files across this repo cite `desk-ask` in comments, and
    a reader meeting one needs to find out what it was without concluding there is
    an undocumented endpoint. **Second, because it is the source of a live
    decision** — it was deployed with `verify_jwt: true`, which made it the only
    control available for the 2026-10-07 preflight probe that reversed this repo's
    `--no-verify-jwt` advice. That measurement stands (it was taken against a
    then-live function and its observed bodies are recorded above); what no longer
    exists is the ability to re-run it. ⚠️ So a future session cannot re-probe
    gateway behaviour against a local control, and should not write as though it
    could.
    What it was: a 410 responder whose own comment read *"was deployed by mistake
    into the wrong project and has been neutralized: it reads nothing, calls
    nothing, and stores nothing. Safe to delete entirely."* Nothing in `js/` ever
    called it, and it was deliberately never vendored into `supabase/functions/`.
    ⚠️ **A session cannot do this**, which is why it waited for the owner: the
    Supabase MCP has `deploy_edge_function`, `get_edge_function` and
    `list_edge_functions` but **no delete**, the Management API needs a PAT no
    session holds, and HTTPS egress to the project is blocked from here.
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
3. ✅ **DONE 2026-10-14 (owner, Supabase dashboard) — and MEASURED, not taken
   from the toggle.** `GET /auth/v1/settings` now returns `disable_signup: true`
   with `external.email: true` and `external.anonymous_users: false` — so public
   sign-up is closed, email login still works, and the anonymous-sign-in door is
   shut too. The Security page's "Invite-only access — there is no public sign-up
   to your portal" card is true for the first time.
   Was: ⏳ OWNER ACTION — not doable from a session. Measured ON
   (`disable_signup: false`) on 2026-10-06. There is still no Supabase MCP tool
   for auth config, and HTTPS egress to the project is blocked from a session
   (`CONNECT tunnel failed, 403`, re-measured 2026-10-14) — so neither the change
   nor its verification can be done from here, and both were the owner's.
   ⚠️ **The settings endpoint needs the publishable key**, which is the one piece
   of this that is not guessable: a bare
   `GET https://<ref>.supabase.co/auth/v1/settings` answers *"No API key found in
   request"*. Append `?apikey=<the publishable key from `js/supabase.js`>`. That
   key is public by construction — it ships in the browser bundle and RLS is the
   guard — so putting it in a URL discloses nothing.
   ⚠️ **AND THE FIRST ATTEMPT TURNED OFF THE WRONG TOGGLE**, which is worth more
   than the fix. Supabase's **Email provider** dialog has no sign-up control at
   all; its top switch is "Enable email provider", described as *"email-based
   sign up **and log in**"*, and turning that off breaks `signInWithPassword` for
   all three demo accounts — the Keep, S9 and `qa-live` with it. The control that
   is wanted is on the **Authentication → Sign In / Up** page itself, in a
   **"User Signups"** card *above* the provider list: **"Allow new users to sign
   up"**. The provider dialog is the wrong place and looks like the right one.
   (Caught and reverted the same minute; `auth_logs` then showed ten `200`
   password grants, and `auth.users` was untouched — a config flag, not data.)
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
   enhancement requests. ⚠️ The WRITE half of that exposure is narrower since
   2026-10-13: `20261013013743_notified_stamps_write_once` leaves
   `authenticated` able to UPDATE only `(status, approved_at)`, so a leaked staff
   credential can move a request's stage but can no longer rewrite its `owner`,
   `subject`, `message` or `context`. INSERT was narrowed the same day
   (`20261013014854`) to the seven creation columns, so neither notification
   stamp can be supplied at creation either. The READ exposure is unchanged and
   is still the reason to rotate.
   Accepted today on a **measured** precondition — `auth.users` holds exactly
   three rows, all `@example.com`, and `enhancement_requests` holds one row owned
   by the demo client, so there is no real client data to expose — and that
   precondition expires with the first invite. Raised by an automated security
   review of the repairing commit; recorded rather than acted on because it is a
   credential decision on the owner's project, and rotating silently would break
   both the logins this file documents and the ui-tester that consumes them.
5. ✅ **DONE 2026-10-13.** `ANTHROPIC_API_KEY` is set as an Edge Function secret
   (owner, via the dashboard; digest `cd8950de…`, saved 22:33:51Z). Auto-reload on
   the Anthropic credit balance is OFF and the Max plan's $200/month API credits
   were claimed the same day, so the balance is a real ceiling rather than a
   float — which is what the Console spend limit below was for. Was: Set `ANTHROPIC_API_KEY` as an Edge
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
6. ✅ **DONE 2026-10-13 23:13:03Z — BUT NOT CLEANLY; see the deploy-provenance
   section below before trusting "deployed == repo".** `help-ask` is ACTIVE,
   version 1, `verify_jwt: true`, function id `89dca147`. Was: Deploy
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
7. ✅ **DONE 2026-10-11.** PR #254 merged as squash commit `8449ddf` at
   00:17:46Z, and `pages build and deployment` completed **success** at
   00:18:29Z (`Pages Monitor` green, `Pages Deploy Retry` correctly skipped).
   `${APP_URL}/content/help-guide.json` now serves **200** where it was a 404,
   so the corpus fetch this gate's reordering note is about can succeed and
   step 8 is reachable for the first time.
   ⚠️ **The first live run of S10 then turned `main` red, on webkit only** — see
   *A CORS-BLOCKED FETCH IS A `pageerror` ON WEBKIT AND NOT ON CHROMIUM* below.
   Test-side, not the app: the notice rendered correctly on all four projects.
8. ✅ **DONE 2026-10-13.** A signed-in client asked "What policies do I have?"
   and got a grounded answer naming all seven policies, their carriers and their
   renewal dates, with `.k-help__src` credits, the AI-generated label and the
   broker channel — and it correctly declined the coverage determination. The
   feature is proven end to end for the first time. (Original wording: ask one
   question as a signed-in client and confirm an answer renders. FR-17
   makes every failure look identical, so this is the only step that proves the
   deploy worked.) If it still shows the notice, read the function logs: the
   `where` field names the stage (`guide`, `records`, `reserve`, `provider`,
   `model`, `settings`, `release`, and since 2026-10-14 **`answer`**).

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

✅ **The litter is GONE — dropped by the owner in the Dashboard SQL editor on
2026-10-13, verified from a session (`to_regclass('public._mcp_write_probe')` is
null).** Kept as a record because the table was the probe that established the
finding above: `create table` worked, so writes were possible at all, and
`drop table` then hung — which is the finding, and is also why the owner had to
remove it by hand.
⚠️ **Its own `COMMENT` said "no grants, no RLS, no rows" and two of those three
were wrong**, measured before the drop: RLS **was** enabled (this repo's
auto-enable event trigger did it) and the standard Supabase role grants existed.
The conclusion held for a different reason than the comment gave — **0 policies**
meant default-deny, and the only data privileges belonged to `postgres`, with
`anon`/`authenticated`/`service_role` holding just `REFERENCES/TRIGGER/TRUNCATE`.
Recorded because "nothing could read it" being true by accident rather than by
the stated reason is the same comment-overclaims-code defect this file keeps
paying for.

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
| Validate HTML | `npm_config_legacy_peer_deps=true npx html-validate index.html` — ⚠️ the env var is load-bearing on a COLD npm cache (npm 10.9.7 crashes in `#loadPeerSet`); a warm cache passes without it, which is how CI stayed green until it did not |
| Validate workflow YAML | `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/qa.yml'))"` |
| Unit tests | `node --test $(find js supabase/functions -name '*.test.mjs')` |
| Contrast guardrail | `node .github/scripts/check-contrast.js` |
| Job bounds guard | `python3 .github/scripts/check-job-bounds.py` |
| Workflow reference guard | `python3 .github/scripts/workflow-ref-guard.py` |
| Viewport classes guard | `node .github/scripts/check-ui-viewports.js --tests-dir .github/scripts/ui-tests` |
| Asset manifest guard | `node .github/scripts/check-asset-manifest.js` |
| Undefined-call guard | `node .github/scripts/check-undefined-calls.js` |
| Keep back-route classification | `node .github/scripts/check-keep-back-routes.mjs` |
| Python compiles clean | `python3 .github/scripts/check-py-warnings.py` |
| ui-suite env parity | `python3 .github/scripts/check-ui-suite-env.py --kit-dir .github/scripts/ui-tests` |
| Workflow/action YAML as GitHub reads it | `python3 .github/scripts/check-yaml-anchors.py` |

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
  ✅ **`profiles.role` WAS SELECTED FOR PART OF 2026-10-14 AND IS NOT ANY MORE.**
  The invite read became `select("id, role")` so the response could name the
  model that answered — to a BROKER only. The owner then made the model visible
  to **every** caller, which left `role` with no consumer, so the select narrowed
  back to `select("id")` in the same change. **Narrowing a read when its last
  consumer disappears is the cheap half of this discipline**: a column still read
  "in case" is one the next person has to reason about, and this one survived
  less than a day. Pinned on both sides so it cannot drift back unnoticed —
  `handler.test.mjs` scans the select, and `schema.test.mjs`'s `DOCUMENTED` table
  (which models what is SELECTED, the half that catches a column fetched and then
  dropped) lists `profiles: ["id"]`. Neither ever reached the prompt; what does is
  pinned separately by the sentinel sweep.
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
    credentials — while Supabase Auth self-signup, if enabled, would make the
    number of accounts unbounded and that cap with it. ✅ **Measured OFF
    2026-10-14** (`disable_signup: true`), so the account count is bounded by the
    invite runbook today; ⚠️ it is a project *setting* rather than schema, so
    nothing in this repo fails if it is switched back on — **re-check it before
    deploying**, and see the sign-up constraint below for how. The
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
  `with check` on `owner`/`subject`/`body`. ⚠️ **That gap is CLOSED as of
  2026-10-13, by privilege rather than by policy** —
  `migrations/20261013013743_notified_stamps_write_once.sql` revoked table-wide
  UPDATE from `authenticated` and re-granted `(status, approved_at)` only, so a
  genuine broker or underwriter can no longer write `owner`, `subject`,
  `message` or `context` at all. Measured after apply: `authenticated` may
  UPDATE **2 of 13 columns**. The missing `with check` is now belt rather than
  the only thing standing between staff and a client's request text, and it
  would matter again if the grant were ever widened — which is why the migration
  also carries a write-once trigger. Recorded in
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
  **and, since 2026-10-14, `help_settings`** — and both work only because their
  own migrations grant it explicitly (`20261006120000_help_queries.sql`,
  `20261014001500_help_settings.sql`). ⚠️ `handler.ts`'s doc comment said "USE IT
  FOR `help_queries` AND NOTHING ELSE" while naming one table, and the second
  arrived in the change that made that sentence false; it now names both and says
  a third needs a grant of its own AND a line there. `help_settings` is read
  through `admin` rather than as the caller because its policies are broker-only
  and a CLIENT must still get an answer. (This cited the `proposed/` path long after that file was
  applied — the same stale-pointer defect Codex round 7 found two sections down.)
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
  **✅ FIXED 2026-10-13 — and NOT with the one-statement grant.** The decision
  this paragraph asked to be made on purpose was put to the owner as two options
  and they chose the narrow one. For the record, the rejected remedy was
  `grant select, update on public.enhancement_requests to service_role;` —
  widening a service key's reach over a client table, which is a security
  decision rather than a bug fix.
  **What shipped instead:** every table access in `notify-enhancement` now goes
  through the **caller's own client** (anon key + their JWT), so RLS scopes it —
  the same shape feature 003 chose for `help-ask`, and stronger than the grant
  because RLS cannot be removed by editing a `.eq()` out of the handler. The
  underwriter's role is read from their **own** `profiles` row, so a caller can
  only assert their own role; and on the `requested` path the client's email now
  comes from their own JWT, removing a cross-user Auth Admin call outright.
  **One service-key use remains and it is deliberately not a table:**
  `auth.admin.getUserById`, to resolve the client's address on the `approved`
  path, where the caller is the underwriter and `profiles` has no email column
  (checked: `id, full_name, role, created_at, reminder_email,
  reminder_schedule`). That is the **GoTrue admin API** — authorised by the
  service-role JWT and unaffected by Postgres table grants, which is exactly why
  it still works where the table reads did not. `privilege.test.mjs` pins it to
  that one call and fails on any `authAdmin.from(`.
  ⚠️ **The service-role CALLER path was removed too.** The function used to
  accept the service-role key in the `Authorization` header as an alternative to
  a signed-in underwriter. Nothing used it — the only callers are
  `js/keep/views/policies-view.js` (`requested`, as the client) and
  `approveEnhancement()` in `js/supabase.js` (`approved`, as the underwriter),
  both browser-side with a user JWT — and it could never have worked for the
  privilege reason above. That retired the stated reason for `verify_jwt =
  false`, so `supabase/config.toml` no longer pins it. ⚠️ **It is still `false`
  on the LIVE deployment until the function is redeployed** — only the CLI reads
  that file, and this project deploys through the MCP, which takes `verify_jwt`
  as an explicit parameter.
  ⚠️ **STILL NOT PROVEN TO SEND EMAIL, and the rework does not change that.**
  Whether `RESEND_API_KEY`, `BROKER_EMAIL` and `FROM_EMAIL` are set is unknown —
  there is no MCP tool to list Edge Function secrets and HTTPS egress to the
  project is blocked from a session (see below), so it could not be checked.
  With the key unset `sendEmail` returns `{sent:false,
  reason:"no_provider_key"}` and the function answers 200, so **a green response
  from this endpoint is not evidence that mail left the building.**
- **✅ CLOSED 2026-10-14 — public sign-up is OFF, and "invite-only" is true for
  the first time.** `GET /auth/v1/settings?apikey=<publishable>` returns
  `disable_signup: true`, `external.email: true`,
  `external.anonymous_users: false`, `mailer_autoconfirm: false` — so no account
  can be created against this project, email login still works, and the
  anonymous-sign-in route is shut as well. Turned off by the owner in
  **Authentication → Sign In / Up → User Signups → "Allow new users to sign
  up"**; see owner-gate step 3 for the dialog that does *not* contain that
  control and the outage that followed from assuming it did.
  **Kept rather than deleted, because the SHAPE of the gap is the lesson:** it is
  still true that *no trigger or policy in `supabase/migrations/` enforces
  invitation*. The gate is a **project configuration setting, not schema**, so it
  is invisible to every instrument this repo trusts — it is not in
  `list_migrations`, not in `pg_policies`, not in a source scan, and not in CI.
  Nothing in this repository would go red if it were switched back on. The only
  check is re-measuring the endpoint, and it is nobody's job on a schedule.
  ⚠️ **SO THE RE-CHECK IS THE OWNER'S, AND IT IS WRITTEN AS THEIRS.** An earlier
  version of this line said "re-measure it at every `/refresh-repo`" — and
  `/refresh-repo` is run by a SESSION, which cannot do it: HTTPS egress to the
  project is blocked (`CONNECT tunnel failed, 403`, measured 2026-10-14) and
  there is no auth-config MCP tool. So every refresh would have had to either
  skip a required check or rely on an undocumented handoff. Found by review on
  the very change that introduced it.

  | who | what | evidence |
  |---|---|---|
  | **owner**, at each `/refresh-repo` or before any invite | open `https://bdsegmjcgfmgzuxwiplj.supabase.co/auth/v1/settings?apikey=<publishable key from js/supabase.js>` in a browser | paste the JSON into the session; `disable_signup: true` AND `external.email: true` |
  | **session** | ask for that reading, and say plainly that it could not be taken if none is given | never claim the setting from this file alone |

  ⚠️ **The publishable key is required** — a bare GET answers *"No API key found
  in request"*. It is public by construction (it ships in the browser bundle),
  so putting it in a URL discloses nothing.

  ⚠️ **AND THERE IS NO SESSION-SIDE SUBSTITUTE — measured, not assumed.** The
  `auth` schema holds 27 tables and **none of them is a config table**
  (`information_schema.tables where table_schema='auth'`, 2026-10-14): GoTrue
  keeps this setting in its own config, not in Postgres. The nearest thing a
  session CAN read is `auth.users`, and it is worth being precise about what that
  does and does not show: a row whose email is outside the three seeded
  `@example.com` accounts proves sign-up **was** possible at some point, so it is
  a lagging **detector of a breach**, not a reading of the **setting**. An empty
  result is consistent with sign-up being wide open and simply unused — which is
  exactly what it was from 2026-10-06 to 2026-10-14.
  **What it was, measured 2026-10-06:** `disable_signup: false`,
  `external.email: true`, `mailer_autoconfirm: false`. So anyone could create an
  account against this project, confirm a mailbox, and sign in — and
  `js/main.js`'s Keep guard only requires a session.
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
  ✅ **AND THE PRODUCT CLAIM IS NOW CLOSED TOO (2026-10-14).** The Security card,
  this file's "invite-only client portal", and `content/help-guide.json`'s
  security topic — which the Help desk is grounded on, so the desk repeats it to
  any client who asks — all now describe the live configuration. Nothing in that
  copy changed; the config moved to meet it.
  ⚠️ Still not doable *or verifiable* from a session: there is no Supabase MCP
  tool for auth config, and HTTPS egress to the project is blocked
  (`CONNECT tunnel failed, 403`, re-measured 2026-10-14), so a session cannot
  even read `/auth/v1/settings`. Both halves were the owner's, and the reading
  above is theirs.
- **⚠️ Shared Supabase account — FOUR projects, not two, and the grant is ACCOUNT-level; the `postgres`/BYPASSRLS role is measured for `insurance` ONLY (2026-10-14).** This entry said "`insurance` and `apfp` share one account … so the MCP credential can reach both", which understated it on both counts.
  **What a session's Supabase connection actually is:** NOT a personal access token — the Access Tokens page was EMPTY while all of this session's migrations and probes ran. It is the **Management API** (`application_name = 'mgmt-api'`), authorized by the account's OAuth grant to Claude, and it lands as `current_user = session_user = postgres`, `rolbypassrls = true`, `rolsuper = false`. That is why a session can apply migrations, read `auth.users`, and `set local role` to probe as any persona. Revoking it is done where it was granted (the Supabase ↔ Claude integration), not on the Access Tokens page.
  **What it reaches** (`list_projects`, one org `akyachtsman`): `trading dashboard` (`kwugzhyfjevzwgplhtsd`), **`insurance`** (`bdsegmjcgfmgzuxwiplj`), `property dashboard` (`yucnxlimmrgzbqtdizle`), `apfp` (`qnjrwbgxywkdfbfuzwas`). Accepted for now (same owner).
  ⚠️ **BE PRECISE ABOUT WHICH HALF OF THAT IS MEASURED — an earlier version of this bullet said the credential is `postgres` with BYPASSRLS "on all of them", and it measured one.** Found by Codex on #260, and it is this file's own overclaiming defect on a fifth surface. What the two calls establish, separately:

  | claim | status |
  |---|---|
  | the SQL connection to **`insurance`** lands as `postgres`, `rolbypassrls = true`, `rolsuper = false`, `application_name = 'mgmt-api'` | **measured** |
  | the grant is **account-level, not project-scoped** — so account-level tools enumerate all four | **measured** (`list_projects` returned four) |
  | SQL execution against the other three is authorized, and lands as the same role | **NOT measured, and deliberately not measurable from here** |

  The third row cannot be closed by this repo's sessions at all: the *Operating rule* below forbids touching those projects, so the only instrument that would settle it is the one thing a session must not do. Read the blast radius as "an account-level grant whose per-project SQL role is confirmed for `insurance`" — which is already enough reason for the split below, and is not the same sentence as "`postgres` on four projects".
  ⚠️ List-level visibility is not permission to read. No byte was read from the other three.
  **Before production: split into per-project Supabase accounts/orgs.** Note the deploy token created 2026-10-14 is the counter-example worth copying — scoped to one project and one capability (see *DEPLOY PROVENANCE*).
- **Operating rule — single-project scope:** from this repo's sessions, only ever touch the `insurance` project (`bdsegmjcgfmgzuxwiplj`). **Never** read from or write to `apfp` (`qnjrwbgxywkdfbfuzwas`). (Best enforced by adding `--project-ref=bdsegmjcgfmgzuxwiplj` to the Supabase MCP config in the web environment.)

### ✅ CLOSED 2026-10-15 — THE PORTAL COULD NOT HAVE INVITED ITS FIRST CLIENT

Found by reading Supabase's own docs while answering a question about email
providers, not by any instrument in this repo. **Nothing here would ever have
gone red for it**, and it sat directly in front of the invite runbook.

**What it was.** Supabase's built-in SMTP sender is for Auth messages only and
is not a production sender: *"Unless you configure a custom SMTP server for
your project, Supabase Auth will refuse to deliver messages to addresses that
are not part of the project's team … All other addresses will fail with the
error message **Email address not authorized**."* An invite is an Auth email.
So the Keep — an **invite-only** portal whose runbook says every future client
is created from the dashboard or the Admin API — could not have onboarded
anybody outside the Supabase org team. The first real invite would simply have
been refused.

**Measured, in order, 2026-10-15:**

| time (UTC) | evidence | reading |
|---|---|---|
| — | **Enable custom SMTP: OFF**, read off the dashboard for `bdsegmjcgfmgzuxwiplj` | the blocker was live |
| 05:06:31 | `auth_logs`: `reloading api with new configuration`, and `env GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating Email limiter **from 2/1h to 30**` | the save landed SERVER-SIDE, not just in the UI — and 2/h → 30/h is the signature of enabling custom SMTP, since 30 is exactly what the docs say Supabase imposes |
| 05:13:59 | `auth_logs`: `action: user_invited`, `path: /invite`, **status 200**, duration **1.86s** | a real SMTP handshake, auth and hand-off to Gmail. An auth failure returns 500 fast |
| — | the invite **arrived** | delivery works |

⚠️ **AND IT LANDED IN SPAM, which is the finding worth more than the fix.**
Gmail gave its own reason: *"This message is similar to messages that were
identified as spam in the past."* That is a **content-similarity** verdict, not
an authentication one — the stock Supabase invite template ships byte-identical
across thousands of projects, many of them phishing, so the shape itself is
fingerprinted. The template is rewritten and kept at
`supabase/templates/invite.html`, with what it fixes and what it does not.
⚠️ Two things it does **not** fix, so a green inbox is not read as solved: the
From is a personal `@gmail.com`, and the accept link points at a random-looking
`<ref>.supabase.co` subdomain — a link domain unrelated to the sender is its own
signal, and Supabase's docs name the remedy (a custom domain for the Auth
server). The durable answer is a real sending domain with SPF/DKIM/DMARC.
⚠️ The SPF/DKIM/DMARC results were **not** read from *Show original*, so
authentication is unlikely-but-unconfirmed as a contributor. Do not write it off.

⚠️ **THE PRECONDITION UNDER THE PUBLISHED STAFF CREDENTIALS HAS NOW EXPIRED,
exactly as this file predicted it would.** The invite-runbook entry accepts the
broker and underwriter passwords being published here on a *measured*
precondition — "`auth.users` holds exactly three rows, all `@example.com` … so
there is no real client data to expose — and that precondition expires with the
first invite." Measured after the test: **4 rows, 1 non-demo**. The test account
is disposable and deleting it restores the state; what does not go away is that
the rotation item is now the next real client's blocker rather than a someday.

**The shape to carry, because it is the third instance:** custom SMTP is a
**project configuration setting, not schema.** It is not in `list_migrations`,
not in `pg_policies`, not in a source scan, not in CI, and no MCP tool this
repo's sessions hold can read it — the same blind spot as the public-sign-up
flag and the Auth email templates. All three were invisible, all three
contradicted something the product or the runbook asserted, and all three could
only be settled by the owner opening a dashboard page. **When a claim rests on
project configuration, the repo cannot check it and must say whose job it is.**

| who | what | evidence |
|---|---|---|
| **owner**, before any real invite | Authentication → Emails → SMTP Settings on `bdsegmjcgfmgzuxwiplj` | "Enable custom SMTP" ON, and the sender is not a personal mailbox |
| **session** | ask; never infer it from this file | `auth_logs` can corroborate a SEND (`/invite` 200) but says nothing about the toggle until one is attempted |

### ⚠️ OPEN — the Account page offers renewal reminders that nothing sends

Found the same day, and it is a live product claim with no backend at all.
`js/supabase.js` reads and writes `profiles.reminder_email` and
`profiles.reminder_schedule` (default `[60, 30, 14, 7, 1]` days), and the
Account page lets a client switch reminders on and choose a cadence. It saves,
and it reads back.

**Nothing consumes either column.** `supabase/functions/` holds exactly two
entries — `help-ask` and `notify-enhancement` — so there is no `notify-renewal`,
no scheduled trigger (no workflow here has a `schedule:` trigger at all, and
`cron-notify.yml` is absent), and no sender. A client can turn renewal
reminders on, pick 60/30/14/7/1 days, and never receive one.

This is the same shape as the "Invite-only access" card that was true in copy
and false in configuration until 2026-10-14 — but closer to the core promise,
since renewals are what the product is *for*: the home page's own "Renewals
coming up" panel and its lapsed/expiring counters are the headline feature.
Deliberately **not** fixed here: it is a build (an Edge Function plus a
schedule plus a sender), not a config, and it needs a product decision about
what the reminder says and who it comes from — which is the same sending-domain
question the invite work just raised.

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
   The other half is **`node .github/scripts/check-keep-back-routes.mjs`** (now in
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

⚠️ **AND THE EPOCH ALONE WAS NOT ENOUGH EITHER — three layers, three rounds.**
Rounds 17–19 were the same disclosure mechanism one layer out each time, and each
fix was right about the layer it addressed and silent about the next:

| round | what was guarded | what was not |
|---|---|---|
| 17 | the account | a second *session* on the shared account |
| 18 | the session, same tab | the session **across tabs** (BroadcastChannel) |
| 19 | what is WRITTEN and RESTORED | what is **already rendered** |
| 20 | what is already rendered | a render and a cache fill **that had not happened yet** |

So the signal now does three things, not one: bump the epoch, **re-dispatch the
route** (`main.js`, so an unauthenticated Keep route goes to the login card and
the DOM is replaced), and **clear the view's module state** (`help-view.js`).
⚠️ **`SIGNED_IN` IS NOT A NEW LOGIN** — the client re-establishes the session on
tab refocus and emits it for the *same* session, so bumping on the event alone
discarded a paid answer when the client switched tabs. The generation is keyed on
`loginKeyOf` = user + `last_sign_in_at`, which is measured to change between two
sign-ins 1.5s apart on the shared credential and not to move on a refresh.
⚠️ **A FIRST gain of a session is silent; a gain after a LOSS announces.**
`INITIAL_SESSION` arrives with a **null** session before storage recovery, so the
`SIGNED_IN` that follows looked like a change and re-dispatched on every load —
**S18 caught that as a second corpus fetch**, i.e. the fix for one stale-render
race caused another. The invariant that makes the silence safe: the clear fires on
losing or switching a login, so by the time this tab has no key, nothing is held
under the old one.

⚠️ **AND THE SAME-TAB BUMPS ARE NOT ENOUGH.** `signIn`/`signOut` run only in the
tab that called them, and the vendored client broadcasts auth changes to the
others over a **BroadcastChannel** — so signing out and back into the shared
account in a second tab left the first tab's Help view holding a stale
generation, and the round-17 fix did not hold one tab across. An
`onAuthStateChange` listener now announces, and it **compares the login key**
rather than keying on the event name; `TOKEN_REFRESHED` and `INITIAL_SESSION` are
excluded outright (a refresh runs on a timer and would discard a client's own
answer mid-use). The same-tab bumps are kept, so a double bump is normal — only
inequality is read, and it means `authEpoch()` is correct the moment `signIn`
returns rather than whenever the event lands. S20 uses two real tabs in one
context; nothing simulates the broadcast. Found by Codex, round 18.

⚠️ **CORRECTION — ROUND 19'S FIX TO THIS WAS REPORTED AS MADE AND WAS INERT FOR
A ROUND.** The paragraph above used to describe an `onAuthStateChange` listener
that bumped on the event NAME (`SIGNED_IN` / `SIGNED_OUT` / `USER_UPDATED`).
Round 19 replaced it with the key-comparing one so a refocus would stop being
read as a login change — and **left the old listener in place below it**. There
were two subscribers. Every `SIGNED_IN`, refocus included, still bumped
`loginEpoch` and called `invalidate()`, so the behaviour round 19 fixed was
unchanged and this file said otherwise.
It survived **this session's own mutation test** because the duplicate bumped the
epoch *without* notifying `authListeners`: no `route()` re-dispatch, so no
scenario saw a second render, while a held Help answer was still discarded on
refocus. A mutation test only grades the line you mutate. Found by Codex, round
20; duplicate deleted.
**The invariant to hold, stated in the code at the subscriber:** `js/supabase.js`
has **exactly one** `onAuthStateChange` subscriber. There is no scenario for it —
with the pinned bundle, `_recoverAndRefresh` emits a same-session `SIGNED_IN`
only from its user-proxy branch (a `userStorage` session needing a `/auth/v1/user`
round-trip), which the offline harness never produces — so the guard is the
comment and a `grep -c`, and saying so is better than a test that drives the
client's internals and proves the stub.

**What is and is not load-bearing, measured rather than asserted:**
| guard | mutation result | kept because |
|---|---|---|
| epoch check on completion | **fails S19b** | it is the fix |
| epoch in the restore check | **fails S19** | it is the fix |
| owner comparison (both places) | **survives** | a third auth entry point that forgot to bump would leave the epoch equal across two clients; that one case, and nothing else |
| the bump in `signOut` | **survives** | the route guard means nobody reaches a cached view while signed out, and the next `signIn` bumps first — kept so the primitive's stated contract holds for its next consumer |
| `help-view.js`'s own `onAuthChange` clear | **survives** | the re-dispatch replaces the DOM and the epoch blocks the restore, so nothing is *observable* without it — kept on data-hygiene grounds no UI test can express: the previous person's answer would otherwise stay in module memory |
| the `last_sign_in_at` half of the login key | **survives** | a same-account re-login is only reachable through a sign-out, which already clears — kept for re-authentication with no sign-out, namely a **programmatic re-sign-in** (a fresh token grant, which does move the column), where the bare id compares equal and the staleness is silent. ⚠️ This cell used to add "a password change, `USER_UPDATED`" and **neither is covered**: GoTrue writes `last_sign_in_at` on a sign-in, `updateUser` touches `updated_at`, so the key compares equal and the subscriber is a no-op for them. Nothing in `js/` calls `updateUser`, so nothing is lost today |

The two survivors are labelled as survivors **in the code**, up front. Twice in
this PR a guard's comment kept calling it load-bearing after it had stopped
being so, and both times the correction came a round later.

### ⚠️ A DISPATCH IN FLIGHT IS A FOURTH LAYER — the render and the cache fill that had not happened yet (round 20)

Rounds 17–19 each guarded something that existed: an account, a session, a
rendered DOM. Round 20 is the one underneath all of them — **work already in
flight when the login changed**, which no epoch check reaches because there is
nothing yet to check. Found by Codex, and it has two halves that look like one.

`dispatchKeep` (`js/main.js`) awaits `getSession()` and then `ensureData()`, so a
**cold** Keep navigation has two suspension points between the route guard
passing and the view mounting. A sign-out landing in either of them re-dispatches
(round 19's `onAuthChange` → `route()`), renders the login card — and then:

| half | what happened | fix |
|---|---|---|
| the RENDER | the original dispatch resumed and mounted the signed-out client's private page **over the login card** | `dispatchGen`, bumped at the top of every `route()`, checked after every await on the way to a mount, in `route()`'s `catch`, and before `setActiveNav`/`focusMain` |
| the CACHE FILL | `ensureData` assigned that client's whole tree into `cache` a moment **after** `invalidate()` had cleared it, so the next person to sign in found a non-null cache and every sync accessor served them the previous client's entities, assets and policies | `ensureData` stamps the fill with a **`cacheGen` that every `invalidate()` moves** and refuses to store one whose stamp changed; it still RETURNS the tree, and all three callers discard that value — `dispatchKeep` checks its generation before mounting, and the two write paths `go(...)` straight afterwards, which re-dispatches through the route guard |

⚠️ **The second half outlives the first, and the first fix does not cover it.**
`invalidate()` runs on every login change but can only clear what is already
there. Codex's finding named cache fills explicitly; a reader who fixes only the
router has fixed the visible half and left a cross-client disclosure.

⚠️ **ONE COUNTER PER LAYER, AND NOT ONE MORE.** In the router, an auth change
calls `route()`, so it supersedes by the same mechanism as a `hashchange` — a
separate "auth generation" would be a fifth thing to forget to bump. In the data
layer the counter is `cacheGen`, moved by **every** `invalidate()`, not
`loginEpoch`: that covers the login case for free (`announceLogin` invalidates)
*and* the case the login epoch alone missed — a data WRITE invalidating while an
earlier fill is in flight, where the pre-write snapshot would be cached over the
top. Pre-existing, found by an independent review of the round-20 commit, and
closed by widening the stamp rather than adding a second one.

⚠️ **TWO CLAIMS IN THE FIRST VERSION OF THIS SECTION WERE WRONG, both about
*why* rather than *what*.** The cache-fill comment said "the only caller awaiting
this call is the dispatch that started it" — there are **three** (`dispatchKeep`,
`renderKeepAddEntity`, the add-asset submit), and the conclusion survives for a
different reason, now recorded in the table above. And `route()` bumped the
counter *before* `nav.track` and the hash parse, which sit **outside** the `try`:
a throw in either superseded whatever was in flight and then rendered nothing
itself. The bump now happens immediately before the `try`. Both found by an
independent review of the commit, which called the second the only route to a
blank page it could find.

**Measured, not asserted** (S22 and S23, four viewport projects, offline harness):

| mutation | result |
|---|---|
| delete the generation check before the mount | **fails S22** |
| delete the epoch guard on the cache fill | **fails S23** |
| delete the generation check after `getSession()` | **SURVIVES** |

⚠️ **The survivor is recorded as a survivor, in the code and here.**
`getSession()` reads `localStorage` with no network call while the session is
unexpired — which is the same property that makes the whole offline harness
possible — so that suspension point is not reachable from any scenario. It is
kept for the case that *is* real: an expired session, where `getSession()` goes to
the network for a refresh. Twice in this PR a guard's comment kept calling it
load-bearing after it had stopped being so; this one says what it is up front.

⚠️ **S22's first two assertions caught nothing, and only a mutation test showed
it.** With the generation check deleted, "login card still visible" and "no
`.k-h1`" both still passed — because the *other* round-20 fix masks this one: the
cache guard correctly refuses the stale fill, so the superseded dispatch reaches
`renderKeepEntityList()` with an empty cache, throws, and `route()`'s catch
(generation-guarded in the same fix) swallows it. Nothing reaches the DOM either
way. What differs is whether the superseded dispatch **runs at all**, and it logs
`route error:` when it does — so that is what S22 keys on. Layered fixes mask each
other's tests; the only way to find that out is to mutate each one separately.

### ⚠️ OPEN (pre-existing) — a failed Keep read renders an EMPTY Keep, and caches it

Found by an independent silent-failure review of the round-20 commit, which
correctly separates it from that commit: **this is not new and was not touched.**
Recorded because it is the one path in the Keep that really does produce a silent
empty portal, and it is a better bug than anything round 20 fixed.

`loadTree` (`js/supabase.js`) runs five queries in parallel and, on an error,
only `console.warn`s — then builds the tree from `data || []` and lets
`ensureData` **cache** it. So an RLS denial, an expired JWT or a network blip
gives a client a Keep that renders as "Welcome back, Member" with no entities, no
assets and no policies, shows them no error at all, and keeps doing so until the
next `invalidate()`. The comment above the loop says *"Surface query failures
(e.g. an RLS denial) instead of rendering silently empty"*, and `console.warn` is
not surfacing anything to the person looking at the screen.

Deliberately not fixed here: the right behaviour is a product decision (an error
state for the whole portal? per-section? a retry?), it touches every Keep view,
and this PR is a Help-desk feature. ⚠️ Note it interacts with the round-20 fill
guard in the useful direction — a failed fill is now at least not cached across a
login change — but a failed fill under an *unchanged* login still is.

### ⚠️ Recorded — deleting the duplicate subscriber also dropped a refetch-on-refocus

A consequence of round 20's P2 that nobody asked for and nothing else covers, so
it is written down rather than discovered later. The deleted unconditional
listener called `invalidate()` on every `SIGNED_IN`, including the same-session
one the vendored client emits when restoring a session on tab refocus. That meant
the Keep's data was refetched on the next navigation after a refocus. It no longer
is: the cache now lives for the length of the login (or until a write). So a
broker-written policy change shows up after a reload or a local write, not after
switching tabs and back.

That is the **intended** direction — discarding a paid Help answer on a refocus
is exactly what Codex asked to stop, and the refetch was riding along on the same
event. A deliberate refresh-on-refocus would be a new feature with its own
decision to make (what it costs on a metered connection, what it does to an
answer mid-render), not a side effect of an auth listener.

### ⚠️ A STALE RENDER CAN BE STOPPED BY AN ACCIDENT RATHER THAN A GUARD (round 23)

`renderKeepHelp` awaits the corpus and then checks two things before mounting:
its own generation, and that the hash still names Help. **A SIGN-OUT defeats
both.** The hash does not change — it is still `#/keep/help` — and nothing calls
the function again, so the generation has not moved either. The route guard
re-dispatches and mounts the login card, and then the old corpus fetch resolves
and mounts the authenticated Help form, ask box and all, over the top.
`main.js`'s dispatch generation cannot reach it: that is checked before CALLING
this function, and the mount happens inside the continuation afterwards. Found by
Codex, round 23. Fixed with a third check, `authEpoch() !== epoch`.

⚠️ **AND THE DOM SAID IT WAS ALREADY FINE, WHICH IS THE PART WORTH KEEPING.**
With the new check deleted, every DOM assertion in S25 still passed. Instrumented
rather than assumed, in three steps:

| probe | result |
|---|---|
| does the continuation resume? | **yes** — `gen=1 cur=1 onHelp=true epoch=0→2` |
| with what guide? | **15 topics** — a valid corpus (the first probe printed `guide.length`, which is `undefined` for `{topics:[…]}`; that was a probe artefact, not evidence) |
| does it reach `mount()`? | **yes** |

So the stale render *does* mount. What saves the page is that building the
signed-in Help view then **throws** — its data cache was cleared by the sign-out
— and the parked promise is still inside `route()`'s `try`, whose `catch` is
generation-guarded by the round-20 fix, so the throw is swallowed and the login
card survives by being last.

**That is an accident, not a defence.** It holds only while that construction
happens to throw, which no test asserts and no comment promises. The epoch check
makes the refusal deliberate; S25 asserts the absence of a `route error:` log,
because a clean run never enters the continuation and so has nothing to log —
the same signal S22 needed for the same reason.

⚠️ **The lesson generalises past this fix: a green DOM assertion does not
establish that the guard you just wrote is the thing holding the line.** Mutate
it. Three of this PR's scenarios (S22, S25, and the hourly owner-scoping unit
test) passed against the code they were written to catch, and all three were only
found by deleting the fix and re-running.

### ⚠️ `setBusy` after an ask has been WRONG TWICE, in opposite directions

Worth its own entry because the two fixes pull against each other and a third
edit will be tempted to undo one of them.

| round | shape | what broke |
|---|---|---|
| 14 | `setBusy(false)` **before** the owner check | a departed client's completion RE-ENABLED the current client's form while their own call was in flight — an enabled control that silently does nothing |
| 17 | `setBusy(false)` **after** the checks | the mirror image: on a mismatch it returned before any `setBusy`, so on the shared account B's view stayed DEAD after A's call settled, until B navigated away and back |

⚠️ **AND ROUND 21 FOUND THE THIRD, IN THE GATE THE RECOMPUTE READS.**
`pendingByOwner` was a `Set` of owner ids, and the login screen prefills ONE
shared demo credential — so two different people are the same id. A has an ask
pending; A signs out (the listener clears the gate); the next person signs in and
asks, adding an entry under the identical id; A's response settles and its
`finally` deleted **their** entry. The recompute then reads an empty gate and
ENABLES their form while their own provider call is still running, so a second
submit is a second PAID call, and the `abort()` only cancels their browser fetch
while the Edge Function bills on.
Now a `Map` of owner → **per-ask token**, and the `finally` deletes only if the
token still matches — false exactly when someone else holds the slot. Deliberately
not keyed on the login epoch: this PR's other lesson is that a guard resting on a
second mechanism fails when that one does.
⚠️ **The comment on that gate already claimed the fix** — it opened *"Carries
`seq` so an earlier ask's completion cannot release a later one's gate"*, a line
left behind from the design the Set replaced. The Set carried no seq.
⚠️ **And the fix promoted a neighbour from belt to load-bearing.**
`help-view.js`'s `onAuthChange` clear was labelled BELT (measured: deleting it
passed every scenario). With the token, a departed client's slot is no longer
released by their own settling ask — so without the clear the next person
inherits a **disabled form** and is locked out by a call that is not theirs.
Mutation-tested: it now fails S24. The two halves of that listener are labelled
separately in the code, because `lastAsk`/`liveView` are still belt.

Both found by Codex. The resolution is neither position: the busy state is
**recomputed from `pendingByOwner`** immediately after the gate is released, on
every path including the mismatches. B is enabled iff B has nothing in flight,
which satisfies both rounds at once, and it makes the aborted path correct for
free (a newer ask holds the gate, so the state stays).
⚠️ S19b's assertion deliberately runs **before** any rerender — the earlier
version checked enablement only after navigating away and back, which is exactly
what masked round 18's half.

### ⚠️ Recorded — BOTH caps' retry times are approximate by construction

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

### ⛔ REDESIGNED, ROUND 22 — the function stops answering a question it cannot answer

**Three rounds, one mechanism: "derive a precise wait from a count that cannot
tell a transient reservation from a billable one."** `global.md` → *Review Rounds
Have to Terminate* says the third failure of a mechanism is a revert or a
redesign, not a third patch. The three:

| attempt | what it sent | how it was wrong |
|---|---|---|
| 1 | a flat `3600` on the daily cap | understates a rolling 24-hour window |
| 2 | **nothing**, for the concurrent case | the view reads a numberless refusal as "tomorrow" (shared) / "a few minutes" (client) — the overstatement just moved out of the function |
| 3 | the **5s grace** in seconds | understates by up to an hour: 20 real asks inside that grace are excluded as "possible peers" while they hold the cap for the full window (Codex, round 22 — and an independent review before it, at lower confidence, which I under-weighted) |

**No age-based rule gets both cases right**, and that is the finding rather than
any one number. Counting survivors understates when the young rows are real;
counting every row but our own overstates in the concurrent case the grace was
added for. The two readings of an ambiguous count are "clears in seconds" and
"clears in an hour", and a single integer cannot carry "I do not know, but it is
bounded by this".

**So the contract carries the bound separately.** `retryAfterFor` returns
`{ seconds, failed }`; `seconds` is non-null **only** when it is derived from
settled rows alone. Each caller then sends exactly one of:
- `retryAfter: <seconds>` — a wait that is actually known, or
- `window: 3600 | 86400` — the cap's window, when it is not.

and `rateLimitNotice` has a third pair of wordings, true across the *whole* of a
window: *"You've reached your limit of questions for the hour. Please try again
later in the hour."* and *"The help desk is at its limit right now. Please try
again later."* Neither promises a duration, so neither can be false.

⚠️ **THE FIRST VERSION OF THE VIEW SIDE WAS INERT, and its own test caught it on
the first run.** The branch guard was `!Number.isFinite(Number(seconds))`, and
`answerShape` passes **`null`** when no number was sent — `Number(null)` is `0`,
which is finite — so the branch never fired and the whole redesign rendered the
same "in a few minutes" it exists to replace. The test asserts the **wording**,
not the branch, which is the only reason it could catch it.

⚠️ **Three tests were rewritten and that is expected, not a smell** — each had
pinned a previous attempt, and two carried justifications that the next fix
retired ("a SHORT number, not no number, *because* the view says tomorrow" was
true of its round and false after the view gained the third wording). A test
whose reason has expired is the `.k-help__out` class of defect: it can only pass
while the thing it was written beside is still wrong.

⛔ **THE EXACT ANSWER STILL NEEDS A SCHEMA CHANGE, and it is now a sharper ask
than "one atomic statement".** What removes the ambiguity is a **billing-line
marker** on `help_queries` — a column the handler sets when a request passes the
point of no return, so a retry calculation can count committed rows and ignore
reservations outright. That is a migration plus an owner decision, and it would
close this class rather than bound it. Recorded here rather than approximated a
fourth time.

⚠️ **AND THE HOURLY CAP HAD NONE OF THIS FOR FIVE ROUNDS — it sent a flat
`retryAfter: 3600`.** Found by Codex, round 20, pointing at the fix the branch
beside it had already had twice. It read as safe because an hour IS a true upper
bound for a one-hour rolling window; what it is not is honest. A client whose
oldest ask is 59 minutes old waits 60 seconds in reality and is told to wait an
hour — and in the concurrent case Codex named (19 retained rows, two simultaneous
reservations, both seeing 21, both deleting their own row) they could retry
immediately.
Both caps now go through **one** `retryAfterFor(windowStart, windowMs, cap,
scoped)` in `handler.ts`, differing only in the window, the cap and the filter
(`(q) => q.eq("owner", owner)` for hourly, `(q) => q` for shared). Two copies of a
wait calculation is how one of them stays wrong for five rounds; that is the
reason for the helper, not tidiness.
⚠️ **The seed is the test, in the hourly owner-scoping case.** Its first version
seeded the other client's rows OLDER than the caller's, so the unfiltered offset
landed on the caller's own oldest row and both answers were 1800 — a test that
passed against unscoped code. Mutation-tested after a rewrite that puts the other
client's 300 rows NEWER, where unscoped quotes 3300s instead of 600s. Five
mutations, five caught: flat 3600, lost owner filter, no grace short-circuit, no
grace exclusion, wrong window.

⚠️ **AND `releaseAnd` DISCARDED ITS OWN DELETE'S RESULT, so a failed release read
exactly like a successful one** (Codex, round 21). PostgREST resolves a failed
DELETE with `{ error }` rather than throwing, so a transient 5xx or a privilege
regression left the reservation in place while the function returned the notice as
though the slot had been given back — an **unbilled** attempt counted against the
caller's 20/hour and the shared 400/day, and repeated failures lock the caller, or
everyone, out after the dependency has recovered. Now checked, **retried once**
(the statement is idempotent — `eq("id", slot.id)` on a row only this request
knows about), and logged as `where: "release"` if it still does not take. The fake
database could not fail a delete at all until this was written, which is why
nothing covered it: *a fake that cannot fail cannot test a failure.*

⚠️ **The same round also found that the first version of the hourly fix traded a
safe error path for an unsafe one** — see the `retryAfterFor` note in
`handler.ts`. Omitting `retryAfter` on a client-scope refusal renders as "in a few
minutes"; the flat 3600 it replaced overstated, which is the safe direction. The
helper now returns `{ seconds, failed }` so the two are distinguishable, logs both
failure stages, and the hourly caller falls back to the window on `failed` while
the shared one deliberately does not.

⚠️ **`contract.test.mjs`'s `retryAfter` assertion is now INVERTED, and the
inversion is itself the finding.** It used to *require* a literal
(`fnSrc.match(/retryAfter:\s*(\d+)/)`, failing with "no numeric retryAfter
found") and read the digits to check the unit. Removing the last literal — the
correct change — made it unsatisfiable: it could only pass while the
overstatement it was written beside was still there. Same class as the
`.k-help__out` assertion recorded below. It now asserts there is **no** literal,
because a constant cannot be right for a rolling window, and the UNIT is pinned
where it can be: `handler.test.mjs` executes the function and asserts the actual
seconds (5 for the grace case, ~600 and ~1800 for settled ones).

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

### ⚠️ A COUNT-BASED REQUEST GATE IS DEFEATED BY A BROWSER RETRY (webkit, measured 2026-10-10)

Found as a *flake* in S23 on the `iphone` project and run down rather than
re-run, because `test.md` says grade on what actually happened and name the
assertion.

`gateFirst(page, re)` held "request #1" and let everything after it through.
**WebKit retries a request that is held open** — measured, `held=2` on every one
of five runs — so the retry arrived as #2, sailed past the gate, and the parked
client's data load **completed while the test still believed it was held**. The
failure artifact showed tab 1 on the fully rendered signed-in home ("Welcome
back, Demo", 1 Entities, 1 Assets) where the login card was expected: a test
whose premise had silently stopped holding.

⚠️ **The first explanation was wrong and measuring killed it.** I assumed a CORS
preflight was consuming the gate's first slot (the REST GET carries
`Authorization` and `apikey`, so a preflight is required). An instrumented run
printed **three GETs on the same URL and no OPTIONS at all**. Reasoning about
what a browser "must" send decided nothing; one `console.log` did.

Now `gateOwner(page, re, uid)`, keyed on the **bearer's `sub`**: a retry of the
parked client's request carries the same token and stays held, while another
identity's goes straight through. Exact, and immune to both retries and ordering.
`held()` is exposed and both scenarios assert it is non-zero before relying on
the parked state, so a gate that catches nothing fails loudly instead of
vacuously.

**The SECOND flake in the same pair was the CROSS-TAB SCAFFOLDING, and it took
three attempts to stop patching it.** S22 failed with an empty `<main>` and no
login card: the sign-out in tab 2 had not reached tab 1. Measured on webkit over
five runs, that signal arrives in **1034, 1634, 1759, 1826 and 2308 ms** — it is
not blocked in isolation. The three attempts:

| attempt | what happened |
|---|---|
| raise the assertion 10s → 30s | **no effect** — `playwright.config.js` sets `timeout: 30_000` **per test**, so a 30s wait inside a 30s test cannot fit; the failure just became *"Test timeout of 30000ms exceeded"* with the same message |
| add `test.setTimeout(60_000)` | passed 24/24 in isolation, **flaked again on the full suite** — 30s against a 1-2s median is not jitter |
| **drop the second tab** | 24/24, three repeats, four projects, and the mutations still fail |

⚠️ **The third is the one to keep, and it is a redesign rather than a bound.**
Neither scenario is *about* the broadcast — S20 and S21 cover that — so the
second tab was scaffolding, and it was the only flaky part. S22 now ends the
session in the same page through the app's own exported `signOut()` (a dynamic
import of the same module URL the import map keys, so the same module record the
app is running — not a stub), and S23 switches identity by navigating to
`#/keep/login`, which `dispatchKeep` answers **above** the session check and so
renders with nothing to wait for. Both are faster, deterministic, and a more
direct statement of their own claim: one machine, two people in turn.
⚠️ **The rewrite silently DELETED S22** — the splice cut from its header through
to S23's — and the only reason it was caught is that `--repeat-each=3` across
four projects reported **12 passed instead of 24**. `npx playwright test --list`
is the check; a green run proves nothing about a test that no longer exists.
Re-mutation-tested after the rewrite, both still caught: the generation check
fails S22, the cache-fill guard fails S23.

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

`check-keep-back-routes.mjs` asserts `BACK_ELIGIBLE`'s keys are exactly
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

### ⚠️ A CORS-BLOCKED FETCH IS A `pageerror` ON WEBKIT AND NOT ON CHROMIUM (measured 2026-10-11)

Found the only way it could be found: the **first live execution of S10**, on
`main`, minutes after feature 003 merged. 102 passed, 2 failed — `tablet` and
`iphone`, the two webkit projects, both with:

```
Uncaught page errors: /bdsegmjcgfmgzuxwiplj.supabase.co/functions/v1/help-ask
                      due to access control checks.
```

**Why it could not have been caught earlier, which is the part worth keeping.**
S10 self-skips off `LIVE_TARGET`, so `qa.yml` on the PR never ran it; `qa-live`
runs only after a Pages deploy of `main`. So the assertion that failed had
**never once executed on webkit** — and the comment above it asserted a
cross-browser fact (*"a 404 from a not-yet-deployed function does NOT raise an
uncaught exception, so anything there is a real defect"*) that had only ever
been observed on Chromium. A merge gate cannot cover a test that only the merge
can run.

**Measured, not reasoned about** — two local static servers on different ports,
a 404 with no CORS headers, the rejection caught exactly as `askHelp` catches
it:

| browser | what the app saw | `pageerror` |
|---|---|---|
| **webkit** | caught `"Load failed"` | `"/127.0.0.1:8778/functions/v1/help-ask due to access control checks."` |
| **chromium** | caught `"Failed to fetch"` | **none** |

Byte-for-byte the shape CI reported, leading slash included. So WebKit raises a
page-level error for a CORS-blocked subresource **in addition to** rejecting the
fetch, and it does so **whether or not the rejection is caught**. The app is
correct on both: `askHelp` catches, FR-17's notice renders, and S10 reached step
7 before failing — the product behaved as designed and the test was wrong, which
is the same class as the 45s settle recorded in the S10 section below.

**The fix is a narrow filter plus NEW strictness, not a loosening.**
- `pageErrors` had **no pre-ask gate at all** — it was checked once at the very
  end, so an uncaught error raised during login was indistinguishable from one
  raised by the ask. It now has one, mirroring `consoleErrors`.
- After the ask settles, `pageErrors` is narrowed to **ONE EXACT STRING** — no
  pattern at all — and only on WebKit, and only when FR-17's notice rendered.
  The string is **built from the request the test actually observed**,
  `` `/${u.host}${u.pathname} due to access control checks.` ``, and that
  construction is **measured**: probed on webkit against a cross-origin 404, it
  equals the raised message byte-for-byte.
  ⚠️ **THIS IS A REDESIGN AFTER TWO ROUNDS ON THE SAME MECHANISM, not a third
  tightening.** Both rounds were Codex on PR #255, and both were "the filter is
  wider than its comment claims":

  | round | what shipped | what it still swallowed |
  |---|---|---|
  | 1 | `/functions\/v1\/help-ask/` | any exception merely **naming** the URL — e.g. response-handling code reporting the request it was working on |
  | 2 | the same, anchored with `$` only | `TypeError: /host/functions/v1/help-ask due to access control checks.` — a **prefix** walks straight in, while the comment beside it claimed "the whole measured message shape" |

  `global.md` → *Review Rounds Have to Terminate* says a mechanism that fails
  again across rounds is in the wrong place. So the pattern is **gone**: there is
  no prefix, suffix or anchor left to get wrong, because `Set.has` is exact.
  Verified on ten strings — **one** allowed, **nine** kept, including both
  rounds' cases, a different host, a leading space, a changed case, a blocked
  `/rest/v1/entities` and a blocked `/functions/v1/notify-enhancement`.
- The allowance is **CONSUMED, not matched** — `allowed.delete(m)`, so each
  string is spent on its first occurrence and a **duplicate survives**.
  ⚠️ **Round 3 found that `filter` + `Set.has` dropped EVERY identical
  occurrence**, because `Set.has` is not consumptive — so two diagnostics from a
  doubled ask both vanished, contradicting this record's own "a second
  occurrence remains visible" claim. **Three rounds, three times the comment
  claimed more than the code did**, which is the defect class to watch for here
  rather than any one of the three fixes.
- **And `askCalls` is now asserted on the real ask**, not only around the blank
  submission: one ask is one request. That is the direct check on the regression
  the duplicate case describes — two **paid** provider calls — and it fires
  before the allowance can matter.
  ⚠️ **Measured before asserting it**: one caught cross-origin POST yields
  exactly **one** `request` event (method POST, **no OPTIONS surfaced**), three
  runs each on webkit and chromium. Asserting a count without measuring how the
  preflight is reported would have turned S10 red on webkit — the engine it had
  just gone red on.
- It **fails closed in every direction**: a reshaped message, an extra prefix, a
  different host or a second occurrence all fail the gate, which is the right
  direction for a check on uncaught errors.
- The allowance goes **inert** once the function is deployed: with CORS `*` and a
  real response there is no block, so nothing matches. A 500 *with* CORS headers
  raises no `pageerror` either.
- **Gate on `browserName`, not the project name.** `devices` maps
  `iPad (gen 7)` and `iPhone 12` → **webkit** and `Desktop Chrome` / `Pixel 5` →
  **chromium**, measured — which is exactly the failing and passing sets, an
  independent corroboration of the diagnosis. A project rename cannot silently
  defeat the engine check.

⚠️ **The verification chain here has no live run in it, and that is stated
rather than papered over.** S10 needs real Supabase Auth the sandbox browser
cannot reach. What closes the loop is that **CI handed over the actual array
contents** — the exact string, twice, on two projects — and the filter is
verified against that exact string. Both ends are measured; the middle is the
one CI already executed.

### ✅ CLOSED 2026-10-13 (was OPEN, owner decision) — STAFF COULD RESET EITHER NOTIFIED STAMP

⚠️ **This heading read "⚠️ OPEN (owner decision)" for three commits after the fix
was applied, which in the canonical security constraints means a reader concludes
the reset-and-resend hole is live.** Codex round 8. The fix is
`migrations/20261013013743_notified_stamps_write_once.sql`, applied 2026-10-13:
`revoke update on public.enhancement_requests from authenticated` then
`grant update (status, approved_at)`. **Measured after apply:** `authenticated`
may UPDATE **2 of 13 columns**, neither of them a notified stamp, so no staff
account can reset either one — and `20261013014854` closed the INSERT path to
the same columns the next day. The section is kept because the SHAPE of the hole
is why the fix is a column REVOKE rather than a policy; everything below it,
including the measurement, describes the **pre-migration** state.

Raised by an automated security review of the round-2 commit on PR #256, and it
also corrects a piece of reasoning in this repo's own migration.

**Measured 2026-10-13, BEFORE the migration below was applied** (the privileges
are no longer these — see the paragraph above): `authenticated` held UPDATE on
**every column** of `enhancement_requests`, both notified stamps included
(`information_schema.column_privileges`), while `er_broker_update` and
`er_underwriter_update` constrain only `status` in their `with check`. So, then:

| who | can do what |
|---|---|
| underwriter | `set approved_notified_at = null` on an approved row (status unchanged, so the check passes) → re-POST → both approval emails resend |
| broker or underwriter | the same to `requested_notified_at` on **any** client's row |
| the client / owner | **nothing** — there is no owner UPDATE policy at all |

So `notify-enhancement`'s claim-before-send gate is real against **retries,
double submits and concurrent invocations** — one email, not two — and is **not**
a gate against a deliberate staff account. The code says exactly that now; it
previously said "the gate", which is the fourth comment-overclaims-code instance
on this branch pair.

**The fix is a privilege change, not more handler code** — it was the owner's
call because it narrows staff, it was put to them, and it is **applied**
(`20261013013743`). The statements, as they ran:
```sql
revoke update on public.enhancement_requests from authenticated;
grant  update (status, approved_at) on public.enhancement_requests to authenticated;
```
plus a second SECURITY DEFINER function for the approved stamp, mirroring
`stamp_requested_notified` — also applied, in the same migration.
`(status, approved_at)` is the whole of what any legitimate writer touches —
`js/` only ever writes `status` (via `advanceRequest`), the function writes
`approved_at`, and the client needs no UPDATE whatsoever — so the narrowing
broke nothing that works, which was enumerated rather than assumed before it ran.

⚠️ **This also corrects the migration's own reasoning.**
`20261013005250_stamp_requested_notified.sql` said a column grant was "the
obvious answer and is wrong here" and stopped there. Wrong *for that one
column* — granting only `requested_notified_at` would leave it the only writable
column for everyone — but a column grant is precisely the right tool for this
half. The owner still needs the SECURITY DEFINER function regardless, because
the owner has no UPDATE **policy**, which is a different question from which
**columns** the role holds. Both halves are now stated in the file.

⚠️ **CODEX ESCALATED THIS TO BLOCKING-BEFORE-DEPLOY (round 3, P1), and that was
the right call — the gate is now cleared, by the apply recorded above.** — it was also the direct answer to a question put to it, namely
whether recording this was sufficient for a security finding. The reasoning:
PR #256's rework is what turns `notify-enhancement` from a dead endpoint (42501 →
404 on every call) into a working one, so the abuse becomes *reachable* at the
same moment the feature does. A hole that ships with the thing that enables it is
not a follow-up.

### ⚠️ AND THE FIRST FIX FOR IT TRADED ONE HARM FOR A QUIETER ONE (round 4)

Worth its own heading, because the mistake is more instructive than the fix.
The first attempt was a BEFORE UPDATE trigger making both stamps **write-once**,
chosen over narrowing privileges on the argument that a rejection trigger cannot
break what works and is provable from a session. Codex round 4 showed that
design is not merely weaker:

> write-once closes BACKWARD writes (`t → null`, `t → t'`) and deliberately
> leaves the FIRST write open. So staff can **pre-claim** a stamp on a request
> that has not been approved — the handler then reads it populated, returns
> `already_notified`, and **emails nobody** — and the trigger makes the forged
> stamp **immutable**, so it can never be corrected.

So it converted *"staff can resend without bound"* into *"staff can permanently
suppress a client's approval notice"*. The second is harder to notice, because
nothing happens. Three reviews pointed at narrowing privileges before it was
accepted — an automated security review, then Codex rounds 3 and 4 — and
`global.md` → *Review Rounds Have to Terminate* applies to one's own design
choices, not only to the code.

**What was wrong with the objection to narrowing: it was never measured.** The
worry was that a REVOKE breaks a writer nobody remembered. So the writer set was
enumerated. Every touch of this table from `js/`: an INSERT (unaffected by an
UPDATE revoke), a SELECT, and `advanceRequest`, which builds its patch as exactly
`{ status }` plus `approved_at` when approving. That **is** the column grant.
Nothing else writes the table. The narrowing was a guess no longer.

**The design that shipped** — ⚠️ **and this said `supabase/proposed/…`,
"written **not applied**", for two commits after it went live.** It is
`migrations/20261013013743_notified_stamps_write_once.sql`, **APPLIED
2026-10-13**, and the stale pointer mattered: the paragraph below then told an
operator the rpc would fail and the deploy was blocked, which is the same
staleness already corrected in `index.ts`. Found by Codex, round 7:
1. `stamp_approved_notified(uuid)` — SECURITY DEFINER, authorizes **caller**
   (underwriter, read from `profiles`), **status** (`approved`) and **direction**
   (null → now), mirroring `stamp_requested_notified`.
2. `revoke update on public.enhancement_requests from authenticated;` then
   `grant update (status, approved_at) …`. **This is the boundary** — without it
   both stamp functions are decorative, because the same caller writes the
   columns directly.
3. The write-once trigger, kept but **relabelled as belt**: it does not stop a
   pre-claim, only step 2 does. Its one specific justification is that this repo
   has already been bitten by a later migration restating a grant table-wide,
   which is why `20261006120000_help_queries.sql` refuses UPDATE at both the
   grant and policy layers.

⚠️ **The code and the migration ship as a pair, and that pair is now BOTH
live.** `index.ts` calls `stamp_approved_notified`; it resolves against
`migrations/20261013013743`, applied 2026-10-13, so nothing about this branch is
deploy-blocked on a migration any more. What the earlier text described —
"exists only in `proposed/`, the rpc fails, the branch returns `claim_failed`
with nothing sent" — was the fail-closed state *before* the apply, and is kept
here only as the shape the coupling has to hold for the next such pair.
`privilege.test.mjs` enforces it rather than trusting a PR thread: an RPC defined
only in `proposed/` is allowed, **but that file must be listed in
`proposed/README.md` as blocking the deploy.**
⚠️ **That gate proves SOURCE consistency, not that a migration is applied** —
it reads directories, and a file sitting in `migrations/` whose remote apply was
skipped or failed classifies as applied and passes. Codex raised this in the
same round. It is not fixable in CI by design: a test that could tell would need
production credentials, which this repo's Safety Rules forbid. So the claim is
narrowed in the test's own name and comment, and the authoritative check —
`list_migrations` against the names the code's RPCs resolve to — is a **deploy
step**, recorded in `index.ts`'s deploy header, not a CI assertion.

⚠️ **TWO MUTATION SURVIVORS HERE, AND THE FIRST IS THE WORST OF THE PR.**
Deleting the `revoke` — the single load-bearing statement — left **every** test
green while making both stamp functions decorative. The suite was checking the
lock and not the door. Now asserted, along with the shape of the re-grant:
table-wide, or including a `notified_at` column, or dropping `approved_at`, each
fail. The second survivor was the SQL scan matching the file's **own INVERSE
block** — a `--` comment documenting the table-wide grant as the reversal —
which is the comment-stripping trap already handled for the TypeScript scan, met
again on a second surface.

⚠️ One consequence for this repo's own habits: the probe in
`migrations/20261013005250_stamp_requested_notified.sql` ends by restoring the
demo row's `requested_notified_at` to null. Once this is applied that statement
is **refused**, correctly. Use the documented disable/enable pair, or leave the
demo row stamped.

**Context for weighing it:** staff are already able to rewrite `owner`,
`subject` and `body` on any client's request, recorded above and accepted. An
underwriter resending an approval email is a smaller harm than that, which is
why this is a decision rather than a stop-ship.

### ⚠️ A GATE THAT RUNS AFTER THE SIDE EFFECT IS NOT A GATE (notify-enhancement, 2026-10-13)

Codex #256 round 1, P1, and it is the same shape as the `help_queries`
reservation lesson arrived at from the other side.

`notify-enhancement`'s requested path sent the broker email and the client email
and **then** called `stamp_requested_notified`, whose
`status = 'requested' and requested_notified_at is null` clauses were meant to be
the stage/idempotency gate. They ran after the side effect, so they gated
nothing: any signed-in owner could POST `event: "requested"` for their own row
indefinitely — including after it had advanced to **approved or declined**, where
the client email still read *"we've received your request and sent it to your
broker for review"*. Unbounded broker email, unbounded provider spend, and a
re-announcement that is actively misleading about the request's state.

⚠️ **And the migration's own comment asserted the protection it did not have** —
"what it stops is re-announcing a request that has since moved to broker_review
or beyond". That is the comment-overclaims-code defect this repo keeps paying
for; it is now the **third** instance recorded (the two `pageErrors` filters on
PR #255 were the others).

**The fix is an ordering, not a stronger clause.** The stamp became a CLAIM taken
before the sends, which also makes it atomic: `update … where
requested_notified_at is null` is evaluated under a row lock, so a second
concurrent invocation blocks, re-reads the committed row, matches nothing and
gets null — one claim, one refusal, never two emails. A pre-read check on
`status`/`requested_notified_at` is kept **only** for a useful error message and
is explicitly not the gate, because it races.

**One guard had to come before the claim:** with `RESEND_API_KEY` unset nothing
can be sent, so the function returns before claiming. Without that, a keyless
deployment — the state this repo cannot currently verify, and so the likely one —
would stamp every request as notified while sending none, which is the exact lie
the "only stamp when something went out" rule exists to prevent.

**Residual, stated rather than hidden:** a provider that is *configured but
erroring* leaves the row claimed with nothing delivered. That is the deliberate
direction, the same trade `help-ask` makes for its reservations ("billing unknown
resolves as billed"), because releasing the claim on failure needs an
owner-callable un-stamp — and an owner-callable un-stamp reopens the unbounded
re-send this gate closes. Logged as `where: "requested_send"` so it is findable;
a real retry mechanism is the product answer, not a weaker gate.

**The guarantee belongs to the PAIR**, so a future caller that sends first would
silently lose it. `privilege.test.mjs` asserts the ordering (claim before any
`sendEmail`, provider-key return before the claim) and the two refusals.
Mutation-tested: claim moved back after the sends, provider-key return deleted,
null claim allowed to fall through, `bad_stage` refusal dropped — 4/4 caught.

### ✅ RESOLVED by redesign (option B) — FOUR ROUNDS ON ONE MECHANISM: the notification stamps did not establish that a notification happened

`global.md` → *Review Rounds Have to Terminate* says a mechanism that keeps
failing across rounds gets reverted or redesigned, not patched again. This one
failed four consecutive times on PR #256, so the fifth patch was **not** written.

| round | the bypass | the fix |
|---|---|---|
| 3 | staff reset the stamp to null → unbounded resend | revoke table-wide UPDATE, column-grant `(status, approved_at)` |
| 4 | a write-once trigger closes backward writes but leaves the FIRST write open → **pre-claim**, made immutable | withdrew the trigger-only design; authorizing SECURITY DEFINER functions |
| 5 | the **INSERT** path — create the request already stamped | narrow INSERT to the seven creation columns |
| 6 | the grantee calls the **RPC directly** — no Edge Function, no email | **not patched. This section.** |

**What the stamps actually promise:** that a claim was taken. **Not** that a
notification was attempted. `EXECUTE` on both functions is granted to
`authenticated`, so an owner can call `/rest/v1/rpc/stamp_requested_notified`
directly and the legitimate notification then answers `already_notified` and
stays silent.
⚠️ **The post-apply probe in `migrations/20261013005250` is that exploit**, and
it was read as a passing test — calling the function as the owner *is* the
bypass. A probe can demonstrate a hole and be recorded as proof of a fix.

**Residual harm, stated precisely rather than as "a bypass exists":** a client
suppressing their own email is self-harm and negligible. An **underwriter**
suppressing a *client's* approval notice is real, silent, and by an account that
can already approve or decline arbitrarily. Neither produces unbounded
**sending**, which is what the claim was introduced to stop and does stop. So
this is a suppression residual on an endpoint that is **not deployed**, not a
live incident.

**The two candidate designs, for the owner to choose between:**

**(A) Move the stamps' writer off `authenticated`.** Grant `EXECUTE` on both
functions to `service_role` only and have the Edge Function call them with a
service-role client — the functions are SECURITY DEFINER, so they still need no
table privileges. Caller identity stays RLS-backed because the handler reads the
row as the caller *before* stamping; only the stamp moves. Smallest change that
makes the notification sender the sole writer.
*Cost:* reintroduces a service-role client in the function for one call, and the
identity half becomes "the handler verified it" rather than "the database
enforced it" — though the verification is still an RLS-scoped read.

**(B) Stop using the row, and count in a table the caller cannot touch.** The
`help_queries` model this repo already settled on for exactly this class: a
server-only table where `authenticated` holds **nothing** and only
`service_role` has an explicit grant. Dedup becomes a row keyed on
`(request_id, event)`, written by the function. Immune to every one of the four
bypasses above, because the client has no write path at all.
*Cost:* a new table and migration, and the stamps on `enhancement_requests`
become what they always honestly were — operational markers, not a gate.

**(B) WAS CHOSEN AND IS BUILT** (owner delegated the call, 2026-10-13) **AND
APPLIED 2026-10-14** as `migrations/20261014195128_enhancement_notifications.sql`.
The claim is now a row in `public.enhancement_notifications`, keyed
`(request_id, event)`:
`authenticated` and `anon` hold **nothing** on it, there are no policies, and
only `service_role` has an explicit `select, insert`. The client has no write
path, so none of the four bypasses has an analogue. The migration also **revokes
EXECUTE on both stamp functions from `authenticated`**, closing round 6 outright,
and leaves the two stamp columns in place but **vestigial** — nothing writes them.
✅ **APPLIED 2026-10-14** on the owner's explicit approval, as version
`20261014195128` (matches `list_migrations`), and moved into `migrations/`.
**Measured from the catalog afterwards rather than trusted** — the Supabase MCP
takes SQL inline, so applying a 239-line file means retyping it into a tool call,
which is the same hazard that produced the comment-stripped `help-ask` deploy:
`service_role` holds SELECT+INSERT and `anon`/`authenticated` hold **nothing**
(absent from `information_schema.table_privileges` entirely); owner `postgres`;
RLS on with **0 policies**; `claim_notification` is SECURITY DEFINER with
`search_path` pinned and `proacl = postgres=X service_role=X` (not null, so
PUBLIC does not hold EXECUTE); **EXECUTE on both stamp functions is gone from
`authenticated`**, closing round 6 outright; and exactly one function names the
table. All four client probes (table SELECT, table INSERT, the retired stamp RPC,
the new claim RPC) return **42501** as a real `authenticated` session; the
`service_role` positive control claims once, returns NULL on a repeat, NULL on a
status mismatch and NULL on an unknown id, run inside `begin; … rollback;` with
the table empty afterwards.
⚠️ **This unblocked the `notify-enhancement` deploy; it did not deploy it.**
`functions-deploy.yml` deliberately deploys `help-ask` only, so that endpoint
still 404s and no enhancement-request email has yet been sent.
Was: WRITTEN, NOT APPLIED — it creates a table and grants, which is an owner
decision; until applied the function failed closed (`claim_failed`, nothing
sent), no regression on an endpoint that 404s. `proposed/README.md` declared it
deploy-blocking and `privilege.test.mjs` enforced that declaration — a coupling
now satisfied by the file's location instead.

⚠️ **(A) WAS NOT MERELY THE LESSER OPTION — IT DOES NOT WORK, and the write-up
above said otherwise for a day.** Both stamp functions authorize on
`auth.uid()` (`owner = auth.uid()`, and `profiles.id = auth.uid()` for the
underwriter check). A service-role client carries no user JWT, so `auth.uid()` is
**NULL** and both predicates match zero rows: granting EXECUTE to `service_role`
and calling them that way would make every claim return null, the handler answer
`claim_failed`, and no email ever send again. (A) was therefore never a grant
change — it was a rewrite of the functions' authorization, moving the identity
check out of the database and into the handler, which is the expensive half of
the option with none of its stated benefit. Measured by reading both function
bodies when the choice was actually being made, not when it was being written up.

**What (B) does NOT move into the handler**, since that was the stated cost of
(A) and deserves the same scrutiny: authorization. The row is still READ as the
caller under RLS (`er_select_own` / `er_underwriter_select`), the role still comes
from the caller's OWN `profiles` row, and the status transition is still an UPDATE
as the caller under `er_underwriter_update`. What changed is only that the claim
STATEMENT stopped being the place that also checks identity — a caller who is not
entitled cannot reach the claim, and could not move the row if they did.

⚠️ **WHAT I CALLED "the one honest loss" WAS A BAD READING, AND CODEX CAUGHT IT
ON THE REDESIGN COMMIT (P1).** This paragraph used to say the stage pre-read now
races the claim, costing at most "one possibly-stale email", and present that as
the accepted trade. Two things were wrong with it. First, it **averaged two
different defects into one sentence**: on the requested path a late email is
merely stale; on the **approved** path the handler asserts something untrue about
the client's policy — if another underwriter declines the request after the
guarded transition, the claim still succeeds and a **false final-approval email**
goes out. The primary key bounds that to one email; it does not prevent it.
Second, **the old design did this one thing right** — its claim carried `and
status = 'approved'` in the same statement — so the redesign lost a property the
thing it replaced had, while fixing four bypasses around it. A redesign can do
that, and the write-up argued the loss away instead of flagging it.
**Closed by `public.claim_notification(uuid, text)`:** `insert … select … where
<status matches> on conflict do nothing returning`, so the predicate and the
conflict are evaluated in one statement and there is no window. It is **not** a
return to the shape round 6 bypassed — EXECUTE is `service_role` only (revoked
from `public, anon, authenticated`), so the client cannot call it, and it reads
no identity from `auth.uid()`: the caller is already authorized by the RLS-scoped
reads and the guarded transition.

⚠️ **AND THE RETIRED COLUMNS WERE STILL BEING READ AS A GATE (P2, same review).**
Two prechecks gated on `row.requested_notified_at` / `row.approved_notified_at`,
so for any row whose OLD stamp had been set — including by round 6's direct-RPC
bypass, and including this repo's own probe rows — the handler answered
`already_notified` **before** consulting the claim table. Because those values
are write-once and the migration neither clears nor imports them, the suppression
bypass survived the redesign *permanently* for exactly those rows. Both prechecks
are gone and the columns are **no longer selected at all**, which makes a relapse
impossible rather than merely absent. The stage precheck on `row.status` stays —
that one is about the lifecycle, is still true, and is still not the gate.

### ⛔ REDESIGNED, ROUND 20 — a source scanner that enumerates spellings cannot terminate

**Three consecutive rounds on one mechanism**, all on `privilege.test.mjs`, all
found by Codex and never by this suite, every one of them SILENT (the statement
was skipped and every gate stayed green while the privilege was live):

| round | the spelling that walked past | what it would have allowed |
|---|---|---|
| 17 | `all [privileges]` where the regex wanted the word `execute` | the client calls the claim RPC |
| 19 | `anon` — not a channel at all, so the statement was **skipped** | an anon-key insert pre-consumes the claim |
| 20 | `on routine f(…)`, and `on all tables in schema public` | both of the above, by another spelling |

`global.md` → *Review Rounds Have to Terminate* says the third failure gets a
redesign, not a fourth patch. **Adding `ROUTINE` to the regex is the fourth
patch.** The defect is not that `ROUTINE` was missing; it is that the suite
could not tell it was missing.

**So the question is inverted**, exactly as `BACK_ELIGIBLE` and
`check-keep-back-routes.mjs` were inverted after their second failures. Every
`GRANT`/`REVOKE` in every migration is parsed and its TARGET classified, and
anything unclassifiable **fails the suite by name** with the file and the
statement. A spelling nobody thought of now costs a loud failure instead of a
hole. Four target kinds feed the replays (`table`, `all-tables`, `function`,
`all-funcs`); a documented set that cannot carry a table or routine privilege
(sequences, schemas, types, languages, large objects, databases, …) is ignored
*explicitly*; everything else is `unknown`.

**Measured, 13 mutations.** 9 bypasses caught — the two Codex reported plus
seven nobody did: `on procedure`, `all procedures in schema public`,
`all tables … to PUBLIC`, a two-target statement with the claim table second, an
**unqualified** table name (refused rather than guessed as `public`),
`ALTER DEFAULT PRIVILEGES`, and a grant built inside a `DO` body. 4 controls
stay clean, including a `COMMENT … IS '… explicit grant …'` whose prose contains
the word.

⚠️ **THE HEADLINE MUTATION IS THE ONE THAT PROVES THE REDESIGN RATHER THAN THE
FIX:** delete the `routine|procedure` arm *and* leave the `ON ROUTINE` grant in
place, and it is **still caught** — by the completeness gate, naming the
statement. That exact state was 19/19 green before.

⚠️ **TWO THINGS THE REDESIGN GOT WRONG FIRST, both found by mutation.**
1. **The completeness gate cried wolf on prose.** Its first run failed on the
   claim migration's own `comment on table … is '… by explicit grant. …'`. A
   gate that fails on a comment is a gate that gets deleted, so the statement
   splitter now blanks the CONTENTS of quoted regions before anything is
   classified — and treats the two quoting forms differently on purpose: `'…'`
   is data, blanked and forgotten; `$tag$…$tag$` is an executable body, blanked
   for parsing but **reported as unreadable if it contains grant/revoke**,
   because a privilege change built inside a body is real and is not modelled.
   (CLAUDE.md already forbids routing DDL through a `DO` block past a
   classifier, so a hit there is a finding either way.)
2. **Classifying a target is NOT the same as feeding it to a replay, and only
   one of those was tested.** A mutation stopping `effectiveExecute` from
   consuming schema-wide routine grants **SURVIVED** — the end-state gates prove
   the end state of what they are FED, and what feeds them is a separate claim.
   `effectiveExecute` now takes its migrations as an injectable parameter purely
   so that claim can be tested at all (it read `orderedMigrations()` directly,
   so the only way to exercise it was to drop a file into the repo). Both
   wirings are now pinned, with a control assertion so the positive cases cannot
   pass vacuously.
   ⚠️ Relatedly: the schema-wide **table** wiring is caught ONLY by its own
   direct assertion, not by the end-state replay — measured. Do not read a green
   replay as proof that the thing feeding it is correct.

⚠️ **And two harness errors in this one round, both of the kind already recorded
below.** A `python3` splice with `replace(..., 1)` landed on
`effectiveFunction` instead of `effectiveExecute` — the edit applied, to the
wrong function, caught by `migs is not defined` rather than by reading the diff.
And a mutation loop printed **no grades at all** because the helper lost its
explicit `return 0`, so `git diff --quiet`'s exit code (1 = changes present)
suppressed every grade through an `&&`. Nothing looked wrong: five mutation
names printed with silence under each. **An applied-check that can swallow the
grade is worse than no applied-check** — read the output, not the exit status.

### ⚠️ ROUND 21 — AN INVERSION COVERS THE SURFACE YOU INVERT, AND NOT ITS NEIGHBOURS

The round-20 redesign above was right and **incomplete in a way worth more than
either bug it missed.** It inverted the **target** of a `GRANT`/`REVOKE` — fail
closed on anything unclassifiable — and left the two surfaces either side of it
enumerated. Codex found both in the very next round, and neither is a new class:

| surface | the bypass | 20/20 green? |
|---|---|---|
| the **grantee** | `\bpublic\b` on the grantee text read a quoted custom role as the PUBLIC pseudo-role: grant EXECUTE to PUBLIC, then `revoke … from "public-reader"`, and the replay recorded the revoke as closing PUBLIC while the real grant stood | yes |
| the **literal's context** | a `DO` body may be a plain string literal — `do 'begin grant execute on function public.claim_notification(uuid, text) to authenticated; end'` executes that grant, and round 20 blanked every `'…'` as inert data and forgot it | yes |

Both reproduced before fixing. **The lesson is the shape, not the two fixes:**
when a mechanism is redesigned to fail closed, the *boundary* of that redesign
is the new attack surface. "I inverted the parser" was not true — one field of
it was inverted.

**Both surfaces are now inverted the same way**, and deliberately as
allow-lists of the *safe* case with a fail-closed default:
- **Grantees are parsed as SQL identifiers**, not matched as substrings.
  Unquoted folds to lower case, quoted is verbatim, and the mapping to the four
  channels is EXACT — so `"public-reader"`, `"Authenticated"` and
  `some_other_role` are simply not channels. An **unrecognised grantee is
  reported**, because a custom role can be `GRANTED TO authenticated` and role
  membership is not modelled. (Measured: the only grantees this repo names are
  PUBLIC/public/anon/authenticated/service_role, so failing closed costs
  nothing today.) `WITH GRANT OPTION` and `GRANTED BY` are stripped as the
  clause suffixes they are — the first also contains the word `grant`.
- **A quoted literal is code or data by its STATEMENT HEAD.** `DO` and a
  function definition's `AS '…'` are code; a documented inert set (COMMENT,
  INSERT, SELECT, CREATE TABLE/POLICY/…, …) is data; **anything else whose
  literal contains grant/revoke is reported**. Enumerating the *executable*
  side is what failed, so the enumeration is on the inert side.
- `REVOKE GRANT OPTION FOR <priv>` is **reported rather than modelled**: it
  removes the right to re-grant and leaves the privilege, so reading it as a
  revoke would record the privilege as closed — wrong in the unsafe direction.

**17 mutations across both rounds.** Round 21: 7 bypasses caught (the two
reported plus `as '<literal body>'`, a grant to a custom role, a quoted
`"authenticated"`, `REVOKE GRANT OPTION FOR`, and `WITH GRANT OPTION`), 3
controls clean, and the fail-closed default proven load-bearing — a `CALL`
whose literal is a GRANT is caught, and flipping the default to fail-open lets
it through.

⚠️ **WHERE THE GATE ACTUALLY SITS, stated because a reader will assume
otherwise.** Reverting `parseGrantees` to the round-20 substring version *with
the bypass present* is caught by the **unit pin** on `parseGrantees`, not by the
end-state replay — the replay cannot see it unless that bypass migration is in
the repo. Same for `WITH GRANT OPTION`. So the pins are the gate on parser
semantics, and deleting one is not cosmetic. This is the third time on this PR
that the thing catching a regression was not the thing it looked like: see also
the schema-wide table wiring, and S22's console-log assertion.

### ⛔ ROUND 22 — every STATEMENT, not every GRANT (⚠️ CALLED "TERMINATING" AND IT WAS NOT — see round 23 below)

**Five rounds, one shape.** Each one found a construct that changes what a client
can do and that the scanner was not looking at. Rounds 20 and 21 were already
redesigns, and they are the reason this entry exists: **both inverted a FIELD of
a GRANT statement**, and the next round walked in through the field next door,
then through something that is not a GRANT at all.

| round | construct | where it lived |
|---|---|---|
| 17 | `all [privileges]` | a FIELD of a GRANT (the privilege) |
| 19 | `anon` | a FIELD of a GRANT (the grantee) |
| 20 | `on routine` / `on all tables in schema public` | a FIELD of a GRANT (the target) |
| 21 | `"public-reader"`, `do '…'` | a FIELD, and the literal's context |
| 22 | **`alter table … owner to authenticated`** | **not a GRANT at all** |

**Why field-by-field inversion could never terminate:** the set of things that
affect privileges is not a set of GRANT fields. Ownership transfer, `ALTER
DEFAULT PRIVILEGES`, role membership (`grant <role> to authenticated`), a
SECURITY DEFINER body, dynamic SQL, and `FORCE ROW LEVEL SECURITY` are all
outside it. A gate that only reads GRANTs is unsound however carefully its
fields are parsed.

**So the question is now asked about the STATEMENT — the last boundary there
is.** Nothing in a migration sits outside one, so there is no further level to
be pushed out to; that is the sense in which this ends the regress structurally
rather than by promising to be more careful next time. Every statement must be a
kind this suite has reasoned about, and anything else **fails by name** with the
file and the statement. The allow-list is of **benign** kinds, measured against
the 87 statements this repo actually contains (every head enumerated before the
list was written) — not a deny-list of dangerous ones, because a deny-list is
exactly how rounds 17–22 happened.

⚠️ **AND THE GATE DOES NOT DEPEND ON HAVING ANTICIPATED THE FINDING.** Measured:
with the named `owner` arm **and both its pins** deleted, the sweep still
reports `alter table … owner to authenticated` as *"unrecognised statement
kind"*. The named arm only improves the message. That is the property that
makes this different from the four previous fixes.

**The three round-22 findings, all reproduced at 20/20 green before fixing:**

| # | finding | why it was invisible |
|---|---|---|
| 1 | `select public.run_sql('GRANT … TO authenticated')` | the literal classifier asked whether the statement's HEAD was executable, and `select` was on the inert list |
| 2 | a later `create or replace … as $body$ … $body$` | `effectiveFunction` closed the body on a literal `$$;`, so the replacement was skipped and every gate kept validating the OLDER definition — a version with no status predicate and no `for update` passed |
| 3 | `alter table … owner to authenticated` | not a GRANT, so the privilege replay saw no event at all; a table owner also bypasses RLS unless FORCE is set |

**The head was never the right question for a literal.** A literal either parses
as a GRANT statement or it does not, and that is decidable without knowing who
executes it — so the test is anchored at a statement start (the literal's
beginning, after an optional `BEGIN`, or just after a `;`). Head-independent,
with no inert list left to be incomplete. That anchor is what separates
`'GRANT EXECUTE ON … TO authenticated'` from this repo's own
`'… holds select+insert by explicit grant. Replaces …'`.
⚠️ **My own pin table disagreed with the implementation on first run** and the
pin was the thing that was wrong: I had marked *"we grant nothing on this table
to anyone"* as reportable. It contains `grant`, `on` and `to` and is still
prose — which is the anchor's whole job, since an executed literal must *begin*
a statement.

**`effectiveFunction` now matches PAIRED dollar tags and fails closed.** `$$` is
just the empty tag, so a tagged body was never an exotic spelling; and a
definition whose body cannot be delimited is **reported** rather than skipped,
through one shared `requireFunction()` so the reason reaches the reader instead
of surfacing as an unrelated failure on `hit.body` being undefined.

**Measured, 15 mutations.** 8 bypasses caught — the three reported plus five
nobody reported: `no force row level security`, `create role` + `grant <role> to
authenticated`, `alter role authenticated bypassrls`, an `insert` whose row value
is a grant statement, and an event trigger. The control (a benign DDL+DML mix,
including a `COMMENT` whose prose contains both words and a legitimate RPC call)
stays clean. Every fix is proven load-bearing: deleting the sweep reopens the
owner hole, flattening `BENIGN_STATEMENT` to "benign" fails the pins, removing
the literal anchor lets the `run_sql` grant through, and reverting the dollar-tag
match restores finding 2.

⚠️ **One deliberate false positive.** An `insert` whose row value happens to be a
grant statement is reported. No such table exists here; if a legitimate
job-queue table ever does, the reported-not-silent direction is still the right
one and the fix is to model that table, not to loosen the anchor.

### ⛔ ROUND 23 — THE RETRACTION: a text scan over SQL cannot decide who can write a table

⚠️ **THE ROUND-22 ENTRY ABOVE CLAIMS IT "ends the regress structurally rather
than postponing it". THAT CLAIM IS FALSE AND THIS SECTION RETRACTS IT.** Codex
round 23 found four more, all at 21/21 green, and **all four were items I had
explicitly asked to have challenged** in the round-23 request — the benign list,
the `alter table … alter|rename` arm, the literal anchor, and the first-dollar-tag
assumption. Every line I flagged as uncertain was in fact wrong.

| # | the bypass | why it was invisible |
|---|---|---|
| A | a decoy body in a function OPTION: `set app.audit = $safe$ <correct-looking> $safe$ as $real$ <unsafe> $real$` | `effectiveFunction` took the FIRST dollar tag after the parameter list, so the predicate and `for update` assertions inspected the SET value |
| B | create an open table, grant it to `authenticated`, `rename` the protected table away and the open one in | the replay is keyed on the table NAME, so every grant it recorded moved to a different object |
| C | a later SECURITY DEFINER helper that inserts straight into the claim table | `create function` was blanket-benign, and a new function is EXECUTABLE BY PUBLIC unless revoked |
| D | `'BEGIN IF true THEN GRANT … ; END IF; END'` | round 22's anchor required the GRANT at a statement start; PL/pgSQL permits it after arbitrary control flow |

**What the six rounds actually establish.** The statement boundary was the right
*level* — but classification *within* it is itself open-ended: dollar tags with
arbitrary names, `AS` clauses that are not the first quoted span, PL/pgSQL
bodies, renames, ownership, default privileges, role membership, and function
bodies that can do anything. **Privileges do not arrive only through GRANT
statements, and SQL has a procedural sublanguage inside it.** So:

⛔ **`privilege.test.mjs` is a NET, not a proof** — the same language this repo
already uses for `check-keep-back-routes.mjs`, and it should have been used here
from the start instead of three successive claims to have closed the class.
What bounds the harm is that a construct it cannot read now **fails by name**,
so the cost of a novel one is a loud failure rather than a silent hole.

✅ **THE AUTHORITATIVE CHECK IS A CATALOG QUERY, AND IT IS NOW WRITTEN DOWN.**
`index.ts`'s deploy header previously said only "confirm the migrations are
applied". It now carries, as step 3, four runnable queries that measure the END
STATE however it was reached: who holds privileges on the claim table and **who
owns it** (an owner is not subject to its own policies unless FORCE is set);
whether RLS is on and that there are **zero** policies; `pg_proc.prosecdef` /
`proconfig` / `proacl` for the claim RPC (a null `proacl` means PUBLIC may
execute); and **every function whose source names the claim table**, which must
be exactly one. (a) and (d) are the two no source scan can replace.

**The four fixes, since they are real regardless:**
- the function body is located from its **`AS` clause**, walking the statement
  while skipping dollar- and single-quoted spans so an `as` inside an option
  value cannot be mistaken for the clause;
- `alter table … rename` leaves the benign list and **fails closed** (this repo
  contains no RENAME at all, measured, so it costs nothing);
- `create|alter function` is classified by **what its body touches** — a
  function naming a protected table is a write path to it whatever its grants
  say, and only the claim RPC itself is allowed to;
- the literal test has **no anchor and no head test left**: any literal naming
  `grant`/`revoke` is reported, with one structural exemption — the argument of
  a `COMMENT`, which is documentation by construction. Measured: exactly one
  literal in this repo names either word and it is that COMMENT.

⚠️ **FIXING THE REPORTED BUG WAS NOT ENOUGH FOR (A), AND THE FIRST FIX WAS GREEN
AND INERT.** `asClauseBody` correctly returned the `$real$` body — and the
attack still produced **zero failures**, because `hit.body` spans the WHOLE
create statement, decoy included, and that is what the assertions read. The
reported parse bug and the consumer were two defects. It surfaced only on a
re-check with a probe footer added, so the incidental "no probe documented" gate
could not mask it: **a repro that fails for a different reason than the attack
is not a repro.** `hit.inner` is now the body and `hit.body` the statement, and
the split is stated at both.

⚠️ **AND TWO OF MY PINS WERE TESTING A PATH NO CALLER TAKES.** The sweep
classifies the BLANKED scan plus the verbatim text; the pins passed RAW SQL. So
C and a string-bodied variant **survived their mutations while the pins were
green** — a function body lives in a quoted span, which `scan` blanks by design.
The pins now go through `sqlStatements` exactly as the sweep does. **A pin that
feeds the classifier different input than its caller does is not a pin** — the
same family as the concatenated-files lesson recorded below.

**Measured, 15 mutations.** 9 bypasses caught — the four reported plus a function
that only READS a protected table, a GRANT inside a `LOOP`, a rename with no
replacement, a string-bodied writer, and the decoy with a probe footer. One
control clean. All six fix-mutations caught, including the COMMENT exemption in
the other direction (removing it cries wolf on this repo's own comment).

⚠️ **One harness error worth keeping:** a mutation helper lost its `"$1" "$2"`
arguments, so six mutations reported `!! DID NOT APPLY`. That is the *good*
failure mode — compare the round-20 version, which lost its `return 0` and
printed six names with silence under each. **Make the applied-check loud, never
inferential.**

### ⚠️ ROUND 24 — I SHIPPED AN UNRUNNABLE QUERY AND CALLED IT RUNNABLE

Three P2s, and the first is the one to keep: **the round-23 deploy header, written
specifically to replace an overclaiming scanner with an authoritative check,
referenced `pg_policies_compat` — a relation that exists in neither PostgreSQL
nor this repo.** Query (a) would have stopped with *relation does not exist* and
returned none of the end state it promises. The overclaiming defect, reproduced
one layer out, inside the section written to correct it, in the same commit.

It is now gated mechanically rather than by a promise to proofread: a test reads
the header, and any `from pg_*` / `from information_schema.*` naming something
outside a known set **fails by name**.
⚠️ **That gate took three attempts, and the first two are the lesson.** Scanning
every `from X` flagged `the`, `a` and `authenticated` — the words after "from"
in the header's own English. An indented-line heuristic did not help either,
because one prose line literally begins *"from a session, see above"*, and
joining the lines made it worse since `\s` spans newlines. Bounding the slice to
the comment block was also needed: it had run to end-of-file and was reading an
HTML email template. What settled it was **inverting the check** — validate only
names that are CATALOG-SHAPED, which is exactly the mistake that happened. An
invented relation of some other shape is missed, and that limit is stated rather
than hidden. (Found by one `console.log` printing the offending lines, after two
rounds of guessing at the classifier.)

**The second finding answers the question I had put to the round:** the `prosrc`
substring query does **not** list every function that can write the claim table.
A PUBLIC-executable SECURITY DEFINER helper can **call** `claim_notification`
without ever naming the table, so (b) still reports the RPC as service-role-only
and the substring search still returns one row while a client pre-consumes a
claim. Views, triggers and dynamically assembled names have the same gap. So the
deploy step had inherited the unsoundness just retracted for the scanner.
**Fixed by changing what is measured, not by widening a regex:** the set of
functions a client role may execute *as their definer* is **exact from the ACL**,
independent of any source text, and small —
`where p.prosecdef and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
or has_function_privilege('anon', …))`. Every row must be one you can account
for, because a definer function runs as its owner and so is not bounded by what
the caller can do. The substring search is kept as a narrower aid and **labelled
not exhaustive**; a test asserts that label is present, so the word
"authoritative" cannot quietly come back.
**What (d) now claims, precisely:** it bounds the *reviewable surface* rather
than proving it empty. An escalation path must appear as a row; deciding what a
given row's body does is back to reading code. (a)–(c) remain exact.

**The third:** `isClaimRpc` searched the whole CREATE statement, so a different
helper could carry the inert text `function public.claim_notification(` in its
**body** — a string literal, say — and inherit the allowed RPC's exemption while
inserting into the claim table. Reproduced at 21/21. The identity now comes from
the statement **header** (everything before the `AS` clause's body), so a body
cannot contribute to the name.
⚠️ My first repro put that string in a `--` comment, which `stripSqlComments`
removes, so it failed for the wrong reason — the same "a repro that fails for a
different reason than the attack is not a repro" trap as round 23, one round
later.

**Measured, 6 mutations, all caught:** the body-text impersonation and its
quoted-string variant; reverting `isClaimRpc` to the whole text; restoring the
invented relation; and deleting the not-exhaustive label. A legitimate
replacement of the real claim RPC stays clean.

### ⚠️ ROUND 25 — THE CLAIM WAS THE DEFECT, THREE ROUNDS RUNNING, AND IT IS NOW GATED

Two P2s, both direct answers to questions put to the round, and both confirmed
the claim was too strong.

**1. "Every escalation path appears as a row" was false, and a trigger shows
it.** PostgreSQL checks `EXECUTE` on a trigger function **when the trigger is
created**, not for the role whose DML fires it. So a SECURITY DEFINER trigger
function with EXECUTE revoked from `anon` and `authenticated` still runs on a
client's INSERT, `has_function_privilege` is false, and the direct-ACL query
omits it — even if its body writes the claim table or calls the claim RPC. Codex
round 25, with the upstream thread cited. Closed by a second query over
`pg_trigger` ⋈ `pg_proc` for definer trigger functions on client-writable
tables, and by **naming what is still not covered**: a view with
`security_invoker` off, `ALTER DEFAULT PRIVILEGES` on later objects, role
MEMBERSHIP, rules, and dynamic SQL inside a definer body.

**2. The header gate scanned `FROM` and not `JOIN`.** Queries (a), (b) and (d)
all join catalogs, so mistyping `join pg_namespace n` → `join
pg_namespace_compat n` stayed green and permitted exactly the unrunnable-query
class the gate exists to prevent. Reproduced at 22/22. One of two syntaxes for
the same thing — the enumeration mistake of rounds 17–22, in miniature, inside
the gate written to end it.

⚠️ **THE REAL FINDING IS WHAT MUTATION TESTING THEN SHOWED: THE NARROWING WAS
NOT GATED.** Deleting the trigger query failed **nothing**. Deleting the whole
NOT-COVERED list failed **nothing**. Three consecutive rounds had found the
header *claiming* more than its queries deliver — "authoritative" (r23), "every
function that can write the table" (r24), "every escalation path appears as a
row" (r25) — and each time the correction was **documentation**, which is
precisely what had been wrong. So the honesty is asserted now: tests require the
`pg_trigger` query to be present, require the prosrc aid to carry its own
not-exhaustive disclaimer, and require each of the four known gaps to be named.
**Prose that nothing checks is the thing that has been wrong every time.**

⚠️ **And my own new assertion had the scoping defect, on a third surface.** The
not-exhaustive check matched **anywhere in the header** — and the phrase also
appears in the summary paragraph, so deleting the prosrc query's *own*
disclaimer left it green. Mutation-tested: that version SURVIVED. It is now
scoped to the query's own block, on the reasoning that a reader who copies the
SQL does not read a summary four paragraphs down.

**Measured, 9 mutations.** Both findings caught; the JOIN arm, the trigger
query, the gap list, the scoped disclaimer and the prosrc query are each proven
load-bearing; and reverting the gate to FROM-only lets the mistype through,
which is what makes the JOIN arm the gate rather than decoration.

**What the deploy header now claims, in its own words:** (a)–(c) are sound and
exact from the catalog; (d1) and (d2) each enumerate **one kind** of path to a
definer body a client can cause to run; five kinds are listed as not covered.
*"These queries make the escalation surface SMALL AND LISTED, not empty and
proven."* That is a weaker claim than any of the three it replaces, and it is
the first one that is true.

### ⚠️ ROUND 26 — KNOWING A DEFECT CLASS IS NOT THE SAME AS NOT WRITING IT AGAIN

Two P2s, both answering the two questions put to the round, and both small. The
instructive part is what mutation testing then said about my own fixes.

**1. The trigger query filtered on the caller's privileges, and that cannot be
sound.** It required the client to hold INSERT or UPDATE on the trigger's table.
Triggers fire on **all four** DML events, so a client holding only DELETE or
TRUNCATE still fires one; and a DELETE trigger also fires on a **CASCADE** from
another table, where the client may hold *nothing* on the trigger's own
relation. Fixed by **deleting the filter**: the privileges are reported as
columns for the operator to read, and the row set is every non-internal definer
trigger in `public`, which is small. CASCADE is now named in the gap list too.

**2. The gap-list assertion pinned FOUR of the FIVE gaps the prose named**, so
deleting `rules (CREATE RULE)` from the header stayed green — the exact
mutation-testing failure the assertion had been added one round earlier to
prevent, reintroduced by transcribing the list instead of counting it. The
array in the test is now canonical: a new gap goes there first.

⚠️ **AND THEN TWO OF MY OWN FIXES SURVIVED THEIR MUTATIONS, FOR THE SAME REASON
AS EACH OTHER.** Deleting `CASCADE` or `dynamic SQL` from the gap list failed
nothing, because **both phrases appear twice in the header** — once explaining a
query, once in the list — and the assertion matched anywhere in the header. That
is *the same scoping defect fixed one round earlier for the not-exhaustive
check*, **reintroduced in the assertion written directly beside it**, in the same
test, by me, one round later.
It is now scoped to the NOT-COVERED paragraph, and each of the six gaps is
mutation-tested individually against its **last** occurrence rather than its
first — because mutating the first occurrence hits the explanatory mention and
proves nothing. 7/7 caught after that.

**The generalisable lesson, which is why this has its own section:** this repo
already records the scoping defect three times (the concatenated-migrations
scan, the `.k-h1` assertion, the round-25 disclaimer). Recording it did not stop
me writing it a fourth time, in the file where it had just been fixed. What
caught it was **mutating each item separately**, and nothing else would have —
the suite was green, the assertion looked scoped, and the prose read correctly.
**A defect class you can name is still one you will write; only the mutation
grades it.**

⚠️ One further process note: two mutations in this round were initially
mis-graded because the script replaced the **first** occurrence in the file,
which for both of these words lay outside the list under test. Mutating "the
word" is not the same as mutating "the word where it carries the claim".

### ✅ PR #256 REVIEW CHAIN TERMINATED CLEAN AT ROUND 28 (2026-10-13)

Twenty-eight Codex rounds, ending *"Didn't find any major issues"* on `b03b571`.
Recorded because the shape of those rounds is the useful part, and because a
reader meeting the sections below needs to know they describe a chain that
**finished** rather than one still running.

| rounds | what the findings were about |
|---|---|
| 1–16 | the handler, the claim mechanism, RLS and grants — **real behaviour** |
| 17–22 | the source scanner's completeness — five rounds, one mechanism, ending in a redesign |
| 23–27 | **the CLAIMS**: ten findings, nine of them documentation asserting more than its queries deliver |
| 28 | clean |

**The single most useful thing learned here:** from round 23 on, the code stopped
being the defect and the *write-up* became it. The function, the proposed
migration and the suite's behaviour were unchanged from `da86e83` to `b03b571`;
every finding in that stretch was a sentence claiming more than it could. Three
of those were in sections written specifically to correct an earlier overclaim.
**Prose that nothing checks is the least reliable artefact in the repo**, and the
answer that finally worked was to gate the claims mechanically — the header's
queries must name only real relations, must carry their own non-exhaustiveness
disclaimer, must name every known gap, and must not state an `EXPECT` that the
migrations contradict.

⚠️ **What is NOT closed, and must not be read as closed:** the owner gate below.
A clean review is a statement about the diff, not about production.
✅ That gate is now fully cleared: the claim migration was **applied 2026-10-14**
(`migrations/20261014195128_enhancement_notifications.sql`) with the catalog read
back and every probe run, and `notify-enhancement` was **deployed from the
runner's checkout the same day**, once `functions-deploy.yml` gained it as a
second matrix row.

⚠️ **AND THE SENTENCE THIS REPLACES WAS WRONG IN AN INSTRUCTIVE WAY.** It read
*"`notify-enhancement` is still NOT DEPLOYED … so the endpoint 404s"*. Measured
2026-10-14 before deploying: the function **was** deployed — ACTIVE, **version
2**, `verify_jwt: false`, `entrypoint_path` under `/tmp/user_fn_…` (an old inline
tool-call deploy of the PRE-REWRITE source). It answered **404 to every caller**
for the privilege reason in its own header: `service_role` holds no table
privileges here, the first query returned 42501, and the error was folded into
`rowErr`. **Two real observations — "deployed and ACTIVE" and "the endpoint
404s" — were joined by an inference that was false**, and this file carried both
halves in different sections for days. The lesson is the familiar one in a new
place: *a 404 is evidence about a response, not about a deployment.*

### ⚠️ ROUND 27 — A WRONG `EXPECT` IS WORSE THAN A MISSING ONE

One P2, and it is a factual error in the deploy checklist rather than a bypass.
The (d2) trigger query filters on `p.prosecdef`, and
`enforce_notified_write_once()` is declared **without** `security definer`
(`20261013013743`) — so it is an INVOKER trigger and the query correctly returns
**zero rows**. The header said to expect the write-once trigger in that result.
An operator following it would have read a correct empty result as a **failed
apply**.

**Why that is worse than having no EXPECT at all:** a checklist that cries wolf
on its first run is a checklist that stops being run, and the whole reason this
header exists is that the source scanner could not be trusted. A false alarm in
the replacement is a direct attack on the replacement's usefulness.

**The filter is right and stays.** An INVOKER trigger runs with the CALLER's
privileges, so it is not an escalation path and does not belong in a query about
definer bodies. The *prose* was wrong, not the SQL — consistent with rounds
23–26, where the claims kept being the defect.

**And the EXPECT is now tied to the source**, so it cannot drift again: a test
counts the SECURITY DEFINER trigger functions this repo declares and requires
the header to say "zero rows" while that count is zero — or, if one is ever
added, to **name it**, so an operator can tell an expected row from a new one.
Mutation-tested 3/3: reverting the EXPECT fails; adding a definer trigger
function to a migration fails until the header names it; adding an **invoker**
one correctly stays clean.

⚠️ Recorded also because of what it says about the last five rounds: 23 through
27 produced **ten findings, and nine were about claims rather than code.** The
function, the migration and the suite's behaviour have been unchanged since
`da86e83`; what kept being wrong was what the documentation asserted about them.
That is worth knowing the next time a section of this file reads as confident.

### ⚠️ A GATE ANCHORED ON `.from(...)` CANNOT SEE A TABLE REACHED BY `.rpc(...)` (2026-10-14)

Found by applying the claim migration and watching **nothing happen**. The
deploy header's machine-checked `CONFIRM APPLIED:` line is derived by
`privilege.test.mjs` — *"every APPLIED migration that REVOKES on a table this
handler names in `.from(...)`"* — and compared by **set equality**, which is the
right shape. It was blind to the one migration that matters most here.

`notify-enhancement` names exactly two tables in `.from(...)`:
`enhancement_requests` and `profiles`. It reaches `enhancement_notifications`
**only** through `.rpc("claim_notification")`. And the helper the derivation
used, `clientTables()`, *additionally* filtered the claim table out by name —
correctly, for **its own** invariant (which client may reach which table), and
wrongly when reused for this one. So the migration that creates the table,
defines the RPC and closes round 6's bypass failed **both** tests and was never
required.

⚠️ **AND THE COMMENT PROMISED OTHERWISE, IN TERMS:** *"when it is applied and
moves to migrations/, it revokes on a touched table … so this derivation picks it
up automatically and set equality then REQUIRES it on the line. Nothing has to
remember to add it."* Measured: the migration was applied, moved into
`migrations/`, and **the suite stayed green at 23/23 with the line untouched.**
That green run is the measurement — the promise was never tested because the
situation it described had never occurred.

**Two lessons, and the second is the general one.**
1. The scoping error: *an assertion over a set that is not the set the property
   belongs to.* This repo has now recorded it five times (the concatenated
   migrations scan, the `.k-h1` assertion, the round-25 disclaimer, the round-26
   gap list, and this). Reusing a helper because it returns roughly the right
   thing is how it keeps happening — `clientTables()` has a correct exclusion for
   a different question.
2. ⚠️ **A GATE'S ANCHOR IS A CLAIM ABOUT HOW THE CODE REACHES ITS DATA, and that
   claim expires.** `.from(...)` was a complete anchor when written; the round-22
   redesign moved the claim through an RPC and silently invalidated it. Nothing
   failed, because the gate's blindness and the thing it was blind to arrived in
   the same change.

**Fixed** by taking the union — `.from(...)` tables **plus** the claim table —
and `20261014195128` is now on the line. ⚠️ **The limit is stated rather than
papered over:** a future RPC over a *further* table must be added by hand, since
there is no `.from(...)` to find it by. Mutation-tested 4/4 (drop the version,
revert the set, delete the migration's table revoke, add a spurious version).

### ⚠️ A COLUMN IS ONLY AS PROTECTED AS ITS WEAKEST WRITE PATH (2026-10-13)

Second time on one PR that closing a direction opened or deepened another, so it
is recorded as a rule rather than as two incidents.

`20261013013743` revoked table-wide UPDATE on `enhancement_requests` and
re-granted `(status, approved_at)`, closing every path by which staff could
reset or forge a notification stamp — **by UPDATE**. It left the table-wide
**INSERT** grant from `20260628091530` untouched, and `er_insert_own` checks only
`owner = auth.uid() and status = 'requested'`. So a client could simply create a
request with a stamp already populated:

```sql
insert into enhancement_requests (owner, subject, message, requested_notified_at)
values (auth.uid(), 'x', 'x', now());          -- ACCEPTED, pre-stamped
```

`notify-enhancement` then reads a populated stamp, answers `already_notified`,
and emails nobody — and the write-once trigger from the same migration makes the
forged value **immutable**. That is the identical pre-claim that caused the
trigger-only design to be withdrawn one round earlier, arriving through the other
write path. Found by Codex within minutes of the apply.

Closed by `20261013014854`: INSERT narrowed to the seven columns
`addEnhancementRequest()` actually writes (`owner, subject, message, policy_id,
asset_id, entity_id, context`). `status`, `id` and `created_at` are omitted
because each has a NOT NULL default — and the `status` default `'requested'` is
what keeps `er_insert_own`'s check satisfied without letting the client choose a
status, measured rather than assumed.

**The generalisable rule:** when narrowing write access to a column, enumerate
**every** statement type that can write it — INSERT and UPDATE at minimum — and
check the grant for each. Narrowing one is not narrowing the column. The same
applies to a default: a column the client cannot name is still set, so the
default has to be the safe value.

### ⚠️ FOUR WAYS A MUTATION TEST LIES, all hit on 2026-10-13

Found while gating the `notify-enhancement` rewrite. None of them is about the
code under test — all four are about the *harness* — and each one produced a
confident green that meant nothing. This file already records that a green DOM assertion
does not prove the guard you wrote is holding the line; these are the same
lesson one level down, in the tool used to check it.

**1. `git checkout --` CANNOT REVERT A BASELINE YOU HAVE NOT COMMITTED.** The
mutation loop was: apply a mutation with `sed`, run the test, `git checkout --
<file>` to restore. But the rewritten `index.ts` was still **uncommitted**, so
every "restore" reverted it to the ORIGINAL service-role version — not to the
new baseline. Mutations 2 through 7 were therefore all run against the old file,
and six of seven reported "all tests fail", which reads like a thorough catch and
is actually the harness testing the wrong file. Untracked files are worse: `git
checkout --` errors out and the mutation **stays applied**, so the next mutation
stacks on top of it. Two mutations to the new migration were silently left in
place and had to be reversed by hand.
**The rule: commit the baseline BEFORE mutating, and verify the working tree is
clean between mutations.** A baseline you cannot restore is not a baseline.

⚠️ **AND THAT RULE AS WRITTEN WAS NOT ENOUGH — IT COST A WHOLE ARTIFACT ON
2026-10-14, WITH THIS PARAGRAPH ALREADY IN THE FILE AND ALREADY READ.** What it
says is "commit the baseline before mutating", which reads as a thing you do
ONCE. **The baseline MOVES.** The sequence was: commit a baseline, run mutations
R1–R6 (safe), then **write a new assertion and run R7/R8 without committing it**.
The harness ends every mutation with `git checkout -- .`, so the new assertion
was reverted along with the mutation — and R7 had already graded it **"caught"**,
honestly, moments before the artifact it graded was destroyed. The squash then
carried a file that did not contain it, every other test stayed green, and the
PR body described an assertion that was not there. Found by Codex on #269, on the
very commit whose message explains the precondition.
**So: commit before EVERY run, not before the first.** The giveaway is free —
`git status --porcelain` must be empty when the harness starts, and a harness
that destroys uncommitted work should refuse to run rather than silently eat it.
⚠️ Note what did NOT catch it: a green suite (the assertion's absence breaks
nothing), the mutation grades (honest, and about a file that no longer existed),
and re-reading the diff. Only an independent reader comparing the claim to the
file did.

**2. AN ASSERTION OVER CONCATENATED FILES CANNOT FAIL.** The gate checked that
the SECURITY DEFINER function still carries `owner = auth.uid()` — its entire
authorisation — by testing that regex against **every migration joined
together**. A dozen unrelated RLS policies in this repo contain that exact
string, so deleting the gate from the function under test **passed**. It was
caught only by running the mutation; nothing about the green run looked wrong.
Now scoped to the function's own body, matched from `create … function
public.<name>(` to its closing `$$;` — which also made room for two guards the
unscoped version could never have expressed (SECURITY INVOKER, unpinned
`search_path`). 9/9 mutations caught after the fix.
**The rule: scope a source assertion to the smallest unit that owns the
property.** Same class as the `.k-h1` visibility assertion and the inverted
`contract.test.mjs` finding already recorded above.

⚠️ **AND "SCOPED" IS NOT A STATE YOU REACH BY NARROWING ONCE — round 18 hit this
rule twice in one assertion.** Gating the new `claim_notification` probe on
`42501` over the whole probe footer was vacuous (probes 1 and 2 both say
`Expect 42501`, so probe 2b carrying no expectation at all passed). Narrowing to
*the nearest preceding `-- <n>.` heading* was **also** vacuous, and that version
**survived its mutation**: strip 2b's number and the search walks back to probe
2, whose block carries its own `42501`. The same defect, one level up, from the
fix for it. What settled it was asserting the unit really is the probe's own —
no other `select`/`insert` between the heading and the call — so the scope is
proven rather than assumed. 5/5 caught after that; a benign renumbering of probe
3 is correctly ignored, which is what shows the block end is not hardcoded.

**3. A MUTATION THAT NEVER APPLIED READS EXACTLY LIKE A SURVIVOR.** Hit on the
round-10 fix, and it is the quietest of the three. The mutation was "move the
owner lookup back below the claim", scripted as a slice between two `s.index`
anchors — and the second anchor, `const { data: claim, error: claimErr }`,
matches the **requested** branch first, which appears EARLIER in the file. So
the slice ran backwards, came out empty, `s.replace("", "")` was the identity,
and the test passed. Reported as a survivor on the one fix the whole round was
about.
What caught it: `git diff` was **empty** after the mutation. So the rule is to
**prove the mutation applied before grading it** — a non-empty diff, or an
assertion inside the script (`assert out != s`), and for an ordering mutation,
re-grep the two line numbers and check they actually swapped. A green run on an
unmutated file is not evidence of anything, and it is indistinguishable from the
guard holding.

**4. A MUTATION THAT APPLIED CLEANLY CAN STILL ENCODE AN IMPOSSIBLE STATE —
and I hit this TWICE, one round apart, the second time with my own warning
about it in the file I was editing.** `orderedMigrations()` already carried the
note: a probe migration dated `29990101` in `migrations/` *cannot exist*, since
a file in `migrations/` is one that has already run and so sorts before anything
in `proposed/`. Round 19's mutation — the anon grant Codex described — went into
`migrations/` again, where the claim migration's own `revoke all … from anon,
authenticated` correctly cancelled it. Four mutations, four "SURVIVED", and the
conclusion I nearly drew was that my fix was inert. Placed realistically (a
LATER file in `proposed/`) it is caught, naming the grantee and the file.
**The rule: a mutation has to describe a state the system can actually reach.**
It differs from #3 in that nothing about the run looks wrong — the diff is
non-empty, the file is read, the replay sees the statement — so the only check
is asking whether the scenario is possible before believing the verdict. And a
survivor must be explained before it is accepted: #3 fails loudly under `git
diff`, this one only fails under thinking about it.

### ⚠️ HTTPS EGRESS TO THE SUPABASE PROJECT IS BLOCKED FROM A SESSION (measured 2026-10-13)

`curl https://bdsegmjcgfmgzuxwiplj.supabase.co/...` fails with
`connect_rejected` — "the egress proxy denied the CONNECT (organization policy)
or could not reach the destination". So from a session there is **no way to run a
real client session over PostgREST or `/auth/v1/token`**, and no way to invoke a
deployed Edge Function. ⚠️ **AND THE HOST LIST WAS WRONG IN BOTH DIRECTIONS — re-measured
2026-10-15.** This said "`akyachtsman.github.io` is reachable, so this is
host-specific, not general", and a session then repeated it. Measured:
`curl https://akyachtsman.github.io/claude.insurance/` returns **000 / FAILED**,
and so does `supabase.com` — so the DEPLOYED SITE cannot be fetched from here
either, and a session must not offer to verify the live page by curl.
What DOES work, measured the same minute: **`raw.githubusercontent.com` (200)**
and **git transport** (`git ls-remote` against `claude.directives` returned
`main`). So the rule is not "egress is blocked" and not "only the project is
blocked" — it is: **raw file reads and git work; general HTTPS does not.**
⚠️ A correction written too broadly is its own defect: the first version of
this fix said "egress is blocked", which would have stopped a future session
reading upstream directives over raw URLs — something `global.md` explicitly
requires and that provably works.

**The workaround, and what it is actually worth.** The in-database substitute is
`set local role authenticated` plus `set local "request.jwt.claims"`, and it
**DOES enforce RLS and column privileges** — so it exercises policies, grants and
a SECURITY DEFINER function's own predicate. Measured 2026-10-13 with a uid
holding no `profiles` row (`99999999-…`): `enhancement_requests` 0 rows,
`profiles` 0, `entities` 0.

⚠️ **AN EARLIER VERSION OF THIS SECTION SAID THE OPPOSITE — "it does NOT enforce
RLS" — AND THE ERROR IS THE INSTRUCTIVE PART.** That claim came from one probe
which acted as `authenticated` with what it called "a FOREIGN uid" and saw
`select count(*) from public.enhancement_requests` return **1** where
`er_select_own` should give 0. The uid used was
`22222222-2222-4222-8222-222222222222` — **the seeded BROKER's id** — and
`er_broker_select` legitimately shows a broker every request. So the row it
returned was RLS working correctly, read as RLS being bypassed, and the wrong
conclusion then propagated into two migration files, a PR body and three Codex
threads before anything caught it.
**The lesson is not about this harness.** It is that a probe's INPUT needs
checking as carefully as its output: the uid was never verified to belong to
nobody, and `select id, role from profiles` would have settled it in one call.
Same family as the `.k-h1` assertion and the concatenated-migrations scan — a
measurement that cannot mean what it is taken to mean.

⚠️ **What it still cannot do:** run a real PostgREST request or invoke a deployed
Edge Function, so anything about HTTP status codes, PostgREST's
return-representation behaviour or gateway `verify_jwt` handling is still
unmeasurable from here. And `session_user` is `postgres`, so a statement run
WITHOUT `set local role` bypasses RLS entirely — which is the service-role
false-pass trap this file records elsewhere, one `set` away.

⚠️ **A DELETE CANNOT BE RUN THROUGH THE MCP EITHER (measured twice, 2026-10-13).**
`delete from public.enhancement_requests where id = …` hangs 60s and applies
nothing, the same signature this file records for `DROP POLICY`/`DROP TABLE`; the
earlier finding was written as a DDL constraint and does not cover DML. Verified
by re-reading the table after each attempt — the row was still there both times.

⚠️ **AND SO DOES A TOP-LEVEL `UPDATE` WITH NO `WHERE` CLAUSE (measured
2026-10-14).** Found running the `help_settings` probes, and it is a trap because
a timed-out probe is indistinguishable from a probe whose denial never fired.
Measured as a pair, one trial each, on the identical statement:

| statement | result |
|---|---|
| `update public.help_settings set updated_by = null;` | **60s timeout, nothing applied** |
| `update public.help_settings set updated_by = null where id;` | **instant 42501** |
| `with upd as (update … returning …) select …` | **instant, applied** |

So add a `where` to every probe UPDATE, or wrap it in a CTE. Recorded as one
trial each rather than as a general law: the DIFFERENCE is the `where`, and that
is as far as two observations reach.

✅ **BUT `begin; … rollback;` IS HONOURED, and that is the technique for a write
probe from a session.** Measured the same day: a client insert inside an explicit
transaction was visible inside it (count 3) and gone after it (count 2). So a
probe that needs to write should be wrapped in a rolled-back transaction rather
than insert-then-delete — which is what should have been done the first time.
⚠️ It does not help retrospectively: a committed row cannot be rolled back, so
one throwaway probe row is outstanding and needs one line from the owner (see
`migrations/20261013014854_enhancement_requests_insert_column_scope.sql`).

### ✅ HOW TO READ THE EDGE FUNCTION LOGS FROM A SESSION (measured 2026-10-14)

This file tells a reader to "read the function logs — the `where` field names the
stage" in four separate places and has never once said **how**, which on an
HTTPS-egress-blocked session reads as advice for somebody else. It is doable, and
these are the parts that are not guessable:

- the tool is `mcp__Supabase__query_logs`, and it takes **ClickHouse SQL**, not a
  service name. A `service:` parameter is rejected by its schema.
- there is **one** table, `logs`, filtered by `source` — **not** `edge_logs` or
  `function_logs` as tables. Querying those by name returns
  `Table "edge_logs" does not exist.`, which reads like a permissions problem and
  is a naming one.
- the window **defaults to the last 24 hours and is capped at 24**, so anything
  older is simply unreachable from here. Pass
  `iso_timestamp_start`/`iso_timestamp_end` for a narrower one.
- `select distinct source from logs` enumerates what this project has. Measured:
  `edge_logs` (HTTP requests through the gateway), `function_logs` (an Edge
  Function's own stdout/stderr **plus** platform `booted`/`shutdown`),
  `function_edge_logs`, `postgres_logs`, `postgrest_logs`, `auth_logs`,
  `auth_audit_logs`, `pgbouncer_logs`, `storage_logs`, `realtime_logs`.

⚠️ **RETRACTED THE SAME DAY IT WAS WRITTEN — THE PREVIOUS VERSION OF THIS BLOCK
WAS WRONG, AND IT WAS WRONG IN THE DIRECTION THAT SUPPRESSES A CHECK.** It said:
*"a function's own PostgREST calls do **not** appear … so the logs cannot tell
you whether a server-side read succeeded"*, and concluded that the tier proof
could only ever rest on the fallback-chain argument. **They do appear.** Measured
2026-10-14 at 15:41, hours after that paragraph merged:

```
GET | 200 | …/rest/v1/help_settings?select=model
  | Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.77.0; ref=bdsegmjcgfmgzuxwiplj)
```

That is `storedModel()`'s own `admin.from("help_settings").select("model")`, in
`edge_logs`, with a status code. The function's `entities`, `assets`, `policies`
and `help_queries` traffic is all there too, on the same user agent.

**The discriminator nobody had looked for is the USER AGENT**, and it is what the
original measurement missed:

| caller | user agent in `edge_logs` |
|---|---|
| the browser | `Mozilla/5.0 (X11; CrOS …) Chrome/154…` |
| the Edge Function | `Deno/2.1.4 (variant; SupabaseEdgeRuntime/1.77.0; ref=<project>)` |

⚠️ **AND THE SOURCE SPLIT IS NOT WHAT THIS SECTION SAID EITHER.** The paragraph
below used to claim `edge_logs` carries the `/functions/v1/help-ask` requests. It
does not — measured, a `source = 'edge_logs'` filter on that path returns **zero
rows**. The split is:

| source | what is in it |
|---|---|
| `function_edge_logs` | **inbound** invocations of the function (`POST\|200`, `OPTIONS\|200`, `POST\|401`) |
| `edge_logs` | **PostgREST** traffic — the browser's and the function's alike, told apart by user agent |

So a query filtered to one source and keyed on the path silently answers about
half the system. Drop the `source` filter when you do not yet know which half you
are in; `select source, …` and let the rows say.

**What this unlocks, and it is the reason the retraction matters more than the
two factual errors:** a server-side read's success is **directly observable**.
The previous version told a reader to stop looking, on the strength of one
negative result, and then correctly noted that reasoning from an absent log line
needs a positive control it did not have — while the positive control was one
unfiltered query away. *An absence measured through the wrong filter is not an
absence.* Same family as this file's own "no webkit in the image" directory
listing and the auth-gate window.

**It closes the tier proof a second way, independently of the Sonnet argument.**
The chain, read off `edge_logs` + `function_edge_logs` for 2026-10-14:

| time | event | source |
|---|---|---|
| 14:22:58 | `PATCH\|200` on `help_settings` (Chrome UA) — the broker stores Sonnet | `edge_logs` |
| 14:24:01 | **`GET\|200` on `help_settings?select=model` (Deno UA)** — the function reads the row | `edge_logs` |
| 14:24:04 | `POST\|200` on `/functions/v1/help-ask` — the answer that read "Answered by Sonnet." | `function_edge_logs` |

The Sonnet test proved the value could only have come from the row *by
elimination*; this shows the read itself, 200, 63s after the write and 3s before
the answer. Two independent closures of a claim this file had already had to
narrow twice.

⚠️ What is still NOT established is the `function_logs` half: every row there in
the window is a platform `booted`/`shutdown` message, so nothing yet shows that
channel carries a handler's own `console.error`. The `where` field this file
tells readers to go and read remains unproven as *reachable* — which is a
narrower and more honest version of what the retracted paragraph was groping at.

⚠️ **`function_edge_logs` DROPS INBOUND REQUEST ROWS — MEASURED 2026-10-14
17:35, AND IT FALSIFIES THE SENTENCE BELOW.** That sentence said the two sources
give **every** `help-ask` request with method and status. They do not. The
heading is scoped to **inbound request logs** on purpose — see consequence 2 for
the extrapolation this section originally made and should not have.

`functions-deploy.yml`'s smoke step exits 1 on any status other than 401
(`case "$code" in 401) ;; *) exit 1`). On run `38607811541` it reported
**success** at 17:35:13. So an unauthenticated POST was made and the gateway
answered 401. **There is no row for it** — not in `function_edge_logs`, not in
`edge_logs`, not in any source, across a two-minute window queried with no
`source` filter. Its `OPTIONS` at 17:35:08 *is* there, and so is the worker's
`booted (time: 65ms)` in `function_logs`.

⚠️ **ON INGESTION LAG, PRECISELY.** The first version of this said "re-queried
three minutes later … so not ingestion lag", which rules out a delay of under
three minutes and nothing more (Codex, #266). Re-queried again at **17:50, ~15
minutes after the fact**: still absent, same two-minute window, same no-filter
query. So the bound is **15 minutes, not 3** — and Supabase publishes no
ingestion-latency SLA that this repo has read, so **"dropped" is the best
explanation, not a proved one.** The claim that survives either way is the
operationally useful one: *the row was absent 15 minutes after a request that
provably happened*, so a reader must not treat these logs as complete.

And the comparison is like-for-like: the other three deploys today
(**15:37:18, 14:21:37, 01:57:02**) each have their smoke `POST | 401` present.
Three of four. The same run's `qa-live` then shows **five `OPTIONS` and three
`POST`s** where S10 asserts exactly one ask per project across four projects —
consistent with the same loss rather than a missing ask.

**Three consequences, and the second is the one that bites:**

1. **A missing row is not a missing request.** Do not conclude from these logs
   that something did not happen.
2. ⚠️ **IT DOES *NOT* WEAKEN THE `where: "answer"` CONTROL — AND THE FIRST
   VERSION OF THIS BULLET SAID IT DID, WRONGLY.** It read: "a missing line is
   also consistent with the row being dropped — so the control … can no longer
   condemn it". **That extrapolates loss across two different pipelines.** The
   positive control above is an **inbound request** row, which this very section
   places in `function_edge_logs`; `where: "answer"` is **handler stderr**, which
   belongs to `function_logs`. Nothing measured here shows a handler-emitted
   `function_logs` row being dropped — and the one `function_logs` row in the
   window (`booted (time: 65ms)` at 17:35:08) was present, from the same second
   as the missing inbound row. So the caveat is **scoped to inbound request
   logs**, and the channel check below stands at full strength until loss is
   observed in `function_logs` itself. Found by Codex on #266, and it is the
   sharpest finding of the three: by over-generalising one measurement I had
   undermined the only working check I had, on evidence that did not apply to
   it. **Weakening a valid check with irrelevant evidence is a worse outcome
   than the overclaim it was trying to correct.**
3. **Do not count requests from these logs** — and ⚠️ **`--list` is not a cost
   instrument either, which the first version of this bullet got wrong.** It
   said the "4 paid calls per Pages deploy" figure "stands on `npx playwright
   test --list | grep -c S10` returning 4". `--list` **enumerates selected test
   instances and executes nothing**, and the handler has several pre-provider
   exits (no keys, no `profiles` row, a failed reservation, either cap, an
   unreachable corpus, a records error) — each of which costs £0. So `--list`
   bounds the number of S10 **instances** at 4; it does not establish four
   provider calls. Codex, #266.
   **What does evidence billing:** a retained `help_queries` reservation, per
   the kept-reservation note above — and because these logs drop rows, a count
   taken from them is a **floor**, not a total. State the cost as *up to 4 asks
   per Pages deploy, each of which can bill*, and read the billed count off
   retained reservations while treating it as a lower bound.

⚠️ This is the **fifth** correction to this section in one day, and every one
has been the same shape: **a claim about what the logs show, stated more
strongly than the measurement supported.** The forms it has taken so far —
the quantifier "every" (twice); an absence read through the wrong `source`
filter; a 3-minute re-query called "not lag"; loss in one pipeline extrapolated
to another; and `--list` offered as evidence of spend. ⚠️ Three of those five
were introduced **in commits written to correct the previous one**. The
generalisation is the defect, not any individual sentence, and naming it has
not yet stopped me writing it.

What it *is* good for, with that caveat: the two sources give `help-ask`
requests with method and status, which dated the deployment and the asks — `OPTIONS | 404` through 2026-10-13 18:13 (not yet deployed),
first `OPTIONS | 200` at 23:31:47, four `POST | 200` between 00:03 and 00:58
(**that is `qa-live`'s S10 on its four viewport projects — four INVOCATIONS,
which is not the same as four paid calls; see consequence 3 above**), one
`POST | 401` at 01:57:02 (`functions-deploy.yml`'s smoke probe, behaving as
designed), and the proving ask at 03:21:17.

⚠️ **A KEPT RESERVATION PROVES THE PROVIDER WAS BILLED AND NOTHING MORE. IT IS
NOT EVIDENCE THAT AN ANSWER RENDERED, and the first version of this paragraph
said it was.** `releaseAnd` deletes the `help_queries` row when nothing was
billed, so a `DELETE` is the signature of a release. The 2026-10-14 window holds
**`POST | 201` reservations and zero `DELETE`s**, each with a response **6-7s**
later against a 60s ceiling. From that, exactly one thing follows: **the provider
call was made and billed.**

⚠️ **This paragraph claimed "reservation kept AND fast is an answer". It is not,
and `handler.ts` says so in terms** — *"The reservation is NOT released on any
path below: the call was made and therefore billed, whatever came back."* Past
the billing line there are **three** paths that keep the row, return **HTTP 200**
with `answer: null`, and render FR-17's notice:

| path | trigger |
|---|---|
| `stop_reason !== "end_turn"` → `unavailable("incomplete")` | a refusal, or a `max_tokens` cut |
| `!answer` → `unavailable("incomplete")` | no text blocks |
| `!split.answer` → `unavailable("incomplete")` | a trailer-only reply |

None of them is slow, so the latency test does not separate them. And a
`max_tokens` cut is the very outcome the `max_tokens: 8192` note calls realistic
— the comment beside the check says so — so the claim was **falsified by the
failure mode it was written to detect.**

⚠️ **AND THOSE THREE PATHS ARE COMPLETELY SILENT.** `unavailable()` is
`json({ answer: null, reason, … })` with **no `console.error`**, so unlike the
provider-error path (`where: "provider"`) they leave no log line anywhere. In the
logs they are **indistinguishable from a successful answer**: same 201, same
absent DELETE, same fast 200. ⚠️ `qa-live`'s S10 does not separate them either —
it accepts an answer **or** the notice by design.

**So the logs bound the SPEND exactly and say nothing about the OUTCOME.** What
the latency still does separate is a billed **timeout** (no status, row kept,
~60s) from everything else, which is worth the query.

✅ **AND THE SILENCE IS FIXED (2026-10-14).** All three exits now log
`where: "answer"` with a `stage` that says which one fired:

| stage | fired by | carries |
|---|---|---|
| `stop_reason` | a refusal, or a `max_tokens` cut | `stopReason`, `outputTokens`, `maxTokens` |
| `no_text` | no text blocks (thinking only, or nothing) | `stopReason`, `blockTypes` |
| `trailer_only` | the model emitted protocol and no prose | `rawLength` |

`outputTokens` against `maxTokens` is the measurement the `max_tokens: 8192`
note below asks for and had no way to take: a cut AT the ceiling is the ~137
tok/s cliff, while a `refusal` at 12 tokens is a different problem. The ceiling
is now a named constant read by both the call and the log, because two copies of
a number is how one goes stale — and a log naming a ceiling the call does not use
sends a reader hunting a cliff that is not there.

⚠️ **A CAUSE, NEVER CONTENT — and this is gated structurally, not by a needle
list.** These lines are emitted from INSIDE the safety boundary, so a field added
later "to help debug" is a disclosure with no client in the loop. The test
asserts the payload's keys are **exactly** an allow-list per stage, plus a type
check on every value, so a new field fails by construction. Block **type names**
only, never `b.text` or `b.thinking`.

⚠️ **WHAT THIS STILL DOES NOT PROVE: that `function_logs` carries a handler's
`console.error` at all.** Every row in that source in the 2026-10-14 window is a
platform `booted`/`shutdown` message, because every ask that day succeeded and no
error path fired. The channel is *documented* to carry stdout/stderr and the
provider path has logged there by construction since the feature shipped — but
nothing here has observed one. **The first real billed non-answer in production
is the positive control**, and this is the query:

```sql
select cast(timestamp as datetime) as t, event_message
from logs
where source = 'function_logs' and event_message like '%"where":"answer"%'
order by timestamp desc
```

If a billed non-answer is ever visible in `edge_logs` (201, no DELETE, fast 200)
with **no** matching line here, the channel is the defect and not the handler.
Recorded this way round deliberately: the retraction above exists because an
absence was read as a fact, and this one is labelled an open question.

⚠️ The proven-channel alternative, **not** taken: a column on `help_queries`
written by the function would appear in `edge_logs`, which is measured to carry
its PostgREST traffic. It needs a migration, so it is an owner decision rather
than a bug fix, and it is the fallback if the control above comes back empty.

⚠️ Recorded because of *where* this happened: it was written in the same commit
that retracts an overclaim, in the section about not overclaiming from logs, and
it is the third instance on this branch pair. Found by Codex on #264 (P2),
verified against `handler.ts` rather than taken on the bot's word.

### ✅ DEPLOY PROVENANCE — CLOSED, AND THE DEPLOY PATH IS RESTORED (2026-10-14, both measured)

**Read the two halves separately — they are not the same claim.** The
*provenance* defect is closed (the bytes live match the repo) and the *path* is
working (a deploy can reach production). Both measured. The heading has now been
wrong in both directions — it said only "CLOSED" while the path was down, and
then said BLOCKED after it was restored — so it states both halves explicitly.

✅ **THE TOKEN WAS RESTORED 2026-10-14 AND THE PATH IS PROVEN GREEN.** Run
`38579744467`, `workflow_dispatch` on `baad788`, **all seven steps success** —
including step 7, the smoke probe, which is skipped on a failed deploy and so is
the step that proves the worker booted and resolved all three modules. Verified
from a session afterwards rather than taken from the green tick:

| check | result |
|---|---|
| function version | **2 → 3**, `verify_jwt: true`, ACTIVE |
| `entrypoint_path` | `/home/runner/work/…` — the RUNNER'S checkout |
| `index.ts` / `handler.ts` / `prompt.ts` | **all three byte-identical to the repo** (sha256) |
| comment lines | **935** (79 + 587 + 269), intact |

✅ **AND ON 2026-10-14 IT CARRIED A BEHAVIOUR CHANGE FOR THE FIRST TIME** — every
prior green run deployed bytes that differed from production only in comments, so
"the path works" had never been tested against a change that could break
anything. `6b510a1` (the model-visibility change) merged, `Deploy Edge Functions`
went green unattended, and the result was verified by hash rather than by the
tick: **version 3 → 4**, ACTIVE, `verify_jwt: true`, `entrypoint_path` under
`/home/runner/work/…`, and all three modules byte-identical to the repo
(`index.ts` `ba21d49f53714a95`, `handler.ts` `913ad1226458dbd5`, `prompt.ts`
`92f13c9868b5ada8`), 1,040 comment lines intact. `qa-live` then asked four real
questions against it, all four returning `POST | 200` with the reservation kept
— i.e. **four billed provider calls**. ⚠️ That is a spend measurement, NOT four
answers: the three `incomplete` exits also return 200 with the row kept and no
log line. See the kept-reservation note above.


✅ **AND THIS IS THE CONTROLLED EXPERIMENT THE RED RUN WAS NOT.** The section
below was careful to say the failure only *corroborated* the revoked-token
hypothesis, because the comment-only diff ruled out a workflow-logic change and
nothing else — not the runner image, not network egress, not Supabase's service
state. This run settles it: **same commit** (`baad788`), same workflow, same
runner image, **one variable changed** (the secret), red → green. That is a
stronger proof than the CLI error text would have been, because it tests the
hypothesis instead of reading an error message's own account of itself — which
is exactly what the paragraph below predicted when it named the restore as the
better evidence.

⚠️ **The token is scoped, and the review screen stated the scope better than
this file could promise.** Expiry Never, Resource access Project → `insurance`,
one capability: **Edge Functions read-write**. Supabase's own review step
enumerated what that grants — `deploy_edge_function`, `get_edge_function`,
`list_edge_functions`, `confirm_cost`, `search_docs` — i.e. **no database
access and no secrets access**. `Edge Function Secrets` (HIGH RISK) is None, so
a CI token cannot read `ANTHROPIC_API_KEY`; code it deploys still runs with
access to that key at runtime, which is a different thing and is not closed by
scoping the token.

⚠️ **AND THE URGENCY IN THE SECTION BELOW WAS OVERSTATED, which is worth more
than the fix.** It said production "cannot receive a fix" — true of the PATH and
misleading about the STATE. Measured when the owner questioned it: every
undeployed line in `help-ask/` and `config.toml` was **a comment or blank**, zero
behavioural change, so production's behaviour was identical to `main` the whole
time. What was actually waiting was stale comments. The owner also correctly
pointed out that the token was never required to DEPLOY at all —
`mcp__Supabase__deploy_edge_function` works from a session and is how `help-ask`
first shipped; the token buys "deployed == repo **by construction**", not the
ability to deploy. Overstating urgency is the same defect class as understating
it, and this file does both.

⚠️ **This heading said "is NOT byte-equal" and that is no longer true.** Kept,
heading and all, because the defect and the way it was closed are both worth
reading — but a reader must not take the sections below as current.

**Measured 2026-10-14 after the first run of `functions-deploy.yml`** (run
`38498409976`, `workflow_dispatch`, all seven steps green), by fetching the
deployed source and hashing it against the working tree at `86aae05`:

| file | deployed sha256 | repo sha256 | match |
|---|---|---|---|
| `index.ts` | `091c9f3685791bc9…` | `091c9f3685791bc9…` | ✅ |
| `handler.ts` | `171fed205113eb71…` | `171fed205113eb71…` | ✅ |
| `prompt.ts` | `92f13c9868b5ada8…` | `92f13c9868b5ada8…` | ✅ |

Function **version 2**, `verify_jwt: true`, and `entrypoint_path` reads
`/home/runner/work/claude.insurance/…` — i.e. deployed from the RUNNER'S
CHECKOUT, not retyped into a tool call. The comments are back: **1,027 comment
lines** across the three modules (78 + 632 + 317) where the stripped copy had
none. "Deployed == repo" now holds by construction rather than by anyone's care,
which was the whole point.

⛔ **AND THE TOKEN THAT DID IT NO LONGER EXISTS — SO THE DEPLOY PATH IS DOWN
UNTIL THE OWNER REPLACES IT.** The owner rotated and then deleted both access
tokens, so `SUPABASE_ACCESS_TOKEN` in GitHub holds a **revoked** value.

⚠️ **THIS PARAGRAPH USED TO OPEN "Nothing is broken", AND THAT WAS THE WRONG
READING** (Codex, #260). The already-deployed function is indeed live and
unaffected — but the *path* is what this section exists to be about, and the path
is broken in three ways worth naming rather than filing as a to-do:

1. **Production cannot receive a fix.** Every push touching
   `supabase/functions/help-ask/**`, `supabase/config.toml` or the workflow
   itself passes the non-empty gate and then **fails at `supabase functions
   deploy`**. An urgent change to `prompt.ts` — the module that defines what
   client data crosses the Anthropic boundary — cannot reach production today.
2. **It recreates the divergence this section declares closed.** "Deployed ==
   repo" holds *by construction* only while the construction runs. With the
   deploy failing, every merge to `main` widens the gap between the live function
   and the repo again, which is precisely the defect the workflow was written to
   end.
3. **It fails loudly, which is the one piece of good news.** A red run is not the
   FR-17 quiet notice: the failure is visible in Actions rather than
   indistinguishable from a working deploy. That bounds the harm; it does not
   remove it.

⚠️ It will NOT fail at the `Require SUPABASE_ACCESS_TOKEN` gate, which only
checks the secret is non-empty: a revoked token is non-empty. That is the
`hasKeys` lesson on a third surface — **present is not valid**. Tightening that
gate to prove the token *works* is not free either (it costs an API call per run
and an auth probe is a credential the gate would then need), so the honest fix is
the credential, not a cleverer gate.

✅ **AND IT IS NO LONGER A PREDICTION — MEASURED ON THE VERY NEXT MERGE, 2026-10-14.**
Run `38508387852` on `8e03068`, which is the merge of the commit that wrote the
paragraph above. The step ladder is exactly the shape predicted, which is what
makes it worth recording rather than just red:

| step | result |
|---|---|
| 3. Is a newer deploy run already queued? | success |
| 4. **Require SUPABASE_ACCESS_TOKEN** | **success** — the revoked token passes the non-empty gate, as predicted |
| 5. setup-cli | success |
| 6. **Deploy help-ask** | **failure**, exit 1 |
| 7. Smoke — the worker boots, and the gateway gates it | skipped, correctly (gated on the deploy) |

**This CORROBORATES the prediction; it does not measure the cause.** Run
`38498409976` on `86aae05` was **green** at 01:56:37Z, and the only change to
this workflow between the two is **19 added and 6 removed COMMENT lines** — so a
change in the workflow's own logic is ruled OUT, and the observed failure is
*consistent with* the known revocation. That is all it is.

⚠️ **AN EARLIER VERSION OF THIS PARAGRAPH CALLED THE ATTRIBUTION "CONTROLLED",
AND THAT WAS THE OVERCLAIM — in the section written to replace a prediction with
a measurement, which is this file's most-repeated defect arriving one layer out
again.** Codex, #261 round 2, answering a question put to it directly. The diff
controls the workflow logic and **nothing else that feeds the deploy step**: the
runner image, network egress, and Supabase's own service state are all
uncontrolled, and an `exit 1` with no error text does not distinguish between
them. One alternative explanation eliminated is not a cause established.

✅ **WHAT WOULD SETTLE IT, and it is already on the owner list:** the CLI's error
text — unobtainable from a session, the logs endpoint redirects to blob storage
this `gh` will not contact and says in terms that no flag changes that — **or,
better, the restore itself.** Replacing the token with nothing else changed and
watching this step go green is a cleaner proof than the log would be, because it
tests the hypothesis rather than reading an error message. So the restore step
below doubles as the measurement; until it runs, read this section as
"predicted, then observed to fail at the predicted step", not as "proven to be
the token".

⚠️ **BOTH ENDPOINTS ARE PINNED TO COMMITS, and the first version of this used
`origin/main`** — Codex, #261. `git diff 86aae05 origin/main -- …` reproduced
19/6 on the day it was written and stops doing so the moment `main` takes another
workflow edit; it would then show **executable** changes and suggest the code
differed between the green run and the red one, which is the attribution this
paragraph exists to establish. A moving endpoint in a historical measurement
drifts in the unsafe direction. The command is:

```
git diff --stat 86aae05 8e03068 -- .github/workflows/functions-deploy.yml
```

Those are the two runs' own `head_sha`s — `38498409976` ran on `86aae05`
(success) and `38508387852` on `8e03068` (failure), both read back from the runs
API rather than assumed — so the diff is between exactly the two files that
executed, for good. ⚠️ The raw job log is
not readable from a session — the logs endpoint redirects to blob storage this
`gh` will not contact, and it says in terms that no flag changes that — so what
there is to go on is the step ladder plus that diff, which together narrow the
cause without isolating it. See the qualification above.

⚠️ **AND IT FIRED ON A COMMENT-ONLY EDIT, which the path filter's own comment
says it is trying to avoid** (*"A README or CLAUDE.md edit must not redeploy a
live endpoint"*). The merge touched only `CLAUDE.md` and this workflow's header
comments — but the workflow is in its **own** path filter, and a path filter
cannot tell a comment from logic. Deliberately not changed: firing is the SAFE
direction (with a working token it would have redeployed identical bytes and kept
"deployed == repo" true), and the alternative — dropping the workflow from its
own filter — means a real change to the deploy logic does not re-run the deploy.
Expect a deploy run on any edit to this file, comments included.

✅ **TO RESTORE — one owner action, two minutes:** a new Supabase access token
(Expiry **Never**, Resource access **Project → `insurance`**, permissions
**Edge Functions: Read-write** and nothing else — notably NOT Edge Function
Secrets), pasted over the `SUPABASE_ACCESS_TOKEN` repository secret, then one
`workflow_dispatch` of `functions-deploy.yml` to confirm green. Until that is
done, treat **any** merged change under `supabase/functions/help-ask/` as *not in
production*, whatever this file says about the code.

⚠️ **A SUPABASE PAT IS NO LONGER NECESSARILY ACCOUNT-WIDE**, and this file and
`functions-deploy.yml` both said it was. Measured in the dashboard 2026-10-14:
token creation now offers **Resource access** (Project / Organization) and
per-capability permissions. The token used here was scoped to the `insurance`
project with **Edge Functions: read-write** and nothing else — notably NOT
`Edge Function Secrets` (HIGH RISK), so a CI token cannot read
`ANTHROPIC_API_KEY`, though code it deploys still runs with access to it. That
weakens, but does not remove, the "split into per-project accounts" item under
*Shared Supabase account*: the MCP credential is a separate path and is not a
PAT (the token list was EMPTY before this one was created).
⚠️ **Access cannot be changed after creation** — widening means a new token.

---

**What the defect was, and why it is kept below.** `help-ask` was deployed and
working. **The deployed source was the repo's code with every comment block
removed**, and that was a defect to close, not a style choice.

**How it happened.** `mcp__Supabase__deploy_edge_function` takes file CONTENT
inline — there is no path parameter — so deploying from a session means
re-emitting the three modules (96KB) into one tool call. Two attempts went out
carrying only `index.ts` and were refused by the bundler (fail-closed, nothing
deployed). The third fitted only because the comments were stripped.

**This is the risk owner-gate step 6 named, arriving by a different route than it
predicted.** The gate worried about a single-character corruption in `prompt.ts`
— the module that defines what client data crosses the Anthropic boundary —
being indistinguishable from an undeployed function, because FR-17 renders every
failure as the same quiet notice. What actually happened is not corruption but
divergence: the live function no longer carries the reasoning that makes it
reviewable, and nobody can diff live against `main`.

**What was verified, and what was not:**

| claim | status |
|---|---|
| the function is ACTIVE, `verify_jwt: true` | **verified** (`get_edge_function`) |
| stripping comments does not change behaviour | **verified** — 96 behavioural tests (`handler.test.mjs`, `prompt.node.test.mjs`) pass against a mechanically comment-stripped copy |
| one real client ask returns a correct grounded answer | **verified** — owner-gate step 8 |
| deployed bytes == repo bytes | **was FALSE and known to be false; now TRUE, measured — see the top of this section** |
| hand-stripped == mechanically-stripped, byte for byte | **not checked** |

**The fix is `.github/workflows/functions-deploy.yml`**, added in the same change:
it runs `supabase functions deploy help-ask` from the checkout, so the uploaded
files are the repo's files and "deployed == repo" holds by construction instead
of by anyone's care. It needs one repository secret, `SUPABASE_ACCESS_TOKEN`.
✅ That secret was added and the workflow ran on 2026-10-14; the live function is
no longer the stripped copy.
⚠️ It deploys a **named matrix**, never "everything" — a bare `supabase functions
deploy` pushes every directory under `supabase/functions/`, so a new function
would go live the moment it merged with no decision taken. It carried `help-ask`
alone until 2026-10-14, while `notify-enhancement`'s claim table was unapplied;
that condition is met and it is now a second row.

### ⚠️ AN ABSENT `[functions.*]` BLOCK DOES NOT APPLY THE DEFAULT — IT PRESERVES WHAT IS LIVE (measured 2026-10-14)

Both `config.toml` and `functions-deploy.yml` asserted, at length, that carrying
**no** `[functions.<slug>]` block means *"the CLI applies the default
(`verify_jwt = true`)"*. **It does not.** An absent block sends nothing, and the
platform keeps whatever the function already had.

Measured on the first run that deployed `notify-enhancement`: the deploy
**succeeded** and uploaded the repo's source (version 3, `entrypoint_path` under
`/home/runner/work/…`) — and the function stayed **`verify_jwt: false`**, which
is what it had been since its old inline tool-call deploy. `function_edge_logs`
shows `OPTIONS | 200` then `POST | 401`, and `list_edge_functions` still reported
`false` afterwards.

⚠️ **`help-ask` is why nobody noticed.** It was ALREADY `true`, so "preserve the
existing value" and "apply the default" are observationally identical on it —
the two readings only separate on a function whose flag is already `false`, and
until that day there was none in the matrix. *A default you have never seen
applied to a non-default value is an assumption, not a measurement.*

✅ **The smoke step caught it, which is the whole reason it was redesigned.** An
unauthenticated POST reached the **handler**, which answered its own
`{"error":"unauthorized"}` — precisely what probe 2 exists to detect. The
single-401 check it replaced in PR #258 would have gone **green** on a function
accepting unauthenticated requests.

**Fixed by pinning `verify_jwt = true` EXPLICITLY for both functions.** ⚠️ That
is not a reversal of the long argument at the top of `config.toml`: that argument
is against pinning `verify_jwt = **false**`, which was wrong on its merits and
still is. Pinning **true** is its opposite — it states the intended end state
instead of inheriting whatever is live, so a function that somehow acquires
`false` is corrected by the next deploy rather than keeping it indefinitely.
**An inherited default is not a decision.**

⚠️ **AND IT SHIPPED WITH THREE DEFECTS, ALL FOUND BY A REVIEW THAT LANDED AFTER
THE MERGE** (Codex on #258, completed 00:03:24Z against a PR merged at
00:00:33Z — a 3-minute window that no merge gate covers). All three were real
and all three are fixed on the next branch; recorded because the second is a
standard this file *already holds* and the third is an overclaiming comment,
which is this repo's most repeated defect:

| # | what shipped | why it was wrong |
|---|---|---|
| 1 | path filter omitted `supabase/config.toml` | the CLI reads it for `verify_jwt`, import maps and entrypoints, so a config-only change would merge and leave production on the old configuration. Invisible *because* this repo deliberately carries no `[functions.help-ask]` block — there is nothing there to change yet |
| 2 | `concurrency` group and nothing else | **a group serializes, it does not ORDER.** GitHub gives no FIFO guarantee for queued runs, so with two pushes close together an older run can execute second and upload older code. This file already records that exact lesson for `pages-retry.yml`, and the new workflow did not carry it over |
| 3 | one unauthenticated POST, asserting a 401 | it proved **neither** half of what its comment claimed |

**Finding 3 is the instructive one.** The comment said a 401 proves "the route
exists and is JWT-gated". Measured against six local fakes, the old check:

| scenario | old | new |
|---|---|---|
| healthy and gated | pass | pass |
| **worker fails to boot** (gateway 401 on the POST, 503 on the preflight) | **PASSED** | fail |
| **`verify_jwt` OFF** (handler.ts answers the same 401 itself) | **PASSED** | fail |
| not deployed (404) | fail | fail |
| gateway refuses the preflight | passed | fail |
| preflight body not `ok` | passed | fail |

So an import error in `prompt.ts` — the module that defines what client data
crosses the Anthropic boundary — shipped green. That is the exact catastrophe the
workflow exists to prevent.

**The fix is two probes, one that must REACH the function and one that must
not.** `OPTIONS` is answered by `handler.ts` with the literal body `ok`, and the
gateway forwards a preflight, so that body proves the worker booted and resolved
all three modules; an unauthenticated `POST` must come back 401 **whose body is
not** `{"error":"unauthorized"}`, because that shape is the handler's own and
finding it there means `verify_jwt` is off. Neither probe sends a question, so
neither is billable.
⚠️ **No response HEADER is asserted, deliberately.** An `x-deno-execution-id`
check would be the obvious way to tell gateway from worker, and it would be
guessing at a name no session here can verify — HTTPS egress to the project is
blocked. The body shapes are read off source.

⚠️ **AND PROBE 2'S REQUEST BODY IS LOAD-BEARING, WHICH NOTHING SAID UNTIL
2026-10-14.** It must be a payload **the handler would accept**. Measured from
source when `notify-enhancement` was added to this workflow: **both** handlers
parse and VALIDATE the body **before** they read the `Authorization` header —
`help-ask`'s `handler.ts` parses at 478 and rejects an empty/oversized question
at 481-483, then checks auth at 486; `notify-enhancement`'s `index.ts` parses at
447 and rejects a missing `requestId` or bad `event` at 450, then checks auth at
456. Probe 2 detects *"`verify_jwt` is OFF"* by finding the handler's **own**
`{"error":"unauthorized"}` — which the handler only ever reaches if the body got
**past validation**. A generic `{}` returns `400 bad_request` instead, the
`case` reports *"Unexpected 400"*, and the real cause — every unauthenticated
request reaching the worker — is never named.
So `help-ask`'s `{"question":"ping"}` was never arbitrary, and copying the step
for a second function with the same body would have silently degraded the one
check it exists for. The matrix now carries a `probe` per function and says why.
⚠️ With `verify_jwt` ON — the expected state — neither body reaches the worker,
so neither is billable and neither can create anything; the all-zeros
`requestId` is belt for the case where it does, since it matches no row and so
cannot take a notification claim. Same reasoning as the claim migration's probe
2b, and the same rule as that migration's footer: **a probe for a suppression
bug must not be able to suppress.**

**Finding 2's fix asks whether a SUCCESSOR DEPLOY RUN EXISTS**, via the runs API
on this workflow's own file name. `workflow_dispatch` is exempt (the manual
escape hatch), and an API failure PROCEEDS — the stale overwrite then needs a
double failure whose recovery is one dispatch, which is `pages-retry.yml`'s
direction for the same reason.

⚠️ **AND THE FIRST VERSION OF THAT FIX WAS A P1, found by asking for the review
BEFORE merging rather than after.** It compared SHAs against `main`'s absolute
head, on the stated reasoning that "this workflow fires on every qualifying push,
so a superseded run always has a newer run behind it". **That is true only of
commits touching the watched PATHS, and `main`'s head need not be one.** Push a
function change, then push a CLAUDE.md edit: the second fires nothing while
making the first look stale, so the first SKIPS and the function change sits
undeployed until a manual dispatch. Two changes in the same commit — tightening
the path filter (finding 1) and adding this check — producing a hole neither had
alone. The error was in the reasoning, not the code.

The runs API has no second copy of the path list to drift, which is why it is
the right question: a run of this workflow exists exactly when a qualifying push
or a dispatch happened, so the filter is consulted by construction.
⚠️ **Keyed on the workflow's FILE NAME, which is not the `pages-retry.yml`
trap.** That one is about a workflow's two DISPLAY names
(`pages-build-deployment` in the workflows API vs `pages build and deployment`
in the runs API), where the wrong one silently matches nothing. A file name is a
documented exact identifier, and it is this file.

**Measured against a stubbed `gh`, six cases:** newest run == mine → proceed
(this is the P1 scenario: a docs-only push creates no run, so nothing supersedes
me); newest > mine → skip with a notice; API failure → proceed with a warning;
`workflow_dispatch` → exempt; and the two unreachable cases (newest < mine, no
runs at all) proceed, correctly.

✅ **THE CHANGE THAT WAS WAITING ON IT HAS SHIPPED — and this paragraph claimed
otherwise for a commit.** It read: *"The LIVE function predates that, so it reads
only `HELP_MODEL` — the Security page's switch stores a tier nothing consumes
until `SUPABASE_ACCESS_TOKEN` exists and one push to `main` has run this
workflow … the broker-only `.k-help__tier` readout … stays absent while the old
deploy is live."* True when written and false a few hours later, in the same
session, which is the staleness this file keeps paying for.

What settles it: the readout **is not absent**. `edge_logs` dates the deploy's
own smoke probe to 01:57:02 and the proving ask to 03:21:17, and that ask
returned a `.k-help__tier` line — a field the pre-change build has no code to
send. So the live function is the post-change one and it does consult the row.
⚠️ **`.k-help__tier` NO LONGER EXISTS**: the model moved into `.k-help__ai` for
every caller later the same day. The measurement above stands as taken; the
selector does not, and a reader must not go looking for that element today.
⚠️ Note the narrower reading above: that proves the deployed build READS a tier
and gates the field on role; it does not by itself prove the value came from the
row rather than from `HELP_MODEL`. The paragraph's own standard — the readout is
the only proof — was right about the instrument and too generous about what it
measures.

**The generalisable rule:** when a deploy path requires a human or a model to
retype the artifact, the artifact will eventually differ from its source — and
the difference will be invisible, because what is deployed is not what is read.
Prefer a path that uploads the file. If none exists, that is a gap in the
tooling, not a thing to be careful about.

### ✅ RESOLVED 2026-10-14 — `policies.status` was read by NOTHING in the UI

Surfaced by the Help desk's first real answer, which is the useful part: two
readers of the same table gave a client two different answers in one session.

Measured on the live project:

| policy | `status` | `renewal_date` | the Policies screen says |
|---|---|---|---|
| Windstorm | `active` | 2026-06-01 (past) | **Expired Jun 1** |
| Flood (NFIP) | `active` | 2026-07-06 (past) | **Expired Jul 6** |
| BOP | `active` | 2026-09-20 (past) | **Expired Sep 20** |

All seven rows carry `status = 'active'`. The Keep's screens compute lapsed/
expiring from `renewal_date` and never read `status`; `help-ask` sends both and
the prompt requires an affirmative `status` before calling a policy active. So
the home page says "3 Lapsed, action needed" while the desk says "all seven are
marked active", from one database.

**The desk is not the defect.** The prompt's `status`-first rule was added
deliberately on 2026-10-09 so that a future renewal date could not be read as
proof of cover, and it worked: the answer stated what `status` says and then
flagged that three renewal dates have passed and *"your records don't show
whether those policies were renewed or whether the dates just haven't been
updated."*

**This is the "one canonical label, one shared module" rule violated one layer
below where that rule is usually enforced** — not two views disagreeing about a
label, but two readers disagreeing about a FACT.

⚠️ **AND BOTH OF THE OPTIONS THIS SECTION ORIGINALLY OFFERED WERE WRONG.** It
said the fix was a product decision between "`status` is the system of record, so
the badge must derive from it" and "the badge's derivation is authoritative and
`status` is decoration that should be dropped". Two measurements, neither taken
when that sentence was written, kill both:

| measurement | kills |
|---|---|
| `select status, count(*) from policies group by status` → **one row: `active`, 7 of 7** | option A. A column with one value that was never updated when three policies passed their renewal date is not a system of record. Deriving the badge from it would have **suppressed** the true "3 Lapsed, action needed" signal |
| `grep -rn "policy.status" js/keep/` → **zero consumers** | option B. `status` is not decoration being over-trusted; it is **loaded by the adapter, carried on every policy object, and read by nothing**. And dropping it from the prompt would reinstate the exact defect `status` was added to the digest to fix on 2026-10-09 |

**The real defect is that the two were never contradicting each other.** The desk
reported `status`; the badge reported `renewal_date`; each presented its own half
as the whole answer. They answer different questions and a policy is in force
only when **both** say so — which is precisely what `help-ask`'s prompt has said
since 2026-10-09 (*"active ONLY IF status says so AND cover has started; a
renewal date in the future does NOT mean a policy is active"*). The desk was
right and the UI was structurally unable to be: `policyKind(renewalInDays)` took
a date and nothing else, so **no Keep screen could see a cancelled policy**, and
one whose renewal date had not yet passed rendered **"Active · renews <date>"**.

**Fixed by giving the UI the inputs the desk already had.** `policyKind` now
takes the POLICY (`js/keep/logic/policies.js`), applies the prompt's precedence —
status, then cover start, then renewal date — and gains three kinds: `nostatus`,
`ended`, `pending`. `renewalCounts` takes policies and puts all three in
`undated`, so unclear data is never counted as in force. All three columns are
nullable with no default and no CHECK (measured), so every branch is reachable.

⚠️ **NO BEHAVIOUR CHANGES ON CURRENT DATA, and that is the point.** All 7 live
policies are `active`, so every badge renders exactly as before and the home page
still says "3 Lapsed, action needed" — which is **true and actionable**. Seeding
more careful demo data would have hidden the question; so would making the badge
agree with a column nobody maintains.

✅ **AND THE DATA QUESTION IS CLOSED (2026-10-14) — IT WAS NEITHER OF THE TWO
ANSWERS I OFFERED.** This read: *"three policies carry `status = 'active'` with a
renewal date months past. Were they renewed and the row not updated, or did cover
end? The code cannot answer that."* Both options were wrong, and one query
settled it: **the live demo data had ROTTED, and `status` was never the problem.**

Measured: all seven policies were seeded **2026-06-24** with absolute one-year
terms. Computing their position *on that date* against
`js/keep/fixtures/sample.mjs`:

| line | fixture `renewalInDays` | live renewal on the seed date |
|---|---|---|
| Homeowners (HO-3) | 263 | 2027-03-14 → **+263** |
| Scheduled personal property | 205 | 2027-01-15 → **+205** |
| Personal auto | 140 | 2026-11-11 → **+140** |
| Commercial auto | 120 | 2026-10-22 → **+120** |
| BOP | 88 | 2026-09-20 → **+88** |
| Flood (NFIP) | 12 | 2026-07-06 → **+12** |
| Windstorm | −23 | 2026-06-01 → **−23** |

Exact, all seven. So **the fixture is a RELATIVE snapshot of this very seed**, and
the designed demo is **1 lapsed · 1 expiring in 12 days · 5 active** — which is
also what `policies.test.mjs` pins (`ho3-marina` ok, `flood-marina` warn,
`wind-marina` exp). The fixture never rotted because it stores offsets; the live
table did, by **112 days**, turning the demo into **3 lapsed · 1 expiring · 3
active** with nobody deciding that.

**This is the S28 defect one layer out** — absolute dates standing in for a
*relative* state — found by Codex in the Playwright harness on the same day and
present all along in the live seed. ⚠️ Note which way round the two sources were:
the Node fixture was **right**, and production had drifted from it.

**Fixed by re-basing the live rows onto `current_date` using the fixture's own
offsets** (`effective_date = current_date + eff_off`, same for renewal), so the
database now agrees with the artefact the unit tests already check. ⚠️ **`status`
was not touched, and must not be:** all seven genuinely are active, and the one
remaining policy whose renewal date has passed (Windstorm, −23) is the demo's
deliberate *"1 Lapsed, action needed"* call to action — a realistic state, since
a renewal the broker has not yet processed is exactly when a client needs to act.
Both readers are honest about it: the badge says `Expired <date>` (the cover
period ended) and the desk says the status is active while flagging the past
date. That was never a contradiction; it is two true facts, which is what the
whole section above is about.

⛔ **IT WILL ROT AGAIN, and there is no durable fix** — a `policies` table holds
real dates, so a demo built on one drifts with the calendar. The re-basing
statement is in the PR that applied it; re-run it when the demo stops reading
1/1/5. ⚠️ **The tell is the home page disagreeing with `sample.mjs`**, not
anything failing: no test goes red when this rots, because the fixture is
relative and never moves.

⚠️ **THE UNIT TESTS COULD NOT CATCH THIS FIX, AND ONLY MUTATION TESTING SAID
SO.** With 392 unit tests green, **four view mutations SURVIVED**: deleting
`expiryBadge`'s `ended` branch, deleting the policy detail's `ended` label, and
reverting **either** call site from `expiryBadge(policy)` to
`expiryBadge(policy.renewalInDays)` — the last two restore the original bug in
one character. **S28** closes that (see the scenario table). Writing it then
turned up a fifth reader nobody had listed: `policySummaryCard` on the **asset**
page, found because its mutation survived a version of S28 that already asserted
three readers. There are **four** `expiryBadge` call sites in two files, and
assuming one covers another is how this stayed open.

⚠️ **Two fixture defects fell out of it**, both the same class — a fixture
modelling a shape the app never produces:
- **neither fixture carried `status` at all** (`js/keep/fixtures/sample.mjs` and
  the Playwright harness), though the live adapter emits it on every policy. They
  now do, pinned by an assertion in `policies.test.mjs`.
- the harness fixture said **`policy_number`**; the column and the adapter are
  **`number`**, so its `.k-imuted` line has always rendered blank and nothing
  asserted on it. That is the *same wrong name* that shipped in `help-ask`'s
  select and made every client's records read as "nothing on file". **Take
  fixture field names from the TABLE, not from the nested shape the views
  consume** — the default fixture still carries the wrong one, deliberately
  unchanged here so the contrast is visible beside S28's.

⚠️ **And a third heading convention surfaced:** list pages use `.k-h1`, policy
detail uses `.k-phead__t h1`, asset detail uses `.k-ahero h1`. CLAUDE.md already
records that a `.k-h1` assertion after a navigation matches the page being LEFT;
on these two it matches **nothing**, which is the louder failure and is how both
were found.

### ⚠️ THE FIX ABOVE WAS INCOMPLETE IN FOUR WAYS, ALL FOUND BY ONE REVIEW

Codex reviewed `90b4970` — **after** it had merged, which is the operational
lesson on its own and is recorded at the end. All four findings were real, all
four were mine, and three of them are the *same defect class the fix was about*,
arriving one layer out.

| # | finding | why it survived |
|---|---|---|
| **P1** | `renderKeepLanding` counts `policies++` unconditionally and renders it as **"Active policies"**, and `lapsed` tests `renewalInDays < 0` **directly** | the badge fix found four readers and stopped. These are the **fifth and sixth** |
| **P2b** | every non-affirmative status got the red/`lapsed` treatment, so `pending`, `quoted` and `bound` were presented as **ended cover** | I considered this explicitly and talked myself out of it: *"I'm overthinking a branch with zero production instances … fail loud in the direction of check this"* |
| **P2c** | `renewalCounts` folded `nostatus`/`unknown`/`ended`/`pending` into **`undated`**, which the Policies tile renders **literally** as "N undated" | I checked the counter and not the **label that consumes it** |
| **P2a** | S28's fixed dates (`2027-03-12`, `2027-09-30`) expire | the control fails loudly in March 2027; the cancelled policy **quietly stops testing the bug** in September |

**P1 is the one to learn from.** The whole change was "a fact with several
readers, made to agree through one module", and I shipped it having found four
readers of six. `lapsed` was worse than missed — it never consulted `status` at
all, so a cancelled policy with a future renewal date was in **neither** number.
⚠️ **Counting readers by grepping the function you are changing finds the ones
that CALL it, never the ones that re-implement it.** `policies++` and
`renewalInDays < 0` are invisible to a grep for `policyKind` or `expiryBadge`.

**P2b is the comment-overclaims-code defect, caught in the act.** `statusText`'s
own comment says the app *"does not own the vocabulary of `policies.status`…
rounding 'non-renewed' to 'Cancelled' would state something the record does not
say"* — and the view then rounded **every** unrecognised value to a terminal
state. Now split: `ended` (a documented terminal list) is loud; `unknown` is
neutral and verbatim. ⚠️ **The terminal list is not the guessing `statusText`
refuses, and the asymmetry is the justification:** being wrong there costs a
*neutral* badge on a dead policy — whose text still reads the broker's own word —
while being wrong the old way cost a *false alarm* about live cover. The list can
only move a status from neutral to loud; it can never make a non-active policy
read as in force.

**P2c is the scoping defect again** — the sixth instance in this file. I verified
the bucket and not the sentence rendered from it. `undated` now means *no renewal
date on file* and nothing else; `unclear` and `pending` are their own buckets,
and `inForceNote()` builds the subtitle in one place for both views.

**P2a has no mutation that fails today**, so S28 now asserts its own
**precondition**: the cancelled policy's renewal date must be in the future, with
a message saying the scenario is *disarmed* otherwise. Dates are computed with
`dayOffset()`. ⚠️ The dangerous half was never the expiry — it was that after
September 2027 the fixture's own date logic would render "Expired" and **every
assertion would still pass against unfixed code**. A test that expires loudly
gets fixed; one that quietly stops testing anything does not.

**Measured: 8/8 mutations caught** on the four fixes (both landing counters, both
halves of the ended/unknown split, both halves of the undated split), plus the
precondition, with a future-literal control correctly surviving.

⚠️ **AND THE PROCESS FINDING, which cost nothing this time and will not always.**
I merged `#268` without waiting for a review, on a standing "don't keep asking"
instruction, and said I would stay subscribed to catch a late one. **The
subscription auto-ended on merge**, so the notification stream reported only my
own actions and showed **zero** reviews; the four findings were sitting on the
PR and were found only by querying it directly. Two rules follow: a merged PR's
review is not pushed to you, so **fetch `/reviews` and `/comments` explicitly
after merging**; and this repo's reviewer habitually lands **minutes after** a
merge (`#258` was 3 minutes, this was ~5), so "merge now, catch the review
later" is a real tactic only if the catching is done by hand.

⚠️ **ONE THING IT GETS RIGHT AND ONE IT MISSES — MEASURED 2026-10-16, after a
first attempt at this paragraph got both backwards.**

**Right: "minutes after" is the correct magnitude.** The verdict lands
**1m53s-4m22s** after `ready_for_review`, and every merge in the 2026-10-15
session beat it by **1m51s-4m16s**:

| PR | `ready_for_review` | verdict | merged | verdict lands |
|---|---|---|---|---|
| #279 | 19:20:05 | 19:24:14 (4m09s) | 19:20:11 | 4m03s AFTER the merge |
| #280 | 19:24:36 | 19:26:29 (1m53s) | 19:24:38 | 1m51s after |
| #281 | 21:13:21 | 21:15:53 (2m32s) | 21:13:42 | 2m11s after |
| #282 | 21:24:22 | 21:28:44 (4m22s) | 21:24:28 | 4m16s after |
| #283 | 23:23:50 | 23:27:47 (3m57s) | 23:24:04 | 3m43s after |

**Missed: a DRAFT IS NEVER REVIEWED.** The trigger is `ready_for_review`, not
opening the PR — stated in Codex's own comment ("Reviews are triggered when you
open a pull request for review, mark a draft as ready, comment @codex review")
and confirmed by **#279 sitting as a draft for 12h35m and drawing no review at
all**. So this repo's convention of opening every PR as a draft means the clock
does not start until the un-draft, and the wait must come after it.

⛔ **AND HERE IS THE TRAP, WHICH COST THIS PARAGRAPH ONE WRONG VERSION:**
polling for "has a Codex comment appeared?" returns **true in 9-18 seconds**,
and that comment is **not the verdict** — it reads `status: "running"`,
`has_any_findings: null`, and Codex then **UPDATES THE SAME COMMENT** with its
result. So `created_at` measures the acknowledgement and `updated_at` measures
the verdict, and the first version of this section published the 9-18s figures
as the review time and declared the repo's own "minutes after" record wrong. It
was not wrong. **A comment's existence is not its content.**

✅ **So poll the embedded state, not the comment.** The body carries
`<!-- codex-review-state:v1 {...} -->`, whose `code_review.status` goes
`running` → `completed` and whose `has_any_findings` is the verdict. Positive
control: **#281 reads `has_any_findings: true, has_unresolved_findings: true`**,
which is the P2 that was genuinely there, while the other four read `false` —
so the field means what it says.

**The remedy, with the right number in it:**

> **un-draft, poll `codex-review-state:v1` until `status == "completed"`
> (budget ~5 minutes), read `has_any_findings`, then merge.**

⚠️ The hand-fetch rule above still stays — it is what found #268's four findings
and #281's P2 on already-merged PRs. But it is a **recovery**, and the gate was
available the whole time: four of those five merges were a `ready_for_review`
and a squash within **two to twelve seconds** of each other, which cannot be
reviewed by anything.

### ⚠️ Recorded — S10 spends real money on every Pages deploy

`qa-live` runs after each Pages deploy with `retries: 1`, and S10 asks a real
question as the shared demo `user`.
⚠️ **Up to 4 asks per clean run, up to 8 on a failing one — not "up to 2", which
is what this said.** S10 carries no project filter, and `playwright.config.js`
declares **four** projects (desktop, tablet, mobile-chrome, iphone), so
`npx playwright test --list | grep -c S10` returns **4**. Measured by review
round 5; I had counted the scenario, not its instantiations.
⚠️ **"4 PAID calls" overstated it, and `--list` cannot establish spend** (Codex,
#266). `--list` enumerates selected INSTANCES and executes nothing, and the
handler has pre-provider exits that cost nothing — no keys, no `profiles` row, a
failed reservation, either cap, an unreachable corpus, a records error. So the
ceiling is **4 asks, each of which can bill**; the billed count is read off
retained `help_queries` reservations, and because the logs drop rows that count
is a floor. The cap arithmetic below is unchanged, because a CEILING is the right
input to a spend bound — it is the *reporting* that was wrong, not the caution.
That makes the **20/hour per-account** cap the sharp edge: about **5 clean runs**
exhausts it (2-3 failing ones), not "ten deploys" — and after owner-gate step 7
those 4 CI asks run *before* the operator's own step-8 proof, so a burst of
deploys can make step 8 fail for rate-limiting rather than for anything real.
Not fixed because every option is a trade: a dedicated CI account needs a
`profiles` row and another credential in secrets; skipping the ask removes the
only live proof the answer path works. Flagged so the first "why is the demo desk
rate-limited?" has an answer. (The *flake* half of this finding WAS fixed — S10's
settle was 45s against the function's own 60s ceiling.)

### The Help desk model tier — a BROKER CONTROL first, a Supabase secret second (2026-10-14)

⚠️ **THIS SECTION WAS TITLED "the model tier is a Supabase secret" AND THAT IS NO
LONGER WHERE THE TIER LIVES.** The authoritative value is a row in
`public.help_settings`, set by a broker on `#/keep/security`. `HELP_MODEL` is
still read, and is now the **break-glass**: it applies only when the row is
unreadable or absent.

**Precedence: the stored row, then `HELP_MODEL`, then `claude-opus-5-5`.** The
row wins on purpose, and the other order was the tempting one — if the secret
overrode the row, a broker could move the switch, watch it save and read back,
and change nothing about the answers, which FR-17 renders as indistinguishable
from a working change. When both are set and disagree, the ignored one is
**named** in the log (`where: "model"`, `ignoredSecret`).

**Where each piece is:**

| piece | file |
|---|---|
| the stored row + its RLS and grants | `supabase/migrations/20261014001500_help_settings.sql` |
| what a broker may pick, and the prices shown | `js/keep/logic/help-model.js` |
| the control | `helpTierCard()` in `js/keep/views/keep.js` (Security page) |
| read/write | `getHelpModel` / `setHelpModel` in `js/supabase.js` |
| the server read + precedence | `storedModel()` in `supabase/functions/help-ask/handler.ts` |
| the model named on an answer, to everyone | `aiNote()` → `.k-help__ai` in `js/keep/views/help-view.js` |

**The row is NOT cached — not in the isolate, not in the Keep's `cache`.** A
cached tier would take effect whenever the isolate happened to recycle, or would
be read back from a `loadTree` snapshot taken before the broker changed it. Both
are the same "appears to work" failure one layer down. One indexed single-row
select per ask is the price of the switch being honest.

**Broker only, in the database and not only in the UI.** `hs_broker_select` and
`hs_broker_update` key on the caller's own `profiles.role`; `authenticated` holds
`SELECT` and `UPDATE (model)` and nothing else — no INSERT, no DELETE — and the
`updated_at`/`updated_by` stamps are set by an INVOKER trigger so they cannot be
forged. The underwriter is excluded deliberately: that role owns
underwriting → approved/declined, not help-desk spend. Eight probes measured as
real `authenticated` sessions are recorded in the migration's footer with EXPECT
and GOT.

⚠️ **"SAVED" DOES NOT MEAN "IN USE", and the control says so rather than
implying otherwise.** The write proves the ROW moved. If the deployed function
predates this change it does not read the row at all — and FR-17 makes that look
exactly like a tier being honoured. The only end-to-end proof is the other half:
the answer itself names the model.

✅ **AND THAT PROOF IS NOW SHOWN TO EVERY CALLER, FOLDED INTO FR-10'S OWN
SENTENCE (owner decision, 2026-10-14):** *"Answers are AI-generated by Anthropic
**(Sonnet)** from this app's help guide …"*. It was a separate broker-only
`.k-help__tier` line, gated server-side on `profiles.role`.
**Why it changed, and why the original reasoning was wrong.** The gate was
justified as "which tier they are getting is a spend decision of the broker's,
not a fact about their cover". That does not survive the product's own copy: the
tier card calls Haiku *"weakest on nuance"*, so a broker could move every client
to a cheaper model and **the client had no way to know the answers got worse** —
an asymmetry running in the broker's favour at the client's expense, on a surface
that **already** discloses "AI-generated by Anthropic". Naming the model is a
small increment on a disclosure already made. The file's own justification was an
argument for showing BROKERS, never an argument for hiding it from clients; those
were treated as one claim and they are not.
**Folded rather than appended, deliberately:** inside a disclosure the client is
already reading it reads as transparency; a separate system label reads as an
operational detail they cannot act on, and invites "why did I get that one?" on a
product with no mechanism to answer it. One fact, one place — the broker's
separate line is gone, not duplicated.
⚠️ **`AI_NOTE` is COMPOSED FROM HEAD + TAIL, not patched with `.replace()`.** The
model is inserted between them, so a reword would silently no-op a replace-based
version — a defect that shows up only as a missing word nobody asserts. S27 pins
**both** halves: that the model appears AND that FR-10's wording survives, because
a check for the model alone passes a mutation that drops the rest of the
sentence (measured: it does).
✅ **PROVEN END TO END ON THE LIVE SITE, 2026-10-14.** This read "the live
function is still the pre-change deploy, so the switch stores a tier nothing
reads yet" — true when written, false within the hour, which is exactly the
staleness this file keeps paying for. What was actually done, in order, by the
owner against production:

1. Signed in as `broker@example.com` → the `.k-tier` card RENDERED (a client
   never sees it), and its status read **"Opus is the stored tier."** — the value
   READ BACK from `help_settings`, not a default, so `hs_broker_select` admitted
   a real broker session.
2. Clicked **Haiku** → **"Haiku is now the stored tier."** — so
   `hs_broker_update` admitted the write, the `(model)` column grant allowed it,
   and the CHECK accepted the value.
3. Asked a question on `#/keep/help` → the answer ended **"Answered by Haiku."**

Step 3 is the one that matters: that line is appended by the FUNCTION, gated on
the caller's own `profiles.role`, and it is the only thing either half can show
that the OTHER half produced. ⚠️ **Asking the model "which model are you using"
does NOT prove it** — it was tried first, and the model correctly answered that
the help guide does not say, because the corpus and the client's records are all
it sees. A model cannot verify its own tier, and the readout is deliberately not
something it can say.

⚠️ **BUT STEP 3 DOES NOT PROVE THE FUNCTION READ THE *ROW*, AND THIS SAID IT
DID.** Codex, #260. `storedModel()` falls back to `HELP_MODEL` by design, and the
payload carries the **resolved** id without naming its source — so if that secret
also held `claude-haiku-5-5`, a denied or failed settings read produces a
byte-identical "Answered by Haiku." The three branches are observationally equal
at the UI, which is FR-17's lesson arriving inside the proof written to escape
it. What step 3 does establish, exactly:

| claim | status |
|---|---|
| the deployed function is the post-change build (it reads a tier at all and gates the field on role) | **proven** — the pre-change deploy had no `model` field to send |
| the resolved tier was `claude-haiku-5-5` | **proven** |
| a broker sees the readout and a client does not | **proven** |
| the resolved tier came from `help_settings` rather than from `HELP_MODEL` | ✅ **PROVEN 2026-10-14 — see the Sonnet test below** |

Steps 1 and 2 cannot close the last row either: they are the **browser's** reads
and writes (anon key + the broker's JWT, under `hs_broker_select` /
`hs_broker_update`), while the function reads through its own `admin` client
under the explicit `service_role` grant. Two different readers, two different
grants — proving one says nothing about the other, which is the whole reason that
grant is called out as load-bearing.

**What the logs could and could not settle** (measured from a session 2026-10-14,
and the *method* is the keeper — see the box below):

| evidence | reading |
|---|---|
| `PATCH /rest/v1/help_settings?id=eq.true` → **200** at 03:20:45.226 | the broker's write landed |
| `POST /functions/v1/help-ask` → **200** at 03:21:17.908 | the proving ask, 32s later |
| **no `{"where":"settings"}` line** in `function_logs` anywhere in 24h | *suggestive only* — see the limit below |

⚠️ That last row is **not** treated as proof, and the reason is the positive
control: `storedModel()` logs only on FAILURE, so its silence is informative only
if that channel is known to carry the function's `console.error` at all — and
every `function_logs` row in the window is a platform `booted`/`shutdown`
message, so **nothing establishes the channel works**. Absence of a log line is
exactly the kind of evidence this repo has already been burned by (the auth-gate
window, the "no webkit in the image" directory listing). It is recorded as
suggestive and nothing more.

⚠️ **AND THE SEARCH WAS CALLED OFF ONE QUERY TOO EARLY.** The paragraph above is
sound about its own evidence and wrong about what evidence was available: the
function's `help_settings` read **is** visible, in `edge_logs`, under the
`Deno/… SupabaseEdgeRuntime` user agent — `GET | 200` at **14:24:01**, between
the broker's `PATCH` at 14:22:58 and the answer at 14:24:04. See *HOW TO READ THE
EDGE FUNCTION LOGS* above, which now carries the retraction and the user-agent
discriminator. So the row-was-read claim has a **direct** measurement as well as
the elimination argument below, and the thing that hid it was a `source` filter,
not the platform. The `function_logs` limitation stated above is real and
unchanged; it was simply never the only channel.


✅ **THE DECIDING TEST WAS RUN 2026-10-14, AND IT PASSED.** The stored tier was
set to **Sonnet** — neither the default (`claude-opus-5-5`) nor the value already
observed (`claude-haiku-5-5`) — and one question was asked as a broker. The row
was confirmed from a session first (`claude-sonnet-5-5`, `updated_at`
14:22:58Z), and the answer ended **"Answered by Sonnet."**

**Why that is proof rather than more corroboration:** the fallback chain is
stored row → `HELP_MODEL` → default, and **it cannot produce a value nobody
configured**. Haiku could not distinguish the branches because a secret set to
haiku yields a byte-identical payload; Sonnet can, because reaching it requires
the row to have been read. The test was designed to be informative in all three
directions, which is what makes it a test and not a confirmation: Opus would have
meant the settings read failed to the default, and Haiku would have meant
`HELP_MODEL` is overriding and the precedence is backwards.

⚠️ **THE ANSWER ALSO SAID "nothing on file for you yet", AND THAT IS CORRECT —
do not read it as a records-digest failure.** The caller was the **broker**, and
the digest is owner-scoped from the JWT under RLS, so it reported the BROKER's
records; the seeded entities, assets and policies belong to `user@example.com`.
Two independently-wired things are visible in that one answer, and it is worth
noting they stayed independent: the tier readout rendered (then gated on
`profiles.role`) while the digest stayed empty (gated on `owner = auth.uid()`).
Had those been wired to the same check, one of them would have been wrong.
⚠️ That observation is **historical in one respect**: the role gate on the tier
was removed later the same day, so only the owner-scoping half still gates
anything. The point it demonstrates — two gates on one answer staying
independent — is why it is kept. The
staff read path (`er_broker_select`) covers enhancement requests only — it does
not widen the digest, and this answer is the practical demonstration.
⚠️ A consequence worth stating for the next operator: **a broker is the wrong
account for testing the RECORDS half of the desk.** Use the client for that; use
the broker only for the tier readout, which is the one thing a client cannot
see.

**An unrecognised stored value falls back to the default and logs
`where: "model", source: "settings"`.** The CHECK constraint makes that
unreachable through PostgREST, and the function still allow-lists, because a
function must not assume a constraint it does not own. The readout shows such an
id **verbatim** rather than rounding it to a familiar label — a tier nobody
recognises is exactly what an admin needs to see.

⚠️ **THE ALLOWED IDS NOW EXIST IN THREE SOURCES THAT CANNOT IMPORT FROM ONE
ANOTHER** — the SQL CHECK, `HELP_MODELS` in `handler.ts`, and
`HELP_MODEL_CHOICES` in `help-model.js`. `js/keep/logic/help-model.test.mjs`
parses all three and asserts they are IDENTICAL **in the same order**; order,
because the default is positional in two of them, so set equality alone would
let the default diverge silently. Each source is scoped to the declaration that
owns the property *before* being comment-stripped — the migration's own probe
footer names a deliberately REFUSED id in prose, and a whole-file scan would
read it as allowed. **Mutation-tested 7/7**, with a control (a comment naming a
fourth model) correctly clean.
⚠️ Its precondition check earns its place: the strippers are not string-aware,
so each parsed region is first asserted to contain no comment marker inside a
string. The first version checked that over the whole of `handler.ts` and
**failed on its first run**, correctly, on `"--no-verify-jwt"` — with a needle
list that did not even match the strippers in use.

The secret remains switchable from the Supabase dashboard (Project Settings
→ Edge Functions → Secrets) without a redeploy or a PR. Unset means
`claude-opus-5-5`. Accepted values, in both halves, and nothing else:

| value | $/1M in | $/1M out |
|---|---|---|
| `claude-opus-5-5` (default) | $4 | $20 |
| `claude-sonnet-5-5` | $2 | $10 |
| `claude-haiku-5-5` | $0.10 | $0.50 |

**It is an allow-list rather than a pass-through, and that is the whole reason
`resolveModel` exists.** An unrecognised id reaches the provider as an unknown
model and comes back 400 — which FR-17 renders as the same quiet "not available"
notice as an outage, a missing key, or an undeployed function. A typo in a secret
would therefore be indistinguishable from all three, which is this file's most
frequently repeated defect rather than a hypothetical. An unknown value **falls
back to the default and logs `where: "model"`** naming what was ignored; falling
back rather than refusing is deliberate, because a mistyped secret should cost a
log line, not a dead desk. Case and surrounding whitespace are forgiven (they
cannot be ambiguous); a **date-suffixed** id is explicitly NOT accepted, since it
is the most likely wrong value a human types and it is wrong in a way that looks
right.

⚠️ **The model is never read from the request body**, for the same reason `owner`
is not: a client-chosen model is a client deciding how much of the owner's money
an ask costs, and both caps count **asks, not dollars**. A client-facing picker
was considered and rejected on exactly that ground.

⚠️ **`HELP_MODEL` is deliberately NOT part of `HAS_KEYS`.** A missing model is a
working default, not a missing secret; conflating them would take the desk down
over a setting that is correct when absent. `contract.test.mjs` asserts this
against the `HAS_KEYS` declaration **scoped to the declaration itself**, because
`HELP_MODEL` legitimately appears elsewhere in `index.ts` and a whole-file check
could never fail — the same scoping defect this file records four times already.

**Where each claim is gated, since they are not the same claim.** `handler.ts` is
executable under Node and `index.ts` is not (it imports `jsr:`/`npm:` specifiers),
so:

| claim | gated by |
|---|---|
| the resolver maps values correctly | `handler.test.mjs`, executed |
| the resolved id **reaches `messages.create`** | `handler.test.mjs`, executed — the fake captures `args.model` |
| the **stored row** reaches `messages.create`, for every tier | `handler.test.mjs`, executed |
| the row **beats** the secret, and the ignored one is logged | `handler.test.mjs`, executed |
| a denied settings read is **not fatal** and logs `where: "settings"` | `handler.test.mjs`, executed |
| the tier is read **fresh on every ask** | `handler.test.mjs`, executed — one store, mutated between two asks |
| the payload names the model **for every caller, whatever the role** | `handler.test.mjs`, executed — `undefined` is in the role list deliberately, being the shape a gate keyed on string equality would have let through |
| the invite read selects **`id` only** | `handler.test.mjs`, source scan + `schema.test.mjs`'s `DOCUMENTED` |
| the three allow-lists agree, in order | `help-model.test.mjs`, **source scan** of all three |
| the control is absent for a client, reports what it READ, reverts a refused write, and sends exactly `{ model }` | **S26**, offline harness, four viewport projects |
| every answer names the model inside FR-10's sentence, and FR-10's wording survives | **S27**, offline harness, four viewport projects |
| the call site carries no literal | `contract.test.mjs`, **source scan** |
| `index.ts` reads the env and injects it | `contract.test.mjs`, **source scan** |

The middle row is the one that matters: reverting the call site to a literal
leaves every resolver test green. **Mutation-tested 8/8** — literal at the call
site, allow-list accepting anything, deleted rejection log, dropped
`toLowerCase`, blank no longer meaning unset, `index.ts` not injecting, `index.ts`
not reading the env, and `HELP_MODEL` folded into `HAS_KEYS`.

**The stored-tier half is mutation-tested 8/8** (precedence reversed, stored read
dropped, payload field unconditional, payload field never sent, a settings error
made fatal, each of the two log lines deleted, `source` pinned to the secret) and
**the UI half 7/7** (role check deleted, revert deleted, the unread state given a
default, a read failure showing the default, `setHelpModel` sending a column the
live grant refuses, the readout rendered unconditionally, an unknown id rounded
to a label).

⚠️ **ONE MUTATION SURVIVED FIRST AND THE FIX IS THE USEFUL PART.** Setting
`current` to a real tier instead of `null` in `helpTierCard()` passed everything,
because `paint()` did not run until the read landed — so the initial value was
unobservable and the `current === null` branch inside `paint()` was unreachable.
The `disabled` attribute in each option's `attrs` was quietly doing the work.
Fixed by painting once BEFORE the read, so the unread state is rendered *by* the
guard; the mutation is then caught. Same family as every other entry in this
file where a green assertion was held up by something other than the guard under
test.

⚠️ The source scans claim only what a scan can: they cannot see whether the
deployed function was built from this source. Nothing here executes `index.ts`,
which is the exact condition that let seven of eight behaviour-breaking edits
survive this feature's original suite.

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

### ✅ RESOLVED 2026-10-15 — the app bar overflowed 761-1044px, AND there was no nav at all below 760px

⚠️ **THE SECOND HALF OF THAT HEADING IS THE ONE NOBODY HAD RECORDED, and it was
the worse defect.** Below 760px `.k-nav` was `display: none` with **nothing in
its place** — no hamburger, no bottom bar. The account menu is the only other
way around and carries Documents alone, so **Entities, Assets and Policies —
three of the portal's five screens — were unreachable on a phone.** (The brand
logo links to Home, so four of five were reachable in total.)
It sat one line above a carefully measured overflow table for nine days. The
overflow was the thing being looked at, so the `display: none` beside it read as
the *fix* for narrow widths rather than as a dead end.

**Why both are one fix.** This section used to say there was "no minimal fix"
because "raising the hide breakpoint to 1044px would strip the main nav for
every tablet user with no hamburger to replace it". That is exactly right, and
the conclusion drawn from it was wrong: the missing hamburger was not a *cost*
of fixing the overflow, it was **an existing defect at narrower widths**. Build
the compact control once and one breakpoint closes both.

`KEEP_NAV` in `shell.js` is now the single source for the five destinations;
the wide `.k-nav` strip and the `.k-pop--nav` popover both render from it. The
popover is built on the shared `popover()`, so outside-click, Escape and
`aria-expanded` come with it rather than being hand-rolled — which is what the
*Collapsible reveals (always)* standard requires.

**Measured pre- AND post-change across the whole band** (headless chromium,
local static server, the offline `page.route` harness — the original method,
re-run on a stashed tree so the comparison is controlled rather than remembered):

| width | before | after |
|---|---|---|
| 320 | overflow, bar needs **371** | overflow, bar needs **348** — improved, still open |
| 360 | overflow | **ok** |
| 390-480 | overflow (`page` 502) | **ok** |
| **761-1044** | **OVERFLOW at every width** | **ok** |
| **320-760** | **NO NAV AT ALL** | compact nav |
| 1045+ | ok | ok |

**Three causes, so three fixes** — listed separately because two are not about
the nav at all:
1. the breakpoint moves 760 → **1044**, the bar's measured intrinsic width;
2. the brand's decorative "The Keep" pill and the bar's `--space-6` gutters are
   dropped below 480px. That pays for the 68px the new control costs: the bar
   needs **348px** at 320 where it needed **371** before, so this is a strict
   improvement at every width rather than a trade;
3. `.k-seg` wraps below 480px. ⚠️ **PRE-EXISTING and unrelated to the bar** —
   the Entities tablist is `inline-flex` with no wrap, needs **478px**, and was
   the *only unclipped element* driving a 502px page on `#/keep/list`. ⚠️ Finding
   it needed a scan that **excludes elements inside a horizontal scroller**: the
   820px `.k-itable` is correctly inside `.k-itable-wrap { overflow: auto }`, and
   sorting overflowing elements by width surfaced that table on every route and
   buried the real culprit. It wraps rather than shrinks because there are
   **four** segments and one reads "Relationships": no padding or font tuning
   fits them on one row at 390px, and the alternatives were an ellipsis or a
   scroller that hides a tab — a hidden navigation control being the very defect
   fixed above.

⚠️ **320px IS STILL OPEN, deliberately, and S29 NAMES it rather than omitting
it.** Closing the last 28px means shrinking the 44px touch targets the Keep
maintains everywhere (`min-height: 44px`, repeatedly, by design) — a worse trade
than a sideways scroll on a phone narrower than any device in the matrix (the
smallest is iPhone 12 at 390px). A test that silently skips a width it would
fail at is the kind of omission this file records elsewhere; the exclusion and
its reason are in the scenario.

**Mutation-tested 10/10**, with a control that correctly survived: breakpoint
reverted to 760, compact nav never revealed, menu links hardcoded with one
dropped, wide strip left visible, panel right-aligned, brand pill kept, bar
gutters kept, tablist no longer wrapping, a misspelt icon name, and `popover()`
swapped for a hand-rolled toggle.

**Three method findings from writing it, all of the kind this file keeps
re-learning:**
- ⚠️ **`icon()` renders an EMPTY `<svg>` for a name with no sprite symbol** — no
  error, no exception, no failing test. Two of the first five icon names written
  here were wrong, and `icon-menu` did not exist in the sprite at all. A
  repo-wide diff then showed `menu` was the **only** missing symbol, so the
  sprite is otherwise complete. S29 now fails on any app-bar `<use href>` that
  resolves to nothing. See the next section for why a general guard was NOT built.
- ⚠️ **S29's first version failed at the SECOND width with "the compact nav did
  not open" — which reads as an app defect and was a test defect.** `page.goto`
  to the same URL and hash **does not reload the document**, so the menu left
  open by the previous iteration was still open and the click toggled it *shut*.
  This file already records that trap for the nav stack; same trap, new surface.
  Each iteration now asserts a known-closed menu and restores it.
  ⚠️ And the probe that diagnosed it was wrong the same way FIRST: its
  `addEventListener` calls stacked across iterations for the identical reason,
  producing `fires: 2` and a convincing "the handler double-fires" story. The
  giveaway was the count rising monotonically — 1, 2, 3, 4 — across widths.
- ⚠️ **THE MUTATION HARNESS ATE THIS SECTION ONCE, with the warning about it
  already in this file AND copied into the harness's own docstring.** The
  harness ends every mutation with `git checkout -- .`; these CLAUDE.md edits
  were uncommitted while it ran, so all three of them were reverted. The
  2026-10-14 entry under *FOUR WAYS A MUTATION TEST LIES* says "commit before
  EVERY run, not before the first" — the failure was reading that as a rule
  about the *code under test* when it is a rule about **every tracked file in
  the tree**. A harness that destroys uncommitted work should refuse to run on a
  dirty tree in BOTH directions; mine only checked at startup.

### ⚠️ A GREEN `scrollWidth` SAYS THE BAR FITS, NOT WHAT GAVE WAY TO MAKE IT FIT (2026-10-15)

Two Codex P2s on #274, both reproduced, and the first one **invalidates a claim
the section above makes**.

**The bar was fitting dishonestly.** `scrollWidth <= clientWidth` was green at
360px — and it was green because the brand's `<svg>` logo, which is also the
link home, was **rendered at 0px**. Measured across the band:

| width | logo on `56aa848`→`56ab848` (old main) | after #274 | after this fix |
|---|---|---|---|
| 320, 360 | **0px** | 0px | 26px |
| 390 | **0px** | 26px | 26px |
| 414 | **15px** | 26px | 26px |
| 600 | 26px | **16px** ← #274's | 26px |

So it is **pre-existing**, #274 *shrank* the band (320-414 → 320-360), and #274
**introduced a fresh instance at 600px** where the compact control's 52px came
out of the brand. No overflow assertion could have caught any of it.

✅ **AND 320px NOW CLOSES, WHICH #274 SAID IT NEVER COULD.** That section reads
"closing the last 28px means shrinking the 44px touch targets" — wrong, because
the bar was never 28px short: it was crushing the logo. Giving the icon
`flex: none` and letting the wordmark go instead freed far more than the icon
needed.
⚠️ **BUT THE SENTENCE THAT FOLLOWED — "zero overflow from 320 to 1440" — WAS
FALSE, and the next section is how.** It was measured at 320, 360, 390, 414,
480, 600, 700, 740, 759-761, 810, 900, 1000-1045, 1100, 1280, 1440 — and the
defect lived at **481-500**, between two clean samples. Logo at 26px and no
control under 44px both hold.

**The fix is a stated sacrifice order, not three fixes:** the decorative
`.k-tag` goes first, then the brand WORDMARK (hidden below 380px — an
ellipsised "Harborl…" measured worse than no wordmark), and never the mark or a
touch target.

⚠️ **WHICH PARTS EARN THEIR PLACE WAS SETTLED BY ENUMERATING ALL EIGHT
SUBSETS**, not by argument. The minimum is **tag-band + wordmark**; `flex: none`
is **BELT** and is labelled a survivor in the code, because this file records
twice already that a comment kept calling a guard load-bearing after it stopped
being so.

⚠️⚠️ **AND THE FIRST RUN OF THAT ENUMERATION SAID THE OPPOSITE, ON A BROKEN
MUTATION.** Its "remove the tag rule" step only **prepended a comment** — a
non-empty diff, so the applied-check passed, and every row involving it was
meaningless. On that evidence the tag-band rule was about to be reverted as
"a cost with no measured benefit"; it is in fact *half the minimum*. That is
**mutation-lie #3** (a mutation that reads as applied and encodes nothing) with
a new disguise: not an empty diff, but a diff that changes only a comment. The
enumeration now asserts the **declaration count dropped**, and the anchor is
taken from the file verbatim rather than retyped — the retyped version also
failed once on an em dash written as `--`.

**The second finding: the menu panels stranded destinations.** At 740×320 the
compact nav's five 44px links ran to 338px from a panel starting at 100px, so
"Documents" was off-screen — and the shared scroll handler closes every
`.k-pop`, so the page could not be scrolled to it either. Fixed on `.k-menu`
rather than only the new panel, because the ACCOUNT menu has more items and the
identical defect: measured, **"Sign out" unreachable at 896×414** and
`Documents, Help, Sign out` at 740×320.
⚠️ **The second half of that fix is load-bearing and the first half is inert
without it:** the scroll listener is on `window` with **capture**, and scroll
does not bubble but *is* caught capturing — so a panel scrolling its own
overflow closed itself the moment it was used. It now ignores a scroll
originating inside a `.k-menu`, and a window scroll still closes the menus.
Mutation-tested 3/3 on the panel half (unbounded again, in-panel scroll closing
it, window scroll no longer closing it); the three brand fixes are covered by
the subset enumeration above instead, since each survives alone.

**S29 was extended rather than duplicated:** 320px joins the band, every width
additionally asserts that **nothing is crushed** (the logo keeps its natural
width, no 44px control shrinks), and a 740×320 block asserts the panel is
viewport-bounded, scrolls, **stays open when scrolled**, strands nothing, and
still closes on a page scroll.

### ⚠️ `scrollWidth` ON A FLEX CONTAINER IS WHAT IT SETTLED FOR, NOT WHAT IT WANTED (2026-10-15)

Three Codex P2s on #275. All three reproduced, and the first **falsifies that
PR's headline claim** while the second invalidates a breakpoint two PRs had
been built on.

**1. "Zero overflow from 320 to 1440" was false.** #275 sampled 480 and 600 and
the whole defect lived between them. At 481 the three compact-bar rules all
switched off at once — search 44→160, gutters and gaps widened — while the bar
still had no room:

| width | wordmark | page overflow |
|---|---|---|
| 480 | full | 0 |
| **481** | **truncated to 43px of 104** | **21px** |
| 490 | truncated to 52px | 12px |
| 500 | truncated to 62px | 2px |
| 520, 540 | truncated | 0 |
| 560 | full | 0 |

So the ellipsis #275 added rendered the brand as **"Ha…"** across 481-540 — the
exact outcome its own comment calls worse than hiding the wordmark. The compact
rules now switch at the measured **560**.

**2. AND THE 1044 BREAKPOINT WAS WRONG BECAUSE OF *HOW* IT WAS MEASURED.** It
came from `.k-bar__in.scrollWidth`, which reports the **laid-out** width rather
than the intrinsic need whenever a child can shrink. `.k-tag` is itself a
shrinking flex item — **55px at 1045 against a natural 83px** — so the original
reading was of an already-compressed bar. Re-measured with the shrink
neutralised (`flex: none; overflow: visible`, then read): the wide layout needs
**1130**, and 1045-1120 truncated the wordmark to as little as **54px of 104**
with every overflow assertion green. Breakpoint moves 1044 → **1129**.

⚠️ **The generalisable rule: to measure an intrinsic width, neutralise the
shrink first.** `scrollWidth` on a flex container whose children shrink tells
you what it settled for. Two PRs rested on that number.

A third band, **381-384**, was the same discontinuity at the other boundary;
the wordmark hide moves 380 → **385**.

**3. The sacrifice order was applied to the whole portal.** `.k-tag` is also
rendered by the LOGIN CARD's `.k-abrand` (`js/keep/views/keep.js:48`), which is
in no constrained container at all — the unscoped selector removed the product
badge from the authentication screen at every width 320-1044. Now
`.k-bar .k-tag`. **A sacrifice order is about one container; a bare class
selector applies it everywhere that class appears.**

**4. The panel's bound was an assumed top.** `calc(100vh - 124px)` subtracts a
ribbon plus a single-line bar, and the real top moves with ribbon height, text
size and zoom. Measured at 740×300 with the chrome at 2x: **39px past the
viewport**, "Documents" stranded after scrolling. `popover()` now sets an exact
`max-height` from the panel's measured top on each open; CSS cannot read an
element's own offset, so the declaration stays as the pre-first-open fallback
and says so.

⚠️ **THE DENSE SWEEP IS THE METHOD CHANGE, and it is the part to keep.** 120
widths — every 8px from 320 to 1120 plus **1px either side of every
media-query boundary** — asserting overflow, logo width, wordmark truncation
and the nav inversion together. A discontinuity is invisible to sampling by
construction: both endpoints were clean every time. S29's band went from 12
widths to 19, both sides of each boundary.

⚠️ **AND THE ELLIPSIS IS WHY EVERY OVERFLOW ASSERTION STAYED GREEN.** A
shrinkable wordmark converts an overflow into a truncation, which
`scrollWidth <= clientWidth` reports as a pass. The check for it is now in S29
beside the crush check: a visible `.k-brand__name` whose `scrollWidth` exceeds
its `clientWidth` fails.

**Mutation-tested 5/6, control clean** — the 481 overflow, the 1045
truncation, the 381 truncation, the login-card badge, and the fixed-subtraction
bound are each proven load-bearing; the `maxHeight` reset on close **survived**
and is labelled belt in the code.

⚠️ **THE FIRST MUTATION RUN WAS WORTHLESS AND THE CONTROL IS WHAT SAID SO.** It
graded 6 of 7 — and the **control**, a comment-only edit, "failed" with a
`page.evaluate` timeout. That is a harness verdict, not a finding. S29 had grown
to **17-22s on webkit against `playwright.config.js`'s 30s PER-TEST timeout**,
failing 2 of 4 on one run and 0 of 4 on the next. Every grade in that run was
suspect the moment the control failed. Fixed by redesign, not by raising the
bound (this file already records that a 30s wait cannot fit inside a 30s test):
S30 took the two non-band claims, the menu interaction dropped to one width per
layout regime, and the band **resizes instead of re-navigating** — media queries
re-evaluate on resize, 19 `goto`s were the bulk of the time, and a resize is
closer to what a person rotating a phone does. **21.9s → 5.7s** on the slowest
project.
⚠️ One real gap only that re-run could expose: reverting the wordmark hide
SURVIVED, because the band sampled 385/386 while the truncating widths are
381-384 — at 385 the shortfall is 1px and the `+1` tolerance absorbs it. The
band now carries **382**, the width the dense sweep flagged.

### ⚠️ A FLOOR ON A BOUND DEFEATS THE BOUND, AND A MEASURED BOUND GOES STALE (2026-10-15)

Two Codex P2s on #276, both reproduced, and the first is **#275's defect
reopened by #275's own fix** — the third time on this branch pair that closing
one direction opened another.

**1. `Math.max(120, room)` assigned height that did not exist.** The bound is
`innerHeight - top - 12`; the floor wins whenever that is under 120, which is
exactly the cramped viewport the bound exists for. Measured at 740x300, the
Keep's compact nav open, chrome scaled:

| chrome | panel top | real room | applied | past viewport | stranded |
|---|---|---|---|---|---|
| 32/30 | 163 | 125 | 125px | −12 | — |
| **40/38** | 183 | **105** | **120px** | **+3** | — |
| **48/46** | 207 | **81** | **120px** | **+27** | **Documents** |

So the floor cost a stranded destination — the same harm, in the same control,
that #275 measured at 39px and fixed. `Math.max(0, …)` now caps to the real
room: a cramped scrollable panel is honest, one whose last link cannot be
reached is not.

⚠️ **AND S30 PASSED THROUGHOUT, FOUR PIXELS OUTSIDE THE FAILING REGIME.** Its
one sample is chrome 32/30, where the real room is **125px** against a 120px
floor. The scenario written to prove the bound could not see a floor that
defeats it, because it sampled just above the threshold — the same
"both endpoints clean" sampling defect #275 was itself about, in the test added
by #275. **A guard's test has to be run in the regime where the guard binds**,
and for a clamp that means on both sides of the clamp.

**2. The bound was frozen as a pixel value at open time.** It overrides
`.k-menu`'s responsive CSS fallback, so a menu opened tall and then shortened
keeps a height the viewport no longer has, and nothing closed or re-measured
it. Measured: opened at 740x900 the bound is **788px**; shrink to 740x300 and
the menu stays open at **788px**, **38px past** the viewport, **"Documents"
unreachable** after scrolling. A `resize` listener now re-measures every open
panel. **Re-measuring rather than closing is deliberate** — mobile browsers
fire `resize` when the URL bar shows or hides, and closing a menu mid-use is a
worse answer than keeping it bounded. A popover whose wrap the breakpoint has
hidden (the compact nav above 1129px) is closed instead, so it cannot reappear
already open on the way back down.

⛔ **ONE RESIDUAL, FOUND BY THE SWEEP AND NOT BY EITHER FINDING, DELIBERATELY
NOT FIXED.** At chrome 56/54 the panel's top measures **303px in a 300px
viewport** — the app bar itself is below the fold, so `max-height` cannot help
whatever its value, and "Documents" is stranded again. The fix is to anchor the
panel to the **viewport** rather than to its trigger, which is a repositioning
design, not a clamp. S30 **asserts its own armed precondition** (`room > 0`) and
names this residual in the failure message, so if the regime is ever entered the
scenario says it is testing the residual instead of silently passing — the same
shape as S28's precondition and S29's named 320px exclusion.

⚠️ **THE SAME PROBE TRAP THREE TIMES IN ONE SESSION, with it already recorded
in this file.** `page.goto` to the same URL **and hash** does not reload the
document, so a menu left open survives into the next step and the next click
toggles it **shut**. It hit the first measurement probe (rows alternating
open/closed — the giveaway was the perfect alternation), then the verification
probe, then S30 itself, where the resize block ends with a menu deliberately
open *because that is its claim*. Each failure reads as "the compact nav did not
open", i.e. as an app defect. Every block that follows one which leaves a menu
open now closes it explicitly and asserts a known-closed starting state.

⚠️ **AND THE FIRST VERSION OF THE RESIZE ASSERTION WENT FLAKY ON WEBKIT, by
sleeping through two state changes instead of polling them.** A flat 150ms for
the resize handler and 120ms for the panel's scroll: on `iphone` the re-bound
had landed (`past` was fine) while the scroll had not, so the last link measured
below the fold and the failure read **"destinations unreachable after a resize:
Documents"** — an app defect that was not one. Both are now polled to a settled
state, bounded, so a genuinely unreachable link still fails. 16/16 on
`--repeat-each=2` across four projects afterwards.

### ⛔ NOT BUILT, deliberately — a sprite-reference guard, and why the cheap one is the wrong shape

The `icon()` finding above is a defect CLASS, not a one-off: an unknown name
renders an empty `<svg>` with no error, no exception and no failing test. S29
closes it for the app bar — the surface this change touched — and nothing covers
the other hundred-odd call sites.

**Measured before deciding** (2026-10-15): **87** call sites pass a string
literal and **33** pass a variable, the latter fed by `content/coverage.json`
and `questionnaire.json`, by `ASSET_META`, and by `entityAvatarIcon()`.

**The cheap version is the wrong shape, and that is the whole point.** A guard
checking the 87 literals and skipping the 33 variables is this repo's own
most-repeated defect — the scanner that under-reports — which
`privilege.test.mjs` was redesigned over five rounds to escape and
`check-keep-back-routes.mjs` twice before it. Both arrived at the same rule:
**anything the scan cannot account for must fail BY NAME**, not be skipped.
Here that means resolving three data sources plus the content JSON, which is a
guard with its own semantics and its own mutation tests — a separate change,
reviewable on its merits, not a fifth surface on a nav fix.

**What it would take**, so the next session does not re-derive it: parse
`id="icon-…"` from `index.html` for the symbol set; take the literal
`icon("…")`/`iconBadge("…")` names; resolve `ASSET_META`'s `icon:` values,
`entityAvatarIcon`'s three returns and `KEEP_NAV`'s `icon:` values; resolve the
`icon` fields in `content/*.json`; and fail by name on any call site whose
argument it cannot read. One fact already established: a repo-wide diff of used
names against sprite ids found `menu` to be the **only** missing symbol, so the
guard goes green on its first run — it is a ratchet against regression, not a
backlog of existing breakage.

**Was, for the record:**

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
| Key selectors | home: `.hero h1` · choice steps: `.choices .choice` · contact: `#contact-name` (built as `contact-${f.id}` from `content/questionnaire.json` — grep for the literal finds nothing) · summary: `.need`, `.disclaimer` · error: `.error` · Keep: `.k-authcard` (login card), `.k-error` (login failure), `.k-welcome__h` (signed-in home heading — **not** `.k-h1`, which is on the inner pages only), help desk: `.k-help__input` (ask box), `.k-help__a` (answer), `.k-help__notice` (unavailable), `.k-help__ai` (the AI-generated label — present in BOTH states, and on an ANSWER it also names the model: *"… by Anthropic (Sonnet) from this app's help guide …"*). ⚠️ **`.k-help__tier` NO LONGER EXISTS** — it was a broker-only "Answered by …" line until 2026-10-14, when the model was folded into `.k-help__ai` for every caller; its CSS rule went too, so a selector on it now matches nothing (the `.card` failure this table already records), app bar nav: `.k-nav` (the wide strip, visible **only above 1129px** — the figure was 1044 until 2026-10-15, when `scrollWidth` was found to under-report the bar's intrinsic need), `.k-pop--nav` (the compact control that replaces it at or below 1129px; trigger `.k-pop--nav button`, panel `.k-pop--nav .k-menu`, open state `.k-pop--nav.is-open`). ⚠️ **The two are exact inverses**, so a Keep nav assertion written against `.k-nav` matches nothing on the `tablet` (810px), `mobile-chrome` (393px) and `iphone` (390px) projects — only `desktop` is above the breakpoint. That is three of four projects silently matching nothing, the `.card` failure this table already records, model tier control: `.k-tier` (absent entirely for a client), `.k-tier__opt` (three), `.k-tier__opt.is-on` (the stored tier — **none** while it is unread), `.k-tier__status`. ⚠️ Target an option by its `<b>` label, not by the button's text: `hasText: 'Opus'` matches TWO buttons because Sonnet's blurb reads "Half the cost of Opus", and the strict-mode violation surfaces as a click TIMEOUT that reads like an app hang |

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
| S20 | Help desk — a CROSS-TAB auth change (offline harness, **runs locally**) | Two real tabs in ONE browser context, so they share storage and the BroadcastChannel. Tab 1 asks with the response held; tab 2 signs out and back into the **same** shared account; tab 1's held response is then released and must not render or cache. ⚠️ `signIn`/`signOut` bump the login generation only in the tab that calls them — the client broadcasts the change to the others, so a same-tab-only epoch left tab 1 holding a stale one and every check passed. | An auth change in another tab does not end this tab's Help session |
| S21 | Help desk — an answer ALREADY RENDERED is cleared (offline harness, **runs locally**) | Tab 1 asks and **receives**; tab 2 signs out of the shared account; tab 1 is never touched again. The answer, its credits and the question must leave tab 1's page on the broadcast alone. ⚠️ Distinct from S20: there the epoch stops the answer being WRITTEN, here it has already been written and rendered, and the epoch guards neither. | The previous person's answer stays on screen after their session ended elsewhere |
| S22 | The Keep — a dispatch that outlives its session (offline harness, **runs locally**) | A cold `#/keep/list` navigation parked inside `ensureData()` (the first `/rest/v1/entities` request held open); tab 2 then signs the shared account out. Tab 1 must re-dispatch to the login card, and when the parked load is released the superseded dispatch must **not run at all** — asserted on the absence of a `route error:` console log, because the layered cache fix (S23) masks the DOM assertions. | A Keep page mounts under no session, or a superseded dispatch runs and throws |
| S23 | The Keep — a data load that outlived its login (offline harness, **runs locally**) | Same park, then a **different** client signs in on tab 1 and their tree fills the cache; the first client's load is then released. Its tree must never reach `cache`: asserted on the app's own `getUser()` through a dynamic import of the same module URL (bounded poll, decided in both directions) **and** on what the next render shows ("Welcome back, Other", never "Demo"). | The previous client's entities, assets and policies are served to the next person to sign in |
| S24 | Help desk — a settling ask releases only ITS OWN gate, shared account (offline harness, **runs locally**) | A asks (held); A signs out; the next person signs in on the **same prefilled credential** and asks their own question, which must reach the endpoint; A's older response is released FIRST. Their controls must stay **disabled** while their own call runs, and re-enabling them in the page and calling `form.requestSubmit()` must not raise the endpoint's request count — then their own answer lands and the desk unlocks. ⚠️ Distinct from S16, which is this shape with a DIFFERENT client and so passes against an owner-keyed gate: only the shared credential makes two people one owner id. | A departed person's settling ask re-enables the next person's form mid-call, letting a second paid provider call through |
| S25 | Help desk — a render parked on the CORPUS when the session ends (offline harness, **runs locally**) | Hold `content/help-guide.json`, start the first Help visit, then sign out **in the same page** through the app's own exported `signOut()` — the hash never changes, so neither the render generation nor the hash check can see it. Release: the login card must survive, no `.k-help__input` or `.k-help__ai` may mount, and **no `route error:` may be logged** — that last one is the only assertion that fails when the epoch check is deleted, because the DOM is otherwise saved by an accident (the stale build throws into `route()`'s generation-guarded catch). | An authenticated Help form mounts over the login card, or the stale render runs and throws instead of being refused |
| S26 | Help desk model tier — the BROKER CONTROL (offline harness, **runs locally**) | A CLIENT sees no `.k-tier` at all, and the rest of Security is untouched. A BROKER sees three `.k-tier__opt`s and a status naming the **stored** tier — the fixture stores the NON-default Sonnet, so a control rendering the default without reading anything fails. Clicking Haiku sends a PATCH whose keys are **exactly** `['model']` (sending `updated_at`/`updated_by` would be refused 42501 by the live column grant while passing any fixture that ignores extra keys) and the row moves. A DENIED write **reverts** the selection to what is stored. A table denied from the start reports "Could not read the current tier" with **nothing** selected and all three options disabled. ⚠️ It cannot test a POLICY — the denials are measured in the migration's probe footer as real `authenticated` sessions | A client is shown the admin control, the control reports a tier it never read, a refused write leaves the screen claiming a tier the row does not hold, or the write carries a column the live grant refuses |
| S27 | Help desk model tier — the ANSWER names the model, to EVERYONE, inside FR-10's sentence (offline harness, **runs locally**) | A CLIENT payload carrying `model` renders exactly one `.k-help__ai` reading *"AI-generated by Anthropic (Haiku)"* **and** still carrying FR-10's own tail ("check anything important with your broker") — both asserted, because a check for the model alone passes a mutation that drops the rest of the sentence. A BROKER sees the **same** thing, which is what proves the old role gate is gone rather than inverted. An id this build does not know is shown **verbatim**. A payload with **no** `model` renders the plain sentence with **no empty parenthesis**. ⚠️ Still the only end-to-end proof a stored tier is IN USE: FR-17 makes a tier the deployed function never read look exactly like one it honours. ⚠️ Inverted 2026-10-14 — it previously asserted a broker-only `.k-help__tier` and its ABSENCE for clients | Any caller is not told which model answered, FR-10's wording is lost when the model is folded in, an unrecognised id is rounded to a tier that is not in use, or a missing model renders "Anthropic ()" |
| S28 | A cancelled policy is never shown as active (offline harness, **runs locally**) | **Four** seeded policies — in force, **cancelled with a FUTURE renewal date**, status never recorded, and a status that is neither affirmative nor terminal (`pending`), which must render **verbatim and NEUTRAL** rather than as ended cover. Dates come from `dayOffset()`, and the scenario asserts its own **precondition** (the cancelled policy's renewal date is still in the future) so it fails by name instead of quietly ceasing to test anything. It also checks the **landing page's** "Active policies" and "Lapsed" tiles, and that the Policies tile's subtitle never calls a dated policy "undated". On `#/keep/insurance` the cancelled row's `.k-exp` reads "Cancelled" and **not** "Active", the no-status row reads "Status not on file" and not "Active", the in-force one still reads "Active · renews", and the **Active tile counts 1, not 3**. Then the policy detail page (`.k-pg dt:text-is("Status") + dd` and `.k-phead .k-exp`), the **asset** page's `.k-pcard`, and the **landing** page's two at-a-glance counters — **six** readers of one fact, in three files. ⚠️ The future renewal date is deliberate: with a past one the date logic alone renders "Expired" and the scenario passes against unfixed code. ⚠️ It exists because **four view mutations survived 392 green unit tests**, two of them reverting a call site to `expiryBadge(policy.renewalInDays)` — the original bug, in one character | Any reader shows a cancelled or status-less policy as active, the Active tile counts policies that are not in force, or a call site is reverted to the bare renewal date |
| S29 | The Keep's primary nav survives every width, and the bar never overflows (offline harness, **runs locally**) | At 1280px `.k-nav` is visible and `.k-pop--nav` hidden; across **19 widths — 320, 360, 382, 386, 390, 414, 480, 481, 500, 520, 560, 561, 600, 760, 761, 810, 900, 1024, 1129** — that inverts, with `scrollWidth <= clientWidth`, the logo at its natural width, no 44px control shrunk, and **the wordmark never truncated** at each. ⚠️ Both sides of every media-query boundary are sampled, because #275's defect lived entirely between 480 and 600 and both endpoints were clean. ⚠️ The wordmark check is the one that catches it: a shrinkable wordmark turns an overflow into an ellipsis, which every `scrollWidth` assertion reports as a pass. The band **resizes rather than re-navigating** (media queries re-evaluate on resize; 19 `goto`s cost ~17s against a 30s per-test budget), and the menu INTERACTION — opens, panel on-screen, hrefs **EQUAL AS A SET** to the strip's, Escape closes, `aria-expanded` tracks — runs at one width per layout regime (360, 481, 810, 1129). 1129/1130 are asserted as a **pair**. A menu link navigates, and **no app-bar `<use href>` resolves to nothing**. ⚠️ 382 is in the list deliberately: at 385 the wordmark's shortfall is 1px and the tolerance absorbs it, so the mutation reverting that breakpoint survived a band that sampled 385/386 | Any width shows both navs or neither, the Keep scrolls sideways, the wordmark ellipsises, the logo or a touch target is crushed, the compact menu's destinations drift from the strip's, Escape stops closing it, or an app-bar icon names no sprite symbol |
| S30 | The brand sacrifice is app-bar only, and menu panels respect their real top (offline harness, **runs locally**) | Signed OUT **in a fresh context** (`localStorage` is shared, so a second page on the seeded context is already signed in and renders the home view — the first version failed with "the login card did not mount", which reads as an app defect), the login card keeps its `.k-abrand .k-tag` badge at 390, 481, 810, 1129 and 1280: the sacrifice order belongs to the app bar, and an unscoped `.k-tag { display: none }` stripped the badge from the authentication screen at every width 320-1044. Then at 740×320 with the chrome enlarged to 2x, the open panel's bottom stays within the viewport and no destination is stranded after scrolling it — `calc(100vh - 124px)` subtracts an ASSUMED top and measured 39px past the viewport. ⚠️ Split out of S29 because that test hit 17-22s against a 30s per-test timeout and a comment-only control mutation "failed" on a timeout. Then at chrome **40/38 and 48/46** the applied bound must not exceed the measured room — `Math.max(120, room)` defeated its own bound below 120px, measured 27px past with "Documents" stranded, and **the 32/30 sample above passed throughout because its real room is 125px**, four pixels outside the failing regime. Each scale asserts an **armed precondition** (room is positive, and under 120) so it fails by name rather than quietly ceasing to test the clamp. Then a menu opened at 740x900 and resized to 740x300 must be **re-measured, not left frozen** (788px stale, 38px past, "Documents" stranded) and must **stay open** — a mobile URL-bar show/hide fires `resize`. Then crossing the breakpoint while open **closes** the popover and clears `aria-expanded`. ⚠️ Both of the latter poll for a settled state rather than sleeping: a flat wait made the resize block flaky on webkit, failing as "destinations unreachable" when only the panel's scroll had not landed | The login card loses its badge at any width, an enlarged ribbon or text size pushes a menu panel past the viewport and strands its last link, a bound measured at open time survives a viewport change, or a popover the breakpoint hid is left open |
### ⚠️ THE REPOSITORY IS PUBLIC, AND `.claude/settings.json` WAS WRITTEN AS IF IT WERE NOT (measured 2026-10-15)

Measured during `/refresh-repo`, from `GET /repos/akyachtsman/claude.insurance`:
**`visibility=public`, `private=false`**. Nothing in this file had ever said so, and
17 pre-approved tool grants had been written on the opposite assumption.

`global.md` → *Scheduling Tools Never Prompt* admits a tool to `permissions.allow`
only if it passes two tests, the second being **"does it return content an outsider
can write?"** On a public repository anyone can write issue and PR bodies and
comments, a PR branch's files and commit messages, and what a PR's CI prints — so a
read that hands that text to an agent removes the prompt standing in front of text
an attacker may have authored. The directive admits those reads **for a private
repository only**, and gates the `search_*` family **everywhere**, private
repositories included (owner ruling 2026-10-07): an unqualified search spans all of
GitHub, so what it returns is unbounded by this repository's visibility.

**Removed this refresh — 17 entries**, leaving 37:

| class | entries |
|---|---|
| `search_*` — gated everywhere by ruling | `search_code`, `search_issues`, `search_pull_requests`, `search_repositories`, `search_users`, `search_commits` |
| outsider-content reads — private-only | `get_file_contents`, `list_commits`, `get_commit`, `list_pull_requests`, `pull_request_read`, `list_issues`, `issue_read`, `get_check_run`, `get_job_logs`, `actions_get`, `actions_list` |

What stays is the scheduling set and the reads whose content only a collaborator
writes (branches, tags, releases, labels, collaborators, teams, issue types and
fields, `get_me`), plus `get_trigger` and `read_documentation` in both server-name
spellings, which upstream added and this repo was missing.
⚠️ Settings load at **session start**, so this takes effect in the NEXT session; the
one that made the change keeps whatever it already had.
⚠️ A session that needs one of the removed reads still gets it — it prompts, which
is the point. Do not re-add an entry to stop a prompt.

⚠️ **AND IT SHARPENS THE PUBLISHED-CREDENTIALS ITEM, WHICH THIS FILE HAS NEVER
STATED CORRECTLY.** The invite-runbook entry says *"this file publishes their
passwords"* and weighs that as an internal exposure. It is not: `CLAUDE.md` is
world-readable, so the client, broker and underwriter passwords for a live Supabase
project are published **on the open internet**, and have been for as long as they
have been in the file. The precondition that made it acceptable — three
`@example.com` rows and no real client data — expired with the 2026-10-15 test
invite. Rotation is no longer a before-the-first-client item; it is overdue.
(Branch-source Pages publishes the whole repository at the public URL too, so the
file is served from `akyachtsman.github.io/claude.insurance/CLAUDE.md` as well as
from GitHub.)

✅ **`allow_auto_merge` IS ON — turned on by the owner 2026-10-15, measured from
the API rather than taken on trust** (`GET /repos/akyachtsman/claude.insurance` →
`allow_auto_merge: true`, `delete_branch_on_merge: true`, `allow_squash_merge:
true`). It was `false` for as long as this repo had existed, and `git.md` →
*Repo-settings preflight* says to warn once, which is why the paragraph was here.

**What changes in practice:** `git.md` → *Conditional Auto-Merge on Green* is now
executable as written — a session enables auto-merge on the PR and GitHub merges it
when the checks pass, instead of the session having to stay alive through the whole
CI run and squash-merge by hand. That fallback is what every merge in this repo has
actually used, #279 included.

⚠️ **PASS THE MERGE METHOD EXPLICITLY — `squash`.** Measured in the same call:
`allow_merge_commit` and `allow_rebase_merge` are **also** true, so the repo permits
all three and nothing here forces the convention. Every merge in this repo's history
is a squash (`#254`, `#256`, `#258`, `#268`, `#274`-`#276`, `#279`), so a plain
auto-merge enable that inherits the repo default would quietly start producing merge
commits. `enable_pr_auto_merge` takes the method; name it.

⚠️ **AND A DRAFT CONVERSION SILENTLY DROPS IT**, which this repo will hit because it
opens every PR as a draft: auto-merge does not survive `ready_for_review` → draft →
ready. Re-enable it after any such round trip rather than assuming it held.

⚠️ **It is a repo SETTING, not schema** — the same blind spot class this file
records three times already (public sign-up, custom SMTP, the Auth templates).
Nothing in this repository goes red if it is switched back off; the only check is
re-reading the API, which a session CAN do here (unlike the Supabase ones), so
`/env-chk` is the place for it.

### ⚠️ `.github/scripts/package.json` DECLARES `"type": "commonjs"`, AND THIS REPO HAD AN ESM GUARD THERE (2026-10-15)

Found by running the gates after installing it, not by reading it. The derivation in
`/refresh-repo` names `.github/scripts/package.json` whenever a caller runs a
CommonJS script there — correctly, and installing it **broke
`check-keep-back-routes.js` immediately**:

```
SyntaxError: Cannot use import statement outside a module
```

**Why it had worked without the manifest:** this repo has **no root
`package.json` at all** (measured), so Node applied its own default and an ESM
file with `import` was tolerated by extension alone. Upstream's own comment states
the manifest's purpose as protecting CommonJS scripts from a root
`"type": "module"` — the opposite direction — so a repo with no root manifest gets
the constraint without the problem it solves.

Measured module style of the six `.js` files there: **five CommonJS** (upstream's
`browser-ladder`, `check-contrast`, `check-ui-viewports`, and this repo's
`check-asset-manifest`, `check-undefined-calls`) and **one ESM**, this repo's own
`check-keep-back-routes`.

**Fixed by renaming that one file to `.mjs`**, which overrides the manifest's
`type` per-file, matching what this repo already does for `js/**/*.test.mjs`. The
manifest stays, because it is what keeps the five CommonJS scripts working if a root
`package.json` is ever added. Seven files referenced the old name (`qa.yml`, two
Edge Function tests, the Playwright spec, `shell.js`, this file, and the guard
itself) and all seven were updated.

⚠️ **The generalisable bit:** a template installed because something *names* it can
carry a constraint on files the template has never heard of. The derivation is right
to install it; the check is to run the gates afterwards.

⚠️ **CORRECTION, 2026-10-15 — this paragraph said "nothing static would have caught
this — `node --check` parses a module fine", and THAT IS FALSE.** Measured here on
Node 22.22.2, on an identical probe file, after DIR9 reported it
(`claude.directives#455`):

| where the probe sat | `node --check` |
|---|---|
| `.github/scripts/` (manifest present) | **exit 1**, `SyntaxError: Cannot use import statement outside a module` |
| the repo root (no manifest) | exit 0 |

**Why I got it wrong, since the mechanism is the interesting part:** `node --check`
only parses — true — but the manifest changes *which grammar it parses against*. With
no `package.json` Node detects ES syntax and accepts it; under `"type": "commonjs"`
the same bytes are a syntax error. So the claim was true of the state BEFORE the
install and I asserted it as a property of the tool. That is this file's most
repeated defect — a fact about one state written as a general one — and I wrote it in
the very section recording the install.
**What follows practically:** `node --check .github/scripts/*.js` is a real guard for
this class and costs nothing. Not added here, because the five CommonJS files are
upstream's and already exercised by `qa.yml`; the one ESM file is now `.mjs` and
would be skipped by a `*.js` glob anyway. Run it by hand after installing the
manifest in any repo, which is what upstream's `cicd-setup.md` Step 1 now says.

⛔ **RETRACTED WITHIN THE HOUR — I DISMISSED DIR9'S SECOND WARNING ON A WARM-CACHE
MEASUREMENT, AND CI WENT RED FOR EXACTLY THE REASON IT GAVE.** This paragraph said
the `npx html-validate` peer-dependency failure "does not apply here — measured, not
assumed", on the strength of `npx --yes html-validate@11.5.6 index.html` exiting
**0** from three working directories. That measurement was real and it was
**worthless**: every one of those runs used an **already-warm npm cache**.

**What the red run was.** `Unit Tests + HTML Validation` failed on `5eb49a4` at the
**Validate HTML** step (unit tests passed), run `38784051580`. `index.html` is
**byte-identical** between that commit and the green `aa996d1` before it
(`git diff --quiet aa996d1 5eb49a4 -- index.html`), and the commit touches only
`pages-retry.yml`, `CLAUDE.md` and `directive-sync.json` — so nothing html-validate
reads had changed. The job log is unreadable from a session (the logs endpoint
redirects to blob storage this `gh` will not contact), so the annotation said only
*"Process completed with exit code 1."*

**Reproduced locally in one call, by giving npm a COLD cache** — two runs a minute
apart, separate cache directories, nothing else different:

| run | result |
|---|---|
| cold cache, plain | **exit 1** — `npm error Cannot read properties of null (reading 'edgesOut')` |
| cold cache, `npm_config_legacy_peer_deps=true` | **exit 0** |
| warm cache, either | exit 0 |

The stack names the cause precisely: `#loadPeerSet` in
`@npmcli/arborist/lib/arborist/build-ideal-tree.js:1289` — a **crash inside npm's
peer-dependency resolver**, not an `ERESOLVE` conflict it reports and recovers from.
`legacy-peer-deps` skips that code path, which is why it is the fix and why the
"there is no vitest here" half of my reasoning was beside the point.

⚠️ **AND THE SENTENCE THAT USED TO END THIS PARAGRAPH WAS STILL HALF WRONG.** It read
*"the crash is in the resolver, not in a specific conflict"* — which is how the stack
reads and is not what upstream measured. `claude.directives#455` names the conflict:
**since vitest 5.0.5, npm 10 crashes resolving html-validate's optional peers.** The
vitest is **html-validate's own optional peer**, not anything in this repo — which is
exactly why my `grep -rn vitest` over the project found nothing and why I concluded
there was no conflict to find. A dependency that is not in your tree can still be in
your *resolution*. So the right correction to "there is no vitest here" was never
"the conflict is irrelevant"; it was "you are grepping the wrong tree."

**Fixed** by `npm_config_legacy_peer_deps: 'true'` on that step's `env` in `qa.yml`,
with the measurement in the comment beside it.

⚠️ **The lesson is not "listen to DIR9" — it is the state-dependent measurement.**
A cold cache is the CI condition and a warm one is the local condition, so every
local run was answering a different question than the one asked. This file records
the same shape at least four times already (*"no webkit in the image"* read off a
directory listing, the auth-gate window, the `source`-filtered log absence, and
`node --check` in the paragraph directly above). **A green run on a warm cache is
not evidence the flag is unnecessary; the only informative test is a cold one.**
⚠️ And note the order: the remedy was in hand, from a peer, BEFORE the failure —
and was argued away. A warning dismissed on a measurement that cannot see the
failure mode costs the same as no warning at all.

### ⛔ OPEN (owner decision) — the kit's helpers moved into `tests/lib/`, and taking them costs a documented divergence

**This is the one thing `/refresh-repo` did not take, on 2026-10-15 at `8c1a398` and
again the same day at `f680dd3`.** Recorded rather than decided because it changes the
core of the whole UI suite and because the two ways out each give something up.

⚠️ **AND THE WAY IT IS RECORDED CHANGED ON THE SECOND REFRESH, which is the part worth
reading.** The first refresh declined it by **holding the stamp back** at `bbfdcfc` —
and that cost something the next refresh paid: a held-back stamp makes every
genuinely-stale file classify as **CUSTOM** rather than `STALE`, because `CUSTOM` means
"differs from the template at the stamp too". Two files
(`.github/scripts/package.json`, `.github/scripts/check-ui-suite-env.py`) came up
CUSTOM at `f680dd3` and both turned out to be **byte-identical** to the `8c1a398`
templates — a classification artifact, not a local edit, provable only by hashing the
local blob against the template at the head it was actually taken from. So a deliberate
deferral is now recorded as **`refresh_kept` entries with a revisit trigger** and the
stamp advances: `.github/scripts/ui-tests/tests/` (the whole tree, which subsumes
`tests/lib/`) and `.github/scripts/ui-tests/playwright.config.js`; an un-advanced stamp
degrades every later classification instead.
**REVISIT TRIGGER, written into the record so the exception cannot outlive its reason:**
the owner rules on A/B/C, **or** `TEST_AUTH_READY_REQUEST` is set as a repository
variable — which arms the `awaitAuthReady` defect below — whichever comes first.

⚠️ **AND THE SENTENCE THAT USED TO SIT HERE WAS FALSE — THE COMMENT-OVERCLAIMS-CODE
DEFECT, WRITTEN INTO THE RECORD OF A DEFERRAL, IN THE SECTION ABOUT RECORDING IT
HONESTLY.** It read: *"The record stops binding the moment upstream or the local file
changes, which is what a deferral should do."* **The upstream half is true and the local
half is not**, for the directory-keyed entry — and the asymmetry is in the refresh
script, not only in what I wrote. Found by Codex on #281 (P2), verified here rather than
taken on its word:

| record form | what the script matches on |
|---|---|
| a FILE entry, via `check()` | `.blob == $b` **and** `.local == $l and $l != ""` — and its comment says why: *"a later edit or a replaced file never inherits an old approval"* |
| a DIRECTORY entry, via `kit_dir_kept()` | `.tree == $t` **alone** — no `local` is read at all |

**Measured, three ways, on the real jq filter** (the stamp script itself refuses to run
now, upstream having moved to `f0e2838`, so the filter is the instrument): as recorded
it **binds**; with a deliberately WRONG `local` added it **still binds**; with a wrong
UPSTREAM tree it correctly does **not** bind, which is what stops the test being
vacuous.

⚠️ **So Codex's recommended fix — "store the local tree hash alongside the upstream
tree" — is INERT as stated**, and writing it would have looked exactly like the fix
while changing nothing. That is this repo's own most-repeated trap (the round-19
duplicate listener, the first `pageErrors` filter), met in a remedy. The local tree
hash is recorded anyway, because it is the value a future reader needs to re-review the
entry by hand — but it is labelled in the record as **read by nothing today**, which is
the honest form.
**The enforcement gap is upstream's** (`kit_dir_kept` wants `check()`'s `local` guard)
and is written up for upstream — ⚠️ **WRITTEN, NOT YET SENT** — at
`docs/upstream-findings/kit-dir-local-guard.md`.
⚠️ This line said "**is reported there**", of a note that had never left this
repository, and pointed at `.agent-reports/`, which is gitignored and so was not
in the tree at all. Both halves are the same defect: *a note's existence read as
its delivery.* Found by Codex on #284 (P2) — correctly, and on the change whose
whole purpose was making the note findable.

**What upstream did** (`8c1a398`, batch C/S2): `templates/ui-tests/tests/app.spec.js`
dropped from 2,623 lines to 1,269 by moving its helpers into two new files —
`tests/lib/fixtures.js` (515 lines) and `tests/lib/auth.js` (1,124) — which the spec
now imports. Taking it means adding those two files, adding the import block, and
deleting the inline copies **together**: the imports without the deletions declare
each helper twice, a SyntaxError that fails every scenario.

**Why it is not mechanical here.** This repo's `app.spec.js` is **4,983 lines** — the
stamp-era kit plus S5–S30 — so the migration deletes ~1,400 lines from a file
carrying 26 project scenarios. And one local divergence collides head-on:

| | upstream `lib/auth.js:25` | this repo |
|---|---|---|
| `AUTH_CREDENTIAL` | `process.env.TEST_AUTH_CREDENTIAL \|\| null` | `… \|\| readCredentialFromClaude() \|\| null` |

`readCredentialFromClaude()` is a deliberate divergence (*"Kept so local runs work
without the secret"*), and `AUTH_CREDENTIAL` is consumed **inside** `lib/auth.js` by
`detectAndAuth`, `gotoAndAuth` and `gateShipsCredential` — so an importer cannot
override it. The options:

- **(A) Take the lib verbatim and drop `readCredentialFromClaude()`.** Clean, and
  `/refresh-repo` keeps the file in step forever after. Cost: a local Playwright run
  without `TEST_AUTH_CREDENTIAL` set loses its credential, so the auth scenarios
  self-skip here.
- **(B) Take the lib and edit that one line.** Keeps local runs working. Cost: the
  vendored lib is `CUSTOM` from the day it lands, which is exactly the drift the
  extraction was meant to end — and it needs its own `refresh_kept` reason.
- **(C) Defer.** The suite keeps working as it does today (124 tests list, 394 unit
  tests pass), and the stamp stays at `bbfdcfc` so the next refresh sees this delta
  again rather than skipping past it.

⚠️ **What deferring actually costs**, since it is the default: the better
`awaitAuthReady` stays unadopted — upstream's resolves on `requestfinished` where
this repo's resolves on `response`, so an app whose session payload streams is marked
ready before the gate can render (Codex, #438). `TEST_AUTH_READY_REQUEST` is unset in
this repo, so nothing is broken today; it is a trap armed for whoever sets it.

⚠️ **`playwright.config.js` is in the same bundle** and is also unapplied: upstream
now derives the screenshot directory from `GITHUB_WORKSPACE` rather than a hardcoded
`../../../`, which only works when the kit sits at exactly `.github/scripts/ui-tests/`
— it does here, so this is latent rather than live. It has its own `refresh_kept` entry
with the same revisit trigger, because it is not separable from the migration in
practice.


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
| `check-contrast.js` carries two project-specific `.k-ilink` pairs | ⚠️ **The ORIGINAL divergence is resolved and a DIFFERENT one now stands in its place — do not read the old row's "delete after one more sync" as applying to this file any more.** Upstream adopted `css/tokens.css` as a default and takes `--tokens <file>`, so that half is gone. What makes the local copy `CUSTOM` at `8c1a398` is two added pairs: `accent-hover / bg` and `accent-hover / accent-light`. `.k-ilink` is 14px/700 body text, so it answers to AA and not AA_LARGE, and it renders on the page background and on the accent tint, never on surface — checking only `accent / surface` (4.65) passed while these two measured **4.26** and **4.03**, and one of them is the Help desk's broker hand-off, i.e. the remedy the whole fact/advice boundary routes a client to. `design.md` → *Accessibility* asks each project to read the pair list against its own token roles and to derive pairs from its own components, so this is the directive being followed. The file is otherwise verbatim; upstream's template did not change at this head. |
| `qa.yml` has a `unit-tests` job | No upstream equivalent. `node --test` over `js/**/*.test.mjs` plus `html-validate` — a deterministic blocking gate needing no browser or backend (#202). |
| `qa.yml` `UI_PATHS` uses `css/` | Upstream's breadth, this repo's directory names. The **previous local regex matched only `index.html`**, so a PR touching nothing but `js/` or `css/` set `ui=false` and skipped the browser job entirely — on an app that is almost entirely `js/` and `css/`. Fixed by adopting upstream's shape. |
| `cron-notify.yml` is **absent** (not a deliberate divergence — a gap) | `global.md` → *Repo Structure Standard* lists it among the **8 unconditional** workflows; this repo has the other 7 plus `pages-retry.yml`. **Inert today:** no workflow here has a `schedule:` trigger, so there is nothing for it to notify about, and `workflow-ref-guard` stays green because nothing references it — exactly the blind spot that guard cannot see. Install it with the first scheduled workflow, or record it here as deliberate. Found by `/audit-repo` 2026-10-05. |
| ~~`awaitAuthReady` consults an already-arrived response~~ **RESOLVED — ADOPTED UPSTREAM AND IMPROVED ON, measured 2026-10-15** | The bug this repo found (Codex, #253) is fixed upstream, in `templates/ui-tests/tests/lib/auth.js` at `8c1a398`: `armAuthReady(page)` starts recording BEFORE `goto()` and `awaitAuthReady(page, armed)` reads the recording first, with `gotoAuthReady()` doing all three in the one order that works. ⚠️ **Upstream went further and this repo's local fix is now the WEAKER one:** theirs resolves on `requestfinished`, not `response`, because `response` fires once status and headers arrive — before the body downloads — so an app that streams or parses a slow session payload was marked ready before the code awaiting that body could render the gate (Codex, #438). ⚠️ **Taking it is NOT a copy-and-paste** — it arrives only with the kit-helper migration, which is the open question below. |
| `renderWitness` extended to S5–S10 | Upstream's fixture ships on its own four scenarios (NAV/CTRL/ENTRY/DISMISS), which this repo deliberately does not carry — so adopting it verbatim would have left **every** scenario here witness-less and the viewport gate reporting SCHEDULED-only forever. Upstream's own rule is "EVERY scenario below requests `renderWitness` AND calls `renderWitness();` as its first statement", so extending it to S5–S10 is following that rule, not diverging from it. Measured 2026-10-06: `disposition: RENDERED laptop,tablet,phone`. |
| S9 keeps its own auth assertions | S9 reads the prefilled password back before overwriting, and asserts the form *was* prefilled. The generic kit has no notion of "the form already holds a working credential" and fills destructively — an upstream gap this project's login proves. S9 is the reference implementation; do not replace it with the generic verifier. |

### ⚠️ A REPORT ADDRESSED TO A PEER SESSION HAS NO MAILBOX, AND A GITIGNORED FILE DIES WITH THE SESSION (2026-10-16)

Two upstream reports were written on 2026-10-15 — the `kit_dir_kept()` binding
gap and the `pages-retry.yml` annotations suggestion — and both sat in
`.agent-reports/`, which is **gitignored**, addressed to a peer session (`DIR9`)
that was **not running**. `ListAgents` returns no peers and a `SendMessage` to a
session that does not exist is refused, so there was nothing to deliver to and
nothing on disk that would survive the session. A finding carefully measured
over three rounds had a half-life of one context window.

**Fixed structurally, not by remembering:** they are committed at
`docs/upstream-findings/`, whose README carries the lifecycle (written → sent →
deleted on adoption) and the reason the directory is not `.agent-reports/`.
`raw.githubusercontent.com` and git transport both work from a session
(measured), so any later session can read them; general HTTPS does not, which is
why those two are the only channels named.

⚠️ **This is STORAGE, NOT DELIVERY, and the README says so in its own last
section.** Each note is still owed to `claude.directives`, and this repo's
sessions cannot open an issue there — `global.md` → *Repository Scope* makes READ
unrestricted for a public repo and **ACT** hard-limited to this one. So the send
is the owner's, or a session running in that repository's own scope. Committing
the note must not be read as closing the item.

⚠️ **BOTH NOTES WERE RE-MEASURED BEFORE PUBLISHING, AND ONE WAS WRONG.** The
`pages-retry.yml` note quoted `$newest` — the variable name from this repo's
**pre-adoption** local version — where the template uses `$counting`, and cited
a blob (`8b903a7`) the file had already moved past twice. A note quoting a name
the file does not use reads as describing a different file, which is this repo's
most-repeated defect pointed at somebody else's code. Every quotation now names
the upstream head it was taken from, and the README makes re-reading the template
a precondition of sending.

**What the re-measurement established**, against upstream `main` =
`e78b6dd58796b4aa68056fb99e2416ed8f8d8f88` (git transport, 2026-10-16):

| claim | result |
|---|---|
| `kit_dir_kept()` still selects on `.tree` alone | **still open** — and at every cached head from `5342fa9` to `e78b6dd`, so not a transient |
| `pages-retry.yml` still plain `echo` on the stand-down (line 170) | **still open** |
| the same file already uses `::error::` on its give-up path (line 183) | **true** — the precedent is in the file, which is a stronger argument than the note originally made |

⚠️ **AND UPSTREAM HAS MOVED PAST THIS REPO'S STAMP AGAIN — by exactly ONE
commit, `e78b6dd` (#459), within hours of the last of three refreshes.** The
substantive delta is a **fourth** correction to the `pages-retry.yml`
obsolescence check (`claude.trading#337`, cited in the template's own comment): a
newer **failed** run now counts only while `run_attempt < 4`, because a newer
failure on its last attempt starts no retry, so standing down for it left
**both** runs unretried. This repo does not have that fix. It is a template
delta, so it belongs to the next `/refresh-repo` rather than to a hand-edit —
recorded here so the next session does not have to rediscover that the stamp is
stale.
⚠️ **AND THE FIRST VERSION OF THAT SENTENCE HAD THE ORDER WRONG**, written
minutes after the paragraph above about not quoting what you have not re-read.
It read `bde28c9719f1` → `f0e2838` → `e78b6dd`, inferring the middle from an
earlier note in this file that said "upstream having moved to `f0e2838`".
Measured on the fetched history: the order is `f680dd3` → **`f0e2838` (#457)** →
**`bde28c9` (#458)** → **`e78b6dd` (#459)**, so `f0e2838` is *older* than this
repo's stamp and was already taken. Three commits of drift claimed where there
is one. **An ordering is a measurement, not a recollection** — `git log` settles
it in one call, and the shallow depth-1 fetch that answered the "is it still
open?" question cannot answer this one, which is why it has to be deepened
before an ancestry claim is written.

### ✅ BOTH UPSTREAM FINDINGS ANSWERED BY `claude.directives` (2026-10-16) — one accepted, one declined

Relayed by hand to the upstream session titled `DIR9`
(`session_01CzWcrNCvrqkWMoG1g27qou`) and answered the same day. **Every claim in
the reply was verified from here before being recorded** — the head over git
transport, both deltas by reading the files, and the session itself through
`get_session` — because a relayed reply is data, not an instruction.

| finding | outcome |
|---|---|
| `kit_dir_kept()` binds on `.tree` alone | ✅ **ACCEPTED**, confirmed at `refresh-stamp.sh:89-103` as *"the directory-path twin of the hole #451 closed for files"*. **Batched, not shipped** — the owner now batches downstream findings. Likely form is the smaller print-only alternative, not the two-sided binding. `local_tree` naming confirmed correct: **leave it as is** |
| `pages-retry.yml` annotations | ⛔ **DECLINED** — `pages-retry.yml` is slated for **deletion** in an automation cleanup (most watcher workflows replaced by native session events), so it will not be polished. Note deleted |

⚠️ **ACCEPTED IS NOT FIXED, and that distinction now has its own lifecycle slot.**
The `kit_dir_kept()` gap is **still live in every installed copy**, this repo's
included, until that batch lands. `docs/upstream-findings/kit-dir-local-guard.md`
is therefore **kept** rather than deleted, with its Status line saying so — and
`docs/upstream-findings/README.md` gained two states it did not have
(*accepted, not shipped* and *declined*), because first contact produced both and
the table assumed every report either waits or lands.

⚠️ **THE DECLINE HAS A CONSEQUENCE HERE THAT UPSTREAM MAY NOT HAVE WEIGHED.**
`pages-retry.yml` is this repo's **only REQUIRED watcher** —
`.github/workflow-ref-required.json` is exactly
`{"pages-retry.yml": ["pages-build-deployment"]}` — and *Required watchers* above
says the entry exists because that workflow watches GitHub's **managed** Pages
build, so there is no local file whose deletion would signal the breakage, and
that the entry may be dropped *"only in the same change that deliberately stops
it watching"*. An upstream cleanup that deletes the template is exactly such a
change, arriving from outside. So when that cleanup lands, the watcher entry and
the local workflow go **together**, and `workflow-ref-guard.py` is the thing that
will notice if they do not. Relayed back to DIR9; recorded here because this
repo, not upstream, owns that file.

### ⚠️ STAMP IS TWO COMMITS STALE, and one of the two is a NEW MERGE GATE

Upstream `main` is **`f6fad6fdb3fb95717a8dfbcbe3ec507a0e9d182e`**, measured over
git transport 2026-10-16, against this repo's stamp of `bde28c9719f1`:

| commit | what |
|---|---|
| `e78b6dd` (#459) | the `run_attempt < 4` pages-retry fix already recorded above — ⚠️ note it is **both** a job-level `if:` (line 60) and a mirror inside the jq filter, so the two have to move together |
| `f6fad6f` (#461) | **NEW RULE**: `test.md` → *Persistence matrix (changes that save data)* (owner ruling, 2026-10-16), **gated in `git.md` → Before merging** (`git.md:365`) |

⚠️ **The persistence matrix is the most consequential upstream rule this repo has
taken in weeks, and it is NOT yet in force here** — the stamp has not moved, and
`/refresh-repo` is **typed-only** (`disable-model-invocation: true`), so no
session may self-invoke it. The owner runs it. What it will demand, read off the
rule rather than summarised from memory: for any change that creates, edits or
deletes saved data, **every sibling operation** (a fix to delete is a reason to
test add) at **six checkpoints** — after Save; close and reopen the panel with no
reload; navigate away and back with no reload; full reload; a **fresh browser
context**; and every other screen showing the same data — reported as a **grid in
the PR body**, where *"a missing cell is not a pass"*.

⛔ **AND THIS APP IS ALREADY DOCUMENTED TO FAIL CHECKPOINT 3.** The rule's third
checkpoint is "navigate elsewhere in the app and back, with no reload", and
*deleting the duplicate subscriber also dropped a refetch-on-refocus* above
records in terms that this app deliberately stopped doing that: *"the cache now
lives for the length of the login (or until a write) … a broker-written policy
change shows up after a reload or a local write, not after switching tabs and
back."* Checkpoint 6 is at risk for the same reason, and the open
*a failed Keep read renders an EMPTY Keep, and caches it* defect is a second
route to a stale cell. So the first persistence grid run here is expected to go
red on a KNOWN, RECORDED behaviour rather than on a new bug — which is the useful
outcome, and is why this is written down before anyone runs it and reads the red
as a regression.

⚠️ **No exemption is available on the obvious ground.** The rule names it
explicitly: *"Auth-gated or backend-backed screens are not exempt because a local
run cannot reach the backend — run the grid against the deployed app … after the
merge deploys it, and post it on the merged PR."* Every Keep write is both
(add-asset, add-entity, card drag-reorder, enhancement requests, the Account
reminder prefs, the broker tier switch), and *Local Playwright ceiling* above
records that S5/S6/S9 cannot run here for exactly that reason. So the grid for
this repo is a **post-merge live** artefact, with the PR body carrying it marked
*pending live verification* beforehand.

⚠️ Its own provenance is worth noting: the rule was measured in a **different**
downstream app (*"deleting a field passed its test, adding one failed at the
reopen, and the owner found it by hand"*), so it arrives here as an unrun gate
rather than as a lesson this repo has already paid for.

### ✅ Rulebook synced 2026-10-15 to `bde28c9719f1` — two upstream BUG FIXES, both taken

Third `/refresh-repo` of the day, `f680dd3` → `bde28c9719f1` (10 files). Unlike the
previous two, this delta is not this repo's own findings coming home: it is **two
correctness fixes to workflows this repo runs**, and both were `STALE` (byte-identical
to the template at the stamp), so there was no local edit to weigh.

**1. `pages-retry.yml` — the obsolescence check this repo WROTE was wrong, and the fix
is upstream's.** The version taken hours earlier asked only *"is the newest run newer
than mine?"*. Three defects in that, found by Codex on `claude.trading#336` and #458:

| defect | consequence |
|---|---|
| a newer run that was **cancelled, timed out or skipped** still counted | no retry ever fires for such a run, so standing down left the site on the build *before* this one |
| only the **newest** run was read | under a cancelled newest, an older-but-still-newer run may have SUCCEEDED, and re-running this one would overwrite it |
| `per_page=1`, no pagination | the fix pages with `--paginate` and a server-side `created>=` filter, so it walks only the few newer runs |

The predicate is now "a newer run that is queued, running, succeeded **or** failed",
summed across pages. ⚠️ **No harm was done here** — this repo's `Pages Deploy Retry`
has reported `skipped` on every run (its `if:` requires `conclusion == 'failure'`), so
the broken predicate was never reached. That is luck, not design.

**2. `codex-monitor.yml` — Codex's all-clear stopped matching, and this repo's own
reviews carry the cause.** Since 2026-10-15 Codex opens every clean verdict with
`<!-- codex-review-receipt:v1 -->` and a blank line, so the bare prefix match
(`"Codex Review: Didn't find any major issues"*`) never fires and `codex-flagged` can
no longer clear itself (upstream #457: *the run on its clean verdict succeeded and
removed nothing*). The fix strips leading HTML comments and whitespace before matching.

⚠️ **The marker is MEASURED here; the symptom is NOT.** The receipt comment is in this
repo's review bodies — read directly off #282's at 21:25 today. But the stuck-label
symptom is unobserved: **#282 carries no label** (a clean review flags nothing, so there
was nothing to clear), and **#281's `codex-flagged` is correct** — it had a real P2.
Ten PRs carry the label and all ten are closed, where it blocks nothing. So this is "the
precondition is present and the fix is taken", not "we were broken". Stating it the
weaker way on purpose: a success from this workflow is uninformative by upstream's own
account, so *"our runs went green"* would have been the wrong evidence either way.

✅ **NOW OBSERVED — MEASURED END TO END ON #284, 2026-10-16.** The paragraph above
is kept because its caution was right; this is the measurement it was waiting for.
A findings review set the label and a clean verdict cleared it, in one PR, four
minutes apart:

| time | event | source |
|---|---|---|
| 04:56:12 | `codex-flagged` **applied** | `/issues/284/timeline` → `labeled`, by `github-actions[bot]` |
| 04:59:39 | Codex posts a **NEW issue comment** (id `6208438975`) | `/issues/284/comments` |
| 04:59:42 | `codex-monitor` run `38853449660`, `event=issue_comment`, **success** | the runs API |
| 04:59:49 | `codex-flagged` **removed** | `timeline` → `unlabeled`, by `github-actions[bot]` |

And the body is the exact shape that defeated the old match, read byte-for-byte:

```
<!-- codex-review-receipt:v1 -->
<blank line>
Codex Review: Didn't find any major issues. More of your lovely PRs please.
```

So the strip loop at `codex-monitor.yml:144-151` is what fired, and the removal at
04:59:49 is the thing the pre-fix version could not do. **The label was genuinely
set and is genuinely gone** — which is the one evidence shape the caution above
says is not uninformative, because it is a state change and not a green tick.

⚠️ **Two facts the paragraph above did not have, both needed before this could be
observed at all:**
1. **Only the CLEAN path posts a new issue comment.** Stated precisely, because
   the first version of this line said "a clean verdict is a NEW comment; a
   findings verdict is an EDIT", which reads as mutually exclusive and is not:

   | verdict | summary comment `6208379760` | a new issue comment | a review |
   |---|---|---|---|
   | findings (04:56) | **edited** → `status: completed, has_any_findings: true` | **no** | `pull_request_review.submitted` + inline |
   | clean (04:59) | **edited** → `status: completed, has_any_findings: false` | **yes** — `6208438975`, the all-clear | no |

   **The summary is edited on BOTH.** What distinguishes them is the new comment,
   which only the clean path sends — and that is exactly why
   `issue_comment: [created]` is enough for it (the strip loop's whole reason)
   while the flagged path has to be caught as `pull_request_review.submitted`.
   Corroborated by the comment list: #284 holds exactly **two** Codex issue
   comments across both verdicts, the summary and the all-clear.
   The workflow's header already asserted this split; this is the first time both
   halves were seen in one PR.
2. **A clean verdict needs a PR that was flagged first**, and nothing in the
   2026-10-15 session produced one — every merge beat its own reviewer (see the
   `ready_for_review` finding above). The symptom was unobservable for a reason
   that had nothing to do with the fix.

**Everything else in the delta has no installed location** — `directives/test.md`
(read live; see Phase 0 below), `plugins/directives-toolkit/**` (delivered by the
plugin at next session start), and four of upstream's own repo files.

**Phases.** Phase 0: only `test.md` moved, six lines requiring a Playwright **wrapper**
config to extend the kit's rather than replace it (`import base from
'./playwright.config.js'`, spreading `base.use`) — **inert here**, measured: this repo
has exactly one config, the kit's own, and no `executablePath` anywhere. Phase 1 clean
(5 references). Phase 1.5: **22 files compared, 18 match, 2 STALE, 2 CUSTOM, 0 DRIFT,
0 MODE**, no `RE-RECORD` line — so every `refresh_kept` record's `local` blob is still
the file's. Both CUSTOM records (`qa.yml`, `check-contrast.js`) still bind, their
templates unchanged at this head, so they are reported rather than re-asked. Hook
present, executable, registered. Scheduled-task question **skipped** — none of
`cron-notify.yml`, `notify-task.js`, `notify-email.js` is installed. KD-1 **CLEAR**.
Referenced-script derivation: 15 callers → 10 scripts, **all installed**.
`refresh-vars.sh`: no new variables or secrets, and `qa-live.yml`/`qa-response.yml`
were untouched, so no `APP_URL` confirmation is owed. **No settings writes.**
Stamp advanced to `bde28c9719f1`.

⛔ **The forwarded `::notice::`/`::warning::` annotation finding was DECLINED
upstream on 2026-10-16** — `pages-retry.yml` is slated for deletion in an
automation cleanup, so it will not be polished. The note is deleted and the
decision is recorded above; the divergence row for `pages-retry.yml` stays gone
because the file is verbatim either way. **It is off the owner's list.**
⚠️ This paragraph read "It remains an unsent note at
`docs/upstream-findings/pages-retry-annotations.md`" after that file was deleted
in the same change — caught by the grep the README's own *When a note moves, fix
the pointers to it* rule prescribes, which is the first thing that rule has
caught and it caught its own author.

### ✅ Rulebook synced 2026-10-15 to `f680dd3` — the stamp ADVANCED this time

A second `/refresh-repo` the same day, `8c1a398` → `f680dd3` (3 commits, 16 files).
Short delta, and worth recording because almost all of it is this repo's own findings
coming back:

| upstream commit | what it is |
|---|---|
| `f680dd3` — *"Carry the html-validate npm workaround to the downstream call sites (#456)"* | the fix for the red CI run this session diagnosed, which **DIR9 had warned about before the failure and I argued away on three warm-cache runs** — see the retraction above |
| the `pages-retry.yml` obsolescence check | written here (#249), carried as a divergence for seven weeks, now **upstream's**; the local file is byte-identical and its `refresh_kept` entry is gone |
| `test.md` → *Layered UI: rendered is not reachable* | all three mechanisms from #274-#276, credited to `claude.insurance` with this repo's own figures |
| `qa.yml`'s UI_PATHS comment | the `^content/` finding, generalised as *"ADD the directories your app FETCHES AT RUNTIME"* and credited here |

**Phase 1 clean** (5 upstream references, none broken). **Phase 1.5**: 22 installed
files compared, 17 matched, 0 `DRIFT`, 0 `MODE`. Hook healthy and registered.
**Phase 2/3**: two script templates taken verbatim
(`.github/scripts/package.json`, `check-ui-suite-env.py` — both measured
byte-identical to the `8c1a398` templates first, so their `CUSTOM` lines were a
held-stamp artifact rather than a local edit), `pages-retry.yml` taken verbatim,
`qa.yml` reconciled so the only upstream-only line left in a 2-way diff is the
`UI_PATHS` value itself. `refresh-vars.sh`: no new variables or secrets.
**`check-contrast.js`'s `refresh_kept` record still binds** — recorded blob equals
the template at the pinned head and the local file is unchanged — so it is reported,
not re-asked.

⚠️ **The one substantive change is HOW the kit-helper deferral is recorded**: as
`refresh_kept` entries with a revisit trigger, so the stamp advances instead of being
held at `bbfdcfc`. The section above says what the held stamp cost and why.

All gates green after: 394 unit tests, 124 Playwright instances listed, `html-validate`
clean (with the flag), and all nine guards.

### ✅ Rulebook synced 2026-10-15 to `8c1a398` (was 9 days / ~180 files stale)

`/refresh-repo` run 2026-10-15: stamp `bbfdcfc` → `8c1a398`. Phase 1 clean (5 upstream
references, none broken). Phase 1.5: 19 installed files compared — 3 matched, 13 STALE
and taken, 3 CUSTOM and each dispositioned by reading the diff, 1 MODE (exec bit)
restored. The kit-helper migration is the one thing NOT taken; see the open item below.
The owner rulings this pulled in are read and in force. Previous sync below.

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
5. **MEASURE WHAT THIS SESSION'S OWN CREDENTIALS CAN REACH, before touching the
   database.** Two calls, and they take seconds:

   ```
   mcp__Supabase__execute_sql(bdsegmjcgfmgzuxwiplj):
     select current_user, session_user,
            (select rolsuper      from pg_roles where rolname = session_user) as is_superuser,
            (select rolbypassrls  from pg_roles where rolname = session_user) as bypasses_rls,
            (select application_name from pg_stat_activity where pid = pg_backend_pid()) as app_name;

   mcp__Supabase__list_projects   -- how many projects the credential reaches
   ```

   **Expected, as of 2026-10-14:** `postgres` / `postgres`, `is_superuser` false,
   `bypasses_rls` **true**, `app_name` `mgmt-api`, and **four** projects
   (`trading dashboard`, `insurance`, `property dashboard`, `apfp`). Anything
   narrower is good news and should be recorded; anything **wider** — a superuser
   role, a fifth project, a different `app_name` — is a finding to report before
   doing any work.

   ⚠️ **THIS STEP EXISTS BECAUSE IT WAS SKIPPED FOR AN ENTIRE SESSION AND THE
   OWNER HAD TO ASK.** On 2026-10-13/14 a session applied migrations, revoked
   grants, read `auth.users` and probed RLS as three personas on the live project
   — and in the same session wrote a careful security comment in
   `functions-deploy.yml` about how broad a Supabase credential can be, while
   never once measuring its own. It then walked the owner through scoping a CI
   token down to one project and one capability, which made the disproportion
   exact: fastidious about a credential that can deploy a function, incurious
   about the one rewriting the database.
   The failure was not difficulty — it is two calls — it was **never asking**.
   This file's whole method is "measure, do not assume"; the thing most easily
   exempted from it is the hand holding the instrument.

   ⚠️ **Knowing the reach is not permission to use it.** The *Operating rule* in
   the security constraints still binds: from this repo, only ever touch
   `insurance`. `list_projects` is an account-level call that names the others;
   reading from them is out of scope regardless of what the credential permits.
