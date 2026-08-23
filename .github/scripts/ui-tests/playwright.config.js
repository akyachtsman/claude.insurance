// Playwright configuration for claude.insurance.
// Live URL resolves from the APP_URL env var, falling back to the Pages URL.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: '../../../.agent-reports/playwright-results.json' }]],
  use: {
    // Live URL — overridable via APP_URL env var.
    baseURL: (process.env.APP_URL || 'https://akyachtsman.github.io/claude.insurance/').replace(/\/?$/, '/'),
    headless: true,
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
