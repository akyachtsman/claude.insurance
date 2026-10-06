// Playwright configuration for claude.insurance.
// Live URL resolves from the APP_URL env var, falling back to the Pages URL.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  // ⚠️ THE `json` REPORTER IS NOT OPTIONAL, and `outputFile` is half of a pair.
  // The ui-suite composite re-runs check-ui-viewports.js AFTER the suite with
  // `--report <its report-path input>`, whose default is this exact string.
  // That post-run check certifies each declared width had a test SCHEDULED
  // under it — a non-skipped result in a project declaring that width. It does
  // NOT establish that a page was rendered there: a test whose body never
  // starts still produces a result (test.md → UI coverage gates, fifth gate,
  // and directives#348). The `ui-suite` composite exports
  // PLAYWRIGHT_JSON_OUTPUT_FILE set to its validated `report-path`, and that
  // beats the `outputFile` below — so under the composite this path need not
  // match `report-path`, and changing it changes nothing. What still matters is
  // that a json reporter is DECLARED at all: the variable redirects one, it does
  // not add one (measured on 1.62.1). Without it the post-run check has no
  // report to read, reports CANNOT CHECK and fails the job — deliberately, so a
  // missing report is never read as a covered band. Running Playwright by hand,
  // outside the composite, this path IS where the report lands.
  // Relative to THIS directory: `../../../` is the repo root from
  // .github/scripts/ui-tests/, which is where projects install this kit.
  reporter: [['list'], ['json', { outputFile: '../../../.agent-reports/playwright-results.json' }]],
  use: {
    // Live URL — overridable via APP_URL env var.
    baseURL: (process.env.APP_URL || 'https://akyachtsman.github.io/claude.insurance/').replace(/\/?$/, '/'),
    headless: true,
    // ⚠️ BOTH OF THESE DEFAULT TO 0 = NO TIMEOUT in Playwright Test, which is why
    // they are set explicitly. Left unset, an action or a navigation is bounded
    // only by the enclosing test timeout, so ONE hung call consumes a scenario's
    // entire budget — making every per-scenario sum in tests/app.spec.js a
    // fiction, since each is built from terms that were not themselves bounded.
    //
    // navigationTimeout — a page that cannot load in 30s is a failure worth
    // reporting as one. Governs goto(); the matching cap for
    // waitForLoadState('networkidle') is IDLE_MS in tests/app.spec.js.
    navigationTimeout: 30_000,
    // actionTimeout — the floor for click()/fill()/press()/selectOption() calls
    // that pass no timeout of their own. Most call sites pass one (2-3s) and
    // those still win; this covers the ones that cannot reasonably guess,
    // notably detectAndAuth()'s form interactions.
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'on-first-retry',
  },
  outputDir: '../../../.agent-reports/screenshots',
  projects: [
    // Desktop first: global.md requires laptop + tablet + phone coverage, and
    // test.md → Layered UI mandates before/during/after screenshots at
    // 1440x900 — neither is reachable from a device-emulated project, whose
    // viewport is fixed. Its presence is also what makes S4's explicit
    // setViewportSize(390) a real narrowing rather than a no-op.
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Tablet is its own class, not an interpolation between the two: global.md
      // requires laptop, tablet AND phone, and Pixel 5 + iPhone 12 are both phone
      // profiles, so a tablet-only breakpoint regression was invisible.
      //
      // PORTRAIT (810 wide), deliberately — NOT the landscape variant, which is
      // 1080 wide. This project's widest breakpoint is max-width: 900px, so a
      // 1080-wide project clears every media query it has and renders the same
      // layout as `desktop` — a project named tablet that tests nothing, which
      // is worse than no tablet project because it looks like coverage.
      // 810 sits inside the band: it picks up the 900px and 860px rules and
      // misses 760px and below, so it is genuinely distinct from both
      // neighbours. Verify the WIDTH against this project's breakpoints when
      // changing this — the device name is a convenience, not the fact.
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 12'] },
    },
  ],
});
