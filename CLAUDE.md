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
- `supabase/migrations/` — applied schema (provisioned): `leads` + `rule_settings` (public/anon side) and `profiles` (+ `reminder_email`/`reminder_schedule` prefs) + `entities` (kinds: `personal`/`business`/`trust`/`person`) + `entity_relationships` (directed owner/trustee links between a client's entities) + `assets` + `policies` (the Keep, auth-keyed). RLS on every table, default-deny. Demo data seeded live; `supabase/seed/` documents the seed in run order (`base_demo.sql` → `entity_relationships_demo.sql` → `assets_held_demo.sql`). The `notify-enhancement` Edge Function (enhancement-request emails) is deployed
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

1. Apply `supabase/proposed/20261006_help_queries.sql` — the throttle table. Its
   explicit `grant ... to service_role` is load-bearing, not tidiness.
2. Apply `supabase/proposed/20261006_profiles_no_client_insert.sql`. Without it
   the invite check is bypassable with one PostgREST insert, so the per-client
   spend cap is per *creatable* account.
3. **Turn public sign-up off** in Supabase Auth. Measured ON (`disable_signup:
   false`), which makes the Security page's "Invite-only access" card untrue.
4. **Provision a `profiles` row for every invited client**, as `postgres` (the
   dashboard SQL editor). Nothing else creates one: no trigger, no client insert
   after step 2, and `service_role` has no INSERT on that table. Without it the
   Keep works and the Help desk refuses every question, showing the same notice
   as an outage. This belongs in the invite runbook.
5. Set `ANTHROPIC_API_KEY` as an Edge Function secret.
6. Deploy `help-ask` **with the default `verify_jwt` (ON)** — see the `help-ask`
   entry above for the probe that reversed the earlier `--no-verify-jwt` advice.
7. **Merge PR #254, and wait for the Pages deploy to finish.**
8. Ask one question as a signed-in client and confirm an answer renders. FR-17
   makes every failure look identical, so this is the only step that proves the
   deploy worked. If it still shows the notice, read the function logs: the
   `where` field names the stage (`guide`, `records`, `reserve`, `provider`).

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
sandbox browser cannot complete. That half of the record is unchanged and was
NOT re-measured on 2026-10-06.

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
  number, renewal_date, premium_amount, premium_period, coverages`. **`coverages`
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
    Revisit once step 7 of the owner gate has proved one real answer renders.
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
- **⚠️ OPEN — `profiles.role` is self-assignable (live, verified 2026-10-05).**
  Not an accepted trade-off; an unfixed hole, recorded here so it is not
  rediscovered. `authenticated` holds table-level `UPDATE` on `public.profiles`
  (every column, `role` included) and the only policy on it is
  `using (id = auth.uid()) with check (id = auth.uid())` — no column
  restriction, no trigger. So one PostgREST call from the browser,
  `supabase.from("profiles").update({ role: "broker" }).eq("id", uid)`,
  promotes any signed-in client to staff. Reachable with the demo credential
  this file publishes and the login screen prefills.
  **Blast radius (verified, and narrower than it looks):** the only role-keyed
  policies in the schema are the four on `enhancement_requests`. `entities`,
  `assets`, `policies` and `entity_relationships` key on `owner = auth.uid()`
  with no role escape, so a self-promoted broker gains **no** access to another
  client's cover — it gains read/write on every client's enhancement requests
  (and `er_broker_update` has no `with check`, so `owner`/`subject`/`body` are
  rewritable too, not just `status`).
  **Fix written, not applied:** `supabase/proposed/20261005_profiles_role_not_self_assignable.sql`
  (a column-level `REVOKE` — RLS evaluates whole rows, so `with check` cannot
  express "this column may not change"). Needs owner approval. Verify by
  re-running the probe in that file's footer **as a client session**;
  service-role bypasses RLS and reports a false pass.
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
  **Also true and NOT fixed here:** the deployed `notify-enhancement` reads
  `enhancement_requests` under the same key, so it has the same denial. Verify
  before relying on its emails; outside feature 003's scope.
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
  **Half-fixed in code, and that half needs a migration to actually bite:**
  `help-ask` requires a `profiles` row before it will reserve a slot or spend
  anything. ⚠️ But `authenticated` holds INSERT on `profiles` with
  `with check (id = auth.uid())`, so a self-signed-up caller can create that row
  in one PostgREST call — gating on a row the client can write is not a gate.
  `supabase/proposed/20261006_profiles_no_client_insert.sql` revokes it; safe
  because nothing in `js/` inserts a profile and no trigger creates one (both
  verified against the live project). Until it is applied the check is defence in
  depth, not a boundary.
  **The other half is an owner action:** turn off "Allow new users to sign up"
  in Supabase Auth, or the Security card stays untrue. Deliberately NOT reworded
  to match the current setting — the wording describes the intended state, and
  the config is what is wrong.
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
`go("#/keep")` → `el("h1", { class: "k-welcome__h", … })` (`js/keep/views/keep.js:165`).
S9 already asserts `.k-welcome__h` for exactly this reason, with its own comment
saying why not the bare text.

`TEST_AUTH_SUCCESS_SELECTOR` is **optional and arguably redundant here**: S9
already proves the dashboard renders after a real login. If you set it, use
`.k-welcome__h`. A configured condition that never resolves FAILS rather than
falling back, by design — which is why the wrong selector is loud, not silent.

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
| Keep credential (valid) | `user` / `keep-demo-2026` (client view, prefilled) · `broker` / `keep-demo-2026` (broker view). Bare username → `<name>@example.com`. |
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
(`js/keep/views/keep.js:165`) and from S9, which already asserted the right one.
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
