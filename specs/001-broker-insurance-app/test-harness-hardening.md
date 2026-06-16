# Test-harness hardening — tracked findings (from Codex review of PR #1)

These are valid **P2** robustness findings from Codex's automated review of the
**generic exploratory Playwright harness** (`.github/scripts/ui-tests/tests/app.spec.js`)
and `qa.yml`. Those files are **verbatim copies of the canonical `claude.directives`
templates**, so they were intentionally *not* patched in the bootstrap PR (no app
exists yet; CI is green; patching downstream would fork the upstream template).

**Disposition:** fold the relevant fixes in during the **`ui-tester` specialization
step** (when `app.spec.js` is customized against the real UI — at which point
divergence from the template is expected and owned). Findings that are generic to
the harness should additionally be fixed **upstream** in
`akyachtsman/claude.directives/templates/` so every project benefits (cannot be
done from this repo-scoped session).

| # | Location | Finding | Applies when | Address in phase |
|---|----------|---------|--------------|------------------|
| 1 | `app.spec.js:211` | Inline auth-error also changes the DOM → `!domChanged` is false → S2 passes with a **bad** credential. Check for a known post-login selector / visible error state before treating any DOM change as acceptance. | Auth gate exists | Asset-protection (auth) phase |
| 2 | `app.spec.js:253` | Interaction sweep `test.skip`s entirely when no credential → **public** pages never exercised. Our **knowledge hub + questionnaire are public-first**, so the sweep should run unauthenticated unless a real auth wall blocks access. | Always (high relevance) | Knowledge-hub / questionnaire phase |
| 3 | `app.spec.js:51` | API status recorded only inside `clone.json().then(...)`; a non-JSON error body (HTML 500/404) makes the parse reject and the call is dropped as "no call". Record `{url, status}` first, enrich only if JSON parses. | Always | Questionnaire phase (when API calls exist) |
| 4 | `app.spec.js:335` | S4 (responsive) never authenticates → only measures the login screen; post-login horizontal overflow goes unchecked. Authenticate when a credential is available before measuring. | Auth gate exists | Asset-protection (auth) phase |
| 5 | `qa.yml:131` | `npx http-server` is invoked but not in `package.json`/lockfile → unpinned fetch at runtime; fails under locked-down npm egress or a registry hiccup. Add `http-server` to the kit's devDependencies (and lockfile). | Always (CI fragility) | Knowledge-hub phase (first real UI run) |
| 6 | `app.spec.js:305` | Post-navigation, `addInitScript` resets `window.__apiCalls` but `callsBefore` is from the previous page; if the new page makes fewer calls, `slice(callsBefore)` drops them. Reset the baseline after navigation or tag calls per interaction. | When multi-page navigation + API calls exist | Questionnaire phase |
| 7 | `app.spec.js:316` | The interaction `catch` suppresses **all** click/fill/select exceptions, not just stale/detached races (overlay-covered, unexpectedly disabled, etc. are masked). Only ignore known stale/detached errors; record the rest as findings. | Always | Knowledge-hub / questionnaire phase |

**Note:** #2 and #5 are the two that matter for *this* product immediately (public-first
flows; CI robustness). #1, #4 only bite once an auth gate exists (asset-protection phase).
