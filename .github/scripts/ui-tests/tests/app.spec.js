// Generic exploratory UI test — no project-specific selectors or credentials.
// Reads auth credentials from CLAUDE.md at runtime.
// Discovers app structure, exercises all interactive elements, captures API calls.
//
// ⚠️ Known CI compatibility issue — 100dvh not supported in older CI browsers:
// The CSS unit 100dvh (dynamic viewport height) is not supported in older CI browser
// versions (Chromium/WebKit in GitHub Actions). Elements using min-height: 100dvh may
// have zero computed height, causing Playwright toBeVisible() checks to fail even though
// the element is in the DOM. When diagnosing S1/S2 failures where login screen elements
// are present in HTML but not visible to Playwright, check for dvh units in CSS and
// replace with vh.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIAL DISCOVERY — read from CLAUDE.md at runtime
// ─────────────────────────────────────────────────────────────────────────────
function readCredentialFromClaude() {
  try {
    const root = resolve(process.cwd(), '../../..'); // up from .github/scripts/ui-tests
    const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
    // Matches all of:
    //   Test PIN: 0100        Valid PIN: 0100
    //   TEST_AUTH_CREDENTIAL: 0100
    //   | Valid test PIN | `0100` |   (table format)
    const match = claude.match(
      /(?:valid\s+(?:test\s+)?pin|test\s+(?:pin|credential|password)|TEST_AUTH_CREDENTIAL)\s*[:|]\s*`?([0-9a-zA-Z!@#$%^&*]{2,})`?/i
    );
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

// Falls back to null if neither env var nor CLAUDE.md has a credential.
// Auth-dependent tests skip gracefully rather than failing when null.
const AUTH_CREDENTIAL = process.env.TEST_AUTH_CREDENTIAL ?? readCredentialFromClaude() ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// API CALL CAPTURE — must wrap fetch before page load via addInitScript
// ─────────────────────────────────────────────────────────────────────────────
async function captureApiCalls(page) {
  await page.addInitScript(() => {
    const orig = window.fetch;
    window.__apiCalls = [];
    window.fetch = async (...args) => {
      const res = await orig(...args);
      const clone = res.clone();
      clone.json().then(body => {
        // Backend-agnostic: most REST backends return an array of row objects; some
        // backends wrap rows as { records: [{ fields: {...} }] }.
        const rows = Array.isArray(body) ? body : (body?.records ?? null);
        const firstRow = rows?.[0];
        const firstFieldKey = firstRow
          ? Object.keys(firstRow.fields ?? firstRow)[0] ?? null
          : null;
        window.__apiCalls.push({
          url: typeof args[0] === 'string' ? args[0] : args[0]?.url,
          status: res.status,
          recordCount: Array.isArray(rows) ? rows.length : null,
          firstFieldKey,
          error: body?.error ?? body?.message ?? null,
        });
      }).catch(() => {});
      return res;
    };
  });
  return () => page.evaluate(() => window.__apiCalls);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM STATE SNAPSHOT — used to detect transitions in single-page apps
// ─────────────────────────────────────────────────────────────────────────────
async function domSnapshot(page) {
  return page.evaluate(() => ({
    visibleIds: [...document.querySelectorAll('[id]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(el => el.id),
    bodyText: document.body.innerText?.slice(0, 500),
    inputCount: document.querySelectorAll('input:not([type=hidden])').length,
    buttonCount: document.querySelectorAll('button, [role=button]').length,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH DISCOVERY & ATTEMPT
// ─────────────────────────────────────────────────────────────────────────────
async function detectAndAuth(page, credential) {
  // Wait for auth UI to be fully active before interacting — prevents CI timing failures
  // on mobile/WebKit where JS activates slower than desktop Chromium.
  await page.locator('[class*="keypad"], [class*="pin"], input[type="password"], input[type="text"]')
    .first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  // Heuristic 1: numeric keypad (buttons 0-9 + dot indicators)
  const hasNumericButtons = await page.locator('button').filter({ hasText: /^[0-9]$/ }).count();
  const hasDotIndicator   = await page.locator('[class*="dot"], [class*="pin"]').count();

  if (hasNumericButtons >= 9 && hasDotIndicator > 0) {
    // PIN keypad — click each digit as a string (preserve leading zeros)
    for (const digit of String(credential).split('')) {
      await page.locator('button').filter({ hasText: new RegExp(`^${digit}$`) }).first().click();
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(3000);
    return 'pin-keypad';
  }

  // Heuristic 2: password input
  const passwordInput = page.locator('input[type=password]').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(String(credential));
    const submitBtn = page.locator('button[type=submit], input[type=submit], button').filter({ hasText: /sign.?in|log.?in|submit|enter/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) await submitBtn.click();
    else await passwordInput.press('Enter');
    await page.waitForTimeout(3000);
    return 'password-form';
  }

  // Heuristic 3: text input accepting short credential
  const textInput = page.locator('input[type=text], input:not([type])').first();
  if (await textInput.isVisible().catch(() => false)) {
    await textInput.fill(String(credential));
    await textInput.press('Enter');
    await page.waitForTimeout(3000);
    return 'text-input';
  }

  return 'none'; // no auth gate detected
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE ELEMENT DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────
async function discoverElements(page) {
  return page.evaluate(() => {
    const selectors = ['button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea',
                       '[role=button]', '[onclick]'];
    return selectors.flatMap(sel =>
      [...document.querySelectorAll(sel)]
        // Index BEFORE filtering: page.locator(sel).nth(i) counts every DOM match,
        // hidden included, so the recorded index must count them too.
        .map((el, index) => ({ el, index }))
        .filter(({ el }) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map(({ el, index }) => ({
          selector: sel,
          index,
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') ?? null,
          label: (el.textContent?.trim().slice(0, 60) ||
                  el.getAttribute('aria-label') ||
                  el.getAttribute('placeholder') ||
                  el.getAttribute('name') ||
                  el.id || '').slice(0, 60),
          id: el.id || null,
        }))
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST FILL VALUE — infer plausible value from element context
// ─────────────────────────────────────────────────────────────────────────────
function testValueFor(el) {
  const label = (el.label + (el.type ?? '')).toLowerCase();
  if (/email/.test(label))         return 'test@example.com';
  if (/date/.test(label))          return new Date().toISOString().split('T')[0];
  if (/number|qty|amount|count/.test(label)) return '42';
  if (/phone|tel/.test(label))     return '5551234567';
  if (/url|link/.test(label))      return 'https://example.com';
  return 'Test input';
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — Page Load
// ─────────────────────────────────────────────────────────────────────────────
test('S1: page loads without JS errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});
  const bodyText = await page.evaluate(() => document.body.innerText?.trim());
  expect(bodyText?.length, 'Page body is empty').toBeGreaterThan(0);
  expect(errors, `JS errors on load: ${errors.join('; ')}`).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — Auth Discovery & Login (with API diagnostics)
// ─────────────────────────────────────────────────────────────────────────────
test('S2: auth gate discovered and credential accepted', async ({ page }) => {
  if (!AUTH_CREDENTIAL) test.skip(true, 'No auth credential found in CLAUDE.md or TEST_AUTH_CREDENTIAL env var — skipping auth test');
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const getApiCalls = await captureApiCalls(page);
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});

  const beforeSnap = await domSnapshot(page);
  const mechanism  = await detectAndAuth(page, AUTH_CREDENTIAL ?? '');
  const afterSnap  = await domSnapshot(page);

  const domChanged = JSON.stringify(beforeSnap) !== JSON.stringify(afterSnap);

  if (!domChanged && mechanism !== 'none') {
    const apiCalls = await getApiCalls();
    const errText  = await page.locator('[id*="err"], [class*="err"], [class*="error"]').first().textContent().catch(() => '');
    const firstKey = apiCalls[0]?.firstFieldKey ?? null;
    const diag = {
      mechanism,
      credentialProvided: AUTH_CREDENTIAL ? 'yes' : 'none — check CLAUDE.md',
      onscreenError: errText,
      consoleErrors,
      apiCalls,
      responseShape: firstKey
        ? `rows returned, first field "${firstKey}"`
        : (apiCalls[0]?.status >= 400 ? `non-2xx (${apiCalls[0]?.status})` : 'no rows returned — check query / RLS / auth'),
    };
    test.info().attach('auth-diagnostics', {
      body: JSON.stringify(diag, null, 2),
      contentType: 'application/json',
    });
    throw new Error(
      `S2 FAIL | mechanism: ${mechanism} | onscreenError: "${errText}" | ` +
      `API status: ${apiCalls[0]?.status ?? 'no call'} | ` +
      `recordCount: ${apiCalls[0]?.recordCount ?? 'n/a'} | ` +
      `responseShape: ${diag.responseShape} | ` +
      `consoleErrors: ${consoleErrors.join('; ') || 'none'}`
    );
  }

  // Auth passed or no auth required — record mechanism
  test.info().attach('auth-result', {
    body: JSON.stringify({ mechanism, domChanged }),
    contentType: 'application/json',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — Element Mapping & Interaction Sweep
// ─────────────────────────────────────────────────────────────────────────────
test('S3: interactive elements discovered and exercised without errors', async ({ page }) => {
  // The sweep scales with element count (~1.5s settle per element plus
  // navigation waits) and cannot fit the 30s global timeout on element-rich
  // apps or mobile-emulated projects.
  test.setTimeout(240_000);
  if (!AUTH_CREDENTIAL) test.skip(true, 'No auth credential — skipping interaction sweep (auth required to reach app content)');
  const consoleErrors = [];
  const apiAnomalies  = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const getApiCalls = await captureApiCalls(page);
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});
  await detectAndAuth(page, AUTH_CREDENTIAL ?? '');
  await page.waitForLoadState('networkidle').catch(() => {});

  const elements = await discoverElements(page);
  test.info().attach('element-map', {
    body: JSON.stringify(elements, null, 2),
    contentType: 'application/json',
  });

  const findings = [];

  for (const el of elements) {
    const errorsBefore = consoleErrors.length;
    // Like errorsBefore: only calls made by THIS interaction count as findings.
    // (A navigation resets window.__apiCalls; slice() then yields [] — safe.)
    const callsBefore  = ((await getApiCalls()) ?? []).length;
    const snapBefore   = await domSnapshot(page);

    try {
      // CSS.escape is browser-only — in this Node context it throws, and the
      // catch below would silently skip every id-bearing element. JSON.stringify
      // yields a CSS-string-compatible escape for the [id="…"] selector.
      const locator = el.id
        ? page.locator(`[id=${JSON.stringify(el.id)}]`)
        : page.locator(el.selector).nth(el.index);

      if (!await locator.isVisible().catch(() => false)) continue;

      if (['button', 'a'].includes(el.tag) || el.type === 'submit' || el.selector.includes('role=button')) {
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        await page.waitForLoadState('networkidle').catch(() => {});
      } else if (['input', 'textarea'].includes(el.tag) && el.type !== 'submit') {
        await locator.fill(testValueFor(el), { timeout: 3000 });
      } else if (el.tag === 'select') {
        const options = await locator.locator('option').allTextContents();
        if (options.length > 1) await locator.selectOption({ index: 1 });
      }

      const snapAfter      = await domSnapshot(page);
      const domTransition  = JSON.stringify(snapBefore) !== JSON.stringify(snapAfter);
      const newErrors      = consoleErrors.slice(errorsBefore);
      const apiCalls       = (await getApiCalls()) ?? [];
      const recentBadCalls = apiCalls.slice(callsBefore).filter(c => c.status >= 400);

      if (newErrors.length > 0 || recentBadCalls.length > 0) {
        findings.push({
          element: el.label || el.id || `${el.tag}[${el.index}]`,
          action: el.tag === 'input' ? 'fill' : 'click',
          consoleErrors: newErrors,
          apiErrors: recentBadCalls,
          domTransition,
        });
      }
    } catch (e) {
      // Element became stale or detached — expected in SPAs, not a failure
    }
  }

  test.info().attach('interaction-findings', {
    body: JSON.stringify(findings, null, 2),
    contentType: 'application/json',
  });

  const blocking = findings.filter(f => f.apiErrors.some(c => c.status >= 500) || f.consoleErrors.length > 0);
  expect(blocking, `Blocking anomalies found:\n${JSON.stringify(blocking, null, 2)}`).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — Responsive Layout
// ─────────────────────────────────────────────────────────────────────────────
test('S4: no horizontal overflow at 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewWidth = await page.evaluate(() => window.innerWidth);
  expect(bodyWidth).toBeLessThanOrEqual(viewWidth + 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5+ — Project-Specific Scenarios
// Source: CLAUDE.md § Project-Specific Test Scenarios
// Generic coverage is S1–S4 above; add project-specific scenarios starting at S5.
// Add one scenario per row in that table before running the QA pipeline.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5 — Residential qualification flow ends in a broker lead, not a quote
// Source: CLAUDE.md § Project-Specific Test Scenarios (S5)
// Verifies: a user can go hub → questionnaire → summary, the summary lists at
// least one coverage need, and it is explicitly framed as a lead (not a quote).
// ─────────────────────────────────────────────────────────────────────────────
test('S5: residential flow reaches a summary framed as a lead, not a quote', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});

  // Enter the questionnaire from the hub.
  await page.getByRole('button', { name: /find what coverage i need/i }).click();

  // Choose the residential branch, then answer each single-choice step by
  // clicking the first option until the contact step (the only step with inputs).
  await page.getByRole('button', { name: /for my household/i }).click();
  for (let i = 0; i < 10; i++) {
    if (await page.locator('#contact-name').isVisible().catch(() => false)) break;
    await page.locator('.choices .choice').first().click();
    await page.waitForTimeout(150);
  }

  // Deferred PII: contact step appears last. Provide name + one contact method.
  await page.locator('#contact-name').fill('Test Person');
  await page.locator('#contact-email').fill('test@example.com');
  await page.getByRole('button', { name: /see my coverage needs/i }).click();

  // Summary: at least one need, and the explicit "not a quote" framing.
  await expect(page.locator('.need').first()).toBeVisible();
  await expect(page.locator('.disclaimer')).toContainText(/not a quote/i);

  expect(errors, `JS errors during flow: ${errors.join('; ')}`).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 6 — Commercial qualification flow ends in a broker lead, not a quote
// Source: CLAUDE.md § Project-Specific Test Scenarios (S6)
// Mirrors S5 for the business branch; uses phone (not email) as the contact method.
// ─────────────────────────────────────────────────────────────────────────────
test('S6: commercial flow reaches a summary framed as a lead, not a quote', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});

  await page.getByRole('button', { name: /find what coverage i need/i }).click();
  await page.getByRole('button', { name: /for my business/i }).click();
  for (let i = 0; i < 12; i++) {
    if (await page.locator('#contact-name').isVisible().catch(() => false)) break;
    await page.locator('.choices .choice').first().click();
    await page.waitForTimeout(150);
  }

  await page.locator('#contact-name').fill('Test Business');
  await page.locator('#contact-phone').fill('5551234567'); // phone-only contact path
  await page.getByRole('button', { name: /see my coverage needs/i }).click();

  await expect(page.locator('.need').first()).toBeVisible();
  await expect(page.locator('.disclaimer')).toContainText(/not a quote/i);
  expect(errors, `JS errors during flow: ${errors.join('; ')}`).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 7 — Deep-linking the summary with no profile shows an empty state
// Source: CLAUDE.md § Project-Specific Test Scenarios (S7)
// The store is in-memory, so a refresh/deep-link on #/summary must degrade to a
// friendly empty state, never a crash or a blank page.
// ─────────────────────────────────────────────────────────────────────────────
test('S7: summary deep-link with no answers shows an empty state, not an error', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('./#/summary');
  await page.waitForLoadState('networkidle').catch(() => {});

  await expect(page.getByText(/no summary yet/i)).toBeVisible();
  expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 8 — Contact step validation (deferred-PII guardrails)
// Source: CLAUDE.md § Project-Specific Test Scenarios (S8)
// A usable lead needs a name + at least one contact method; the step enforces it.
// ─────────────────────────────────────────────────────────────────────────────
test('S8: contact step requires a name and a contact method', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});

  await page.getByRole('button', { name: /find what coverage i need/i }).click();
  await page.getByRole('button', { name: /for my household/i }).click();
  for (let i = 0; i < 8; i++) {
    if (await page.locator('#contact-name').isVisible().catch(() => false)) break;
    await page.locator('.choices .choice').first().click();
    await page.waitForTimeout(150);
  }

  // Submit empty → an error is shown and we stay on the contact step.
  await page.getByRole('button', { name: /see my coverage needs/i }).click();
  await expect(page.locator('.error')).toBeVisible();

  // Name but no contact method → a contact-method error.
  await page.locator('#contact-name').fill('No Contact');
  await page.getByRole('button', { name: /see my coverage needs/i }).click();
  await expect(page.locator('.error')).toContainText(/email or phone/i);
  await expect(page.locator('#contact-name')).toBeVisible(); // still on the step
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 9 — The Keep auth gate
// Source: CLAUDE.md § Project-Specific Test Scenarios (S9)
//
// Live-only. The gate is real Supabase Auth, which the local qa.yml server
// cannot reach, so this self-skips there and is covered by qa-live.
//
// It needs NO TEST_AUTH_CREDENTIAL. The login form ships prefilled from
// DEMO_CREDENTIAL (js/supabase.js), so the happy path is "submit what the form
// already holds", and the bad-password path reads the prefilled value back
// before overwriting it — which is why no credential is hardcoded here.
//
// The dashboard assertion targets .k-welcome__h and NOT the bare text
// "Welcome back": the login card's own title (.k-atitle) is also "Welcome
// back", so matching on that text alone would pass while still sitting on the
// login screen — a vacuous green for the exact thing this scenario guards.
// ─────────────────────────────────────────────────────────────────────────────
const KEEP_LIVE_TARGET = !/localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? '');

test('S9: Keep auth gate blocks, rejects a bad password, admits the demo user, and releases on sign-out', async ({ page }) => {
  test.skip(!KEEP_LIVE_TARGET, 'The Keep gate is real Supabase Auth — unreachable from the local CI server; qa-live covers it.');
  test.setTimeout(90_000);

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const authcard = page.locator('.k-authcard');
  const dashboard = page.locator('.k-welcome__h');

  // 1. Deep-link the Keep while signed out → the guard must land on login,
  //    not the dashboard. Asserting the dashboard's ABSENCE is the real
  //    outcome; a visible login form alone would not prove the guard ran.
  await page.goto('./#/keep');
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(authcard, 'Signed-out #/keep did not land on the login form').toBeVisible();
  await expect(dashboard, 'Signed-out #/keep reached the dashboard — the auth gate is open').toHaveCount(0);

  // 2. A wrong password is rejected and does not advance.
  const pwField = authcard.locator('input[type="password"]');
  const prefilled = await pwField.inputValue();
  expect(prefilled, 'Login form is not prefilled — S9 assumes the demo credential ships in the form').not.toBe('');
  await pwField.fill('definitely-not-the-password');
  await authcard.getByRole('button', { name: /log in/i }).click();
  await expect(authcard.locator('.k-error'), 'A wrong password produced no error').not.toBeEmpty();
  await expect(dashboard, 'A wrong password still reached the dashboard').toHaveCount(0);

  // 3. Restore the credential the form shipped with → the dashboard opens.
  await pwField.fill(prefilled);
  await authcard.getByRole('button', { name: /log in/i }).click();
  await expect(dashboard, 'The prefilled demo credential did not reach the dashboard').toBeVisible({ timeout: 30_000 });
  await expect(dashboard).toHaveText(/welcome back,/i);
  await expect(authcard, 'The login form is still present after a successful sign-in').toHaveCount(0);

  // 4. Sign out releases the session and returns to login.
  await page.goto('./#/keep/account');
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(authcard, 'Sign-out did not return to the login form').toBeVisible({ timeout: 30_000 });

  // Console-error gate. Uncaught page errors are never acceptable. Console
  // errors are filtered for ONE written reason: step 2 deliberately submits a
  // bad password, and the auth call logs the resulting 400/401 to the console.
  // Everything else still fails.
  const expectedAuthNoise = /400|401|invalid login credentials|invalid_grant/i;
  const unexpected = consoleErrors.filter(t => !expectedAuthNoise.test(t));
  expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
  expect(unexpected, `Unexpected console errors: ${unexpected.join('; ')}`).toHaveLength(0);
});
