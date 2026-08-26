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
    // Username/password PAIR form, tried first:
    //   | Keep credential (valid) | `user` / `keep-demo-2026` … |
    // Captures the SECOND token deliberately. detectAndAuth fills the password
    // field, and this app's login ships the username prefilled — matching the
    // first token would type the username into the password box and fail.
    const pair = claude.match(
      /credential[^|\n]*\|\s*`?[\w.@+-]+`?\s*\/\s*`?([\w.@!#$%^&*+-]{2,})`?/i
    );
    if (pair?.[1]) return pair[1].trim();

    // Single-token form: "Test PIN: 0100", "TEST_AUTH_CREDENTIAL: 0100",
    // "| Valid test PIN | `0100` |".
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
// `||` not `??` — an UNSET GitHub secret interpolates to the EMPTY STRING, which
// is not nullish, so `??` short-circuits and the CLAUDE.md fallback never fires.
// Upstream (ce2140a) reached the same conclusion independently.
const AUTH_CREDENTIAL = process.env.TEST_AUTH_CREDENTIAL || readCredentialFromClaude() || null;

// ⚠️ DO NOT SET TEST_AUTH_EMAIL FOR THIS PROJECT. The Keep's login form ships
// BOTH fields prefilled, and #309's identifier ladder matches on accessible name
// /email|user|login/ — our field is labelled "Username", so it matches. Setting
// the secret would OVERWRITE the working prefilled "user" and BREAK a login that
// otherwise succeeds. Password-only is correct here; that is what the kit does
// when this is unset. (claude.directives, prefilled-credential warning.)
const AUTH_EMAIL = process.env.TEST_AUTH_EMAIL || null;

// Backend reachability, kept SEPARATE from credential availability.
//
// The credential-absent skip exists so a project with no auth is not forced to
// invent one. It was never meant to double as "the backend is unreachable" —
// but that is what it had become here, because the local tier serves the app
// from a bundled static server while the app's data layer is remote. Conflating
// the two makes the auth secret un-settable: supplying it would un-skip the
// auth scenarios on the local tier too, where they can only fail. So the secret
// stays withheld, and the live coverage it buys never arrives.
//
// Splitting the conditions makes the secret a plain chore: auth scenarios run
// live, and skip locally for the reason that is actually true there.
const LIVE_TARGET = !/localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? '');

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
// ─── Auth helpers grafted verbatim from claude.directives templates/ui-tests (ce2140a).
// Ported by REFERENCE, not by copying bodies into scenarios (directives rider 1):
// keep this block byte-identical upstream so the next refresh diffs instead of
// rewriting. Local scenarios call into it.

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

  // Heuristic 2: password input — `visible=true` BEFORE `.first()`, the same
  // idiom as detection (passwordGateVisible) and for the same reason: a hidden
  // responsive copy first in the DOM would otherwise make the attempt skip
  // this branch and return mechanism 'none' — which no verifier checks — while
  // detection correctly reports a gate. Attempt and detection must select from
  // the same set.
  const passwordInput = page.locator('input[type=password]').locator('visible=true').first();
  if (await passwordInput.isVisible().catch(() => false)) {
    // Email+password gate: fill the identifier BEFORE the password when one was
    // supplied. ANCHORED TO THE PASSWORD'S OWN FORM — a page-scoped
    // input[type=email] with .first() would hand the identifier to whatever
    // email field happens to come first in the DOM (a newsletter box, a hidden
    // responsive copy), the login then submits a blank identifier, and the
    // gate-cleared check below fails every authenticated scenario. A gate with
    // no <form> element falls back to page scope with type=email ONLY: off-form,
    // a bare text input is more likely a search box than a login field.
    // Without TEST_AUTH_EMAIL the old password-only behaviour is unchanged.
    if (AUTH_EMAIL) {
      // The password's ASSOCIATED form via the DOM's own .form property — it
      // resolves both an ancestor <form> and external association
      // (<input form="login"> outside the form tag), where an ancestor-only
      // xpath lookup reports no form and wrongly restricts the search to the
      // formless rungs.
      const pwHandle = await passwordInput.elementHandle();
      const scopeHandle = (await passwordInput.evaluateHandle(el => el.form)).asElement();
      const hasForm = !!scopeHandle;
      // PREFERENCE LADDER, most-semantic first — never one union, because a
      // selector union preserves DOM order and a tenant/org field ahead of the
      // identifier would receive the email. Rungs: (1) the typed email input;
      // (2) autocomplete=username/email — the spec-defined identifier marker,
      // matched with ~= because the attribute is a space-separated token list
      // ("section-login username") and exact equality misses every multi-token
      // value; (3) a text input whose name/id/placeholder/aria-label SAYS it
      // is an email/user/login field; (4) form-scoped last resort, any visible
      // text input — kept because identifier fields on login forms are often
      // plain unlabeled type=text, and a login form rarely holds a competing
      // one (the tenant-field case is exactly what rungs 2-3 exist to win
      // first). Formless gates use rungs 1-3: the semantic rung names its
      // field explicitly, so it is safe anywhere (a div-based login with
      // <input name="username"> matches nothing without it); only the
      // UNRESTRICTED last resort stays form-only, because off-form a bare
      // text input is more likely a search box than a login field.
      // GENERATED, not hand-listed: the hand-written version required an
      // explicit type=text on every clause, so a form of type-less inputs
      // (<input name="tenant">, <input name="username">) matched NO semantic
      // rung and fell to the DOM-order last resort — tenant filled, username
      // blank. It had also drifted internally (login missing from two of the
      // four attributes). The cross-product cannot omit a cell.
      const T = ':is(input[type=text], input:not([type]))';
      const SEMANTIC = ['name', 'id', 'placeholder', 'aria-label']
        .flatMap(a => ['email', 'user', 'login'].map(v => `${T}[${a}*="${v}" i]`))
        .join(', ');
      const rungs = [
        'input[type=email]',
        'input[autocomplete~="username" i], input[autocomplete~="email" i]',
        SEMANTIC,
        ...(hasForm ? ['input[type=text], input:not([type])'] : []),
      ];
      // Selection is ANCHORED TO THE PASSWORD INPUT — never `.first()`, which
      // hands the fill to whatever matches earliest in the DOM. Two regimes:
      //   - WITH a form, rungs run in rank order scoped to that form, and the
      //     pick within a rung is the candidate nearest the password
      //     (preferring those that precede it) — the form declares the
      //     association, rank disambiguates inside it.
      //   - FORMLESS, proximity comes BEFORE rank: the rungs are unioned and
      //     the nearest-preceding candidate wins outright. Rung rank across a
      //     whole document inverts the intent — a newsletter input[type=email]
      //     elsewhere on the page outranked the semantic username sitting
      //     beside the password. With no form to declare the association,
      //     adjacency to the password IS the association; the rungs still
      //     bound WHAT may be picked (semantically-named fields only).
      // Visibility uses the file's evaluate-side definition (geometry +
      // computed visibility, same as textGateSignals), so a hidden responsive
      // copy is passed over in favour of the visible candidate rather than
      // silently skipping the fill. The pick is marked, filled through
      // Playwright (real input events), and unmarked.
      const marker = `uit-${Math.random().toString(36).slice(2)}`;
      const marked = await page.evaluate(([pw, root, sels, mark]) => {
        if (!pw) return false;
        const vis = el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        // EDITABLE candidates only: a two-step login shows the already-chosen
        // email in a readonly input beside the password — fill() on it burns
        // its timeout and fails, while leaving it alone submits fine. A
        // readonly prefilled identifier is accepted by NOT overwriting it.
        const editable = el => !el.readOnly && !el.disabled;
        // Formless scope is the PASSWORD'S OWN ROOT, not document: a login
        // component in an open shadow root keeps its inputs behind a boundary
        // querySelectorAll cannot cross from document, while Playwright found
        // the password inside it. getRootNode() is the shadow root there and
        // document everywhere else — the non-shadow case is unchanged.
        const scope = root || pw.getRootNode();
        // Form-scoped collection reads the form's `elements` collection, not a
        // descendant query: a control outside the form tag but associated via
        // the `form` attribute (<input form="login">) is submitted with the
        // form yet never matched by a descendant querySelectorAll.
        const candsOf = sel => (root
          ? [...root.elements].filter(el => el.matches(sel))
          : [...scope.querySelectorAll(sel)]
        ).filter(el => vis(el) && editable(el));
        const nearest = cands => {
          if (!cands.length) return null;
          const preceding = cands.filter(el => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
          return preceding.length ? preceding[preceding.length - 1] : cands[0];
        };
        // ACCESSIBLE-NAME matcher, both branches: <label for> / wrapping
        // labels (el.labels) and aria-labelledby text against the same
        // email/user/login vocabulary as the SEMANTIC rung — a gate labeling
        // its identifier with generated attributes carries the word "Email"
        // only in its accessible name, where no attribute selector can see
        // it. KNOWN LIMIT, deliberate: this reads TEXT, not the full
        // accessibility-name algorithm — a label whose only content is
        // <img alt="Email"> is not seen. Reimplementing accname inside an
        // evaluate is the staircase the back-control locator climbed and
        // abandoned for getByRole; no role locator can express "text input
        // whose NAME says email", so the residue is documented instead — an
        // app that exotic needs directives#302's per-project condition.
        const nameMatches = el => {
          const rootNode = el.getRootNode();
          const byId = id => (rootNode.getElementById ? rootNode : document).getElementById(id)?.textContent || '';
          const labelledby = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(byId).join(' ');
          const labels = el.labels ? [...el.labels].map(l => l.textContent || '').join(' ') : '';
          return /email|user|login/i.test(`${labelledby} ${labels}`);
        };
        const TEXTish = ':is(input[type=text], input:not([type]))';
        let pick = null;
        if (root) {
          // The accessible-name rung sits BETWEEN the semantic attribute rung
          // and the unrestricted last resort: an input labeled "Email" with
          // generated attributes must win before the final rung's proximity
          // hands the fill to a nearer tenant field.
          const rungPools = [
            ...sels.slice(0, -1).map(sel => () => candsOf(sel)),
            () => candsOf(TEXTish).filter(nameMatches),
            () => candsOf(sels[sels.length - 1]),
          ];
          for (const pool of rungPools) { pick = nearest(pool()); if (pick) break; }
        } else {
          // querySelectorAll on the joined union returns document order, so
          // nearest() sees one proximity-sorted candidate pool; accessible-
          // name candidates are unioned in and the pool re-sorted.
          const named = candsOf(TEXTish).filter(nameMatches);
          const pool = [...new Set([...candsOf(sels.join(', ')), ...named])];
          pool.sort((a, b) => a === b ? 0
            : (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
          pick = nearest(pool);
        }
        if (!pick) return false;
        // The candidate's ORIGINAL attribute value (null when absent) rides
        // back so cleanup restores rather than deletes — if the app itself
        // owns this attribute on the picked input, its styling/submit logic
        // must see the markup it shipped.
        const prev = pick.getAttribute('data-uitests-identifier');
        pick.setAttribute('data-uitests-identifier', mark);
        return { prev };
      }, [pwHandle, scopeHandle, rungs, marker]);
      if (marked) {
        // Located by the run-unique VALUE, not attribute presence — an app
        // element that happens to carry the bare attribute cannot shadow the
        // candidate the evaluate actually picked.
        const cand = page.locator(`[data-uitests-identifier="${marker}"]`).first();
        await cand.fill(String(AUTH_EMAIL));
        await cand.evaluate((el, prev) => {
          if (prev === null) el.removeAttribute('data-uitests-identifier');
          else el.setAttribute('data-uitests-identifier', prev);
        }, marked.prev);
      }
    }
    await passwordInput.fill(String(credential));
    const submitBtn = page.locator('button[type=submit], input[type=submit], button').filter({ hasText: /sign.?in|log.?in|submit|enter/i }).first();
    if (await submitBtn.isVisible().catch(() => false)) await submitBtn.click();
    else await passwordInput.press('Enter');
    await page.waitForTimeout(3000);
    return 'password-form';
  }

  // Heuristic 3: text input accepting short credential — same visible-first
  // idiom as heuristic 2, carried proactively: a hidden text input first in
  // the DOM would silently return 'none' here too.
  const textInput = page.locator('input[type=text], input:not([type])').locator('visible=true').first();
  if (await textInput.isVisible().catch(() => false)) {
    await textInput.fill(String(credential));
    await textInput.press('Enter');
    await page.waitForTimeout(3000);
    return 'text-input';
  }

  return 'none'; // no auth gate detected
}

// Detection-only: is there a real auth gate (PIN keypad or password field)? Does NOT
// interact, and deliberately ignores plain text inputs (a search/filter box is not an
// auth gate). Used to decide whether to skip/auth without firing spurious login attempts.
async function detectAuthGate(page) {
  await page.locator('[class*="keypad"], [class*="pin"], input[type="password"]')
    .first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await pinGateVisible(page)) return true;
  if (await passwordGateVisible(page)) return true;
  // Text/access-code gate (detectAndAuth's text-input path): a SINGLE visible text input
  // on a sparse, login-like page — gated on auth-ish context so an arbitrary search/filter
  // box on a content-rich page is NOT treated as auth.
  const t = await textGateSignals(page);
  return t.single && t.looksAuth && t.controls <= 4;
}

// The two mechanism signals, factored so DISCOVERY (detectAuthGate) and the
// post-attempt VERDICT (expectGateCleared) read the same definition and cannot
// drift. VISIBLE elements only — an SPA that hides its PIN view after login
// (rather than unmounting it) still has 10 numeric buttons in the DOM, and
// counting them made the detector return true post-login, which turned
// expectGateCleared() into a throw on every SUCCESSFUL sign-in. A gate the
// user cannot see is not a gate.
async function pinGateVisible(page) {
  const numericButtons = await page.locator('button').filter({ hasText: /^[0-9]$/ }).locator('visible=true').count();
  const dotIndicator   = await page.locator('[class*="dot"], [class*="pin"]').locator('visible=true').count();
  return numericButtons >= 9 && dotIndicator > 0;
}
async function passwordGateVisible(page) {
  // Visible-filtered COUNT, the same idiom as the PIN signal above — never
  // `.first().isVisible()`: in the common SPA pattern a hidden responsive
  // copy sits earlier in the DOM, `.first()` selects it, and a genuinely
  // visible password field behind it reads as "no gate".
  const n = await page.locator('input[type=password]').locator('visible=true').count().catch(() => 0);
  return n > 0;
}

// Shared by detectAuthGate (pre-attempt DISCOVERY, where the `controls <= 4`
// sparsity cutoff belongs — it exists to keep a search box on a content-rich
// page from reading as auth) and expectGateCleared (post-attempt VERDICT,
// where that cutoff must NOT apply: a rejected attempt that reveals a Retry
// button or help link pushes the count past 4 while the same gate stands, and
// re-running the discovery heuristic would read the rejection as a cleared
// gate). One evaluate, two thresholds — factored so the two cannot drift.
async function textGateSignals(page) {
  return page.evaluate(() => {
    // Geometry alone misses visibility:hidden (the box survives), so an SPA
    // hiding its gate that way still counted here. Computed style added;
    // opacity:0 deliberately still counts as visible — that is Playwright's own
    // visibility definition, and this file follows it everywhere.
    const vis = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const inputs = [...document.querySelectorAll('input[type=text], input:not([type])')].filter(vis);
    if (inputs.length !== 1) return { single: false, looksAuth: false, controls: 0 };
    const el = inputs[0];
    const ctx = [el.placeholder, el.getAttribute('aria-label'), el.name, el.id,
                 document.body.innerText?.slice(0, 300)].join(' ').toLowerCase();
    const looksAuth = /\b(pin|passcode|access\s*code|access|log\s*in|login|sign\s*in|unlock|enter\s*code|password)\b/.test(ctx);
    const controls = document.querySelectorAll('button, [role=button], a[href], select, textarea').length;
    return { single: true, looksAuth, controls };
  });
}

// After an auth ATTEMPT, a still-present gate is PROOF the attempt failed —
// unlike gate ABSENCE, which is only a window (#302: an app whose gate renders
// late still reads as clear). So presence FAILS LOUDLY here, and absence lets
// the scenario proceed while remaining the window it always was. Before this
// check existed, S3/S4/CTRL/NAV/DISMISS discarded detectAndAuth's result: a
// wrong credential, a rotated secret, or the blank-email defect (#304) left
// every one of them measuring the LOGIN SCREEN and passing green.
// COST: two visible-element counts (~ms) — the verdict no longer reruns
// detectAuthGate, whose 5s waitFor used to burn precisely when the gate was
// gone; the budgets sized for that +5s keep it as headroom.
async function expectGateCleared(page, mechanism, gateViewBefore) {
  if (mechanism === 'none') return; // nothing was attempted — nothing to verify
  // The TEXT-gate detector is DISCOVERY-grade, not proof-grade, in BOTH
  // directions — established by counterexample, not judgement: a rejection that
  // reveals a second text input (request-a-new-code email) breaks the
  // single-input condition toward false-clear, and a hidden-but-boxed input
  // with auth-ish context breaks it toward false-throw. A signal that fails
  // both ways does not get to throw. So mechanism 'text-input' attaches an
  // 'auth-unverified' diagnostic and continues — its loud verdict arrives with
  // directives#302's per-project condition, not from a wider heuristic. The
  // PIN and password verdicts stand: their signals are element-kind checks
  // under Playwright's real visibility, which review did not break.
  if (mechanism === 'text-input') {
    test.info().attach('auth-unverified', {
      body: JSON.stringify({
        mechanism,
        note: 'Text/access-code attempts are not verified post-attempt: the text-gate heuristic (single visible auth-ish input) fails in both directions as a verdict, so neither its presence nor its absence is treated as proof. If this scenario then measures a rejection screen, start here. directives#302 tracks the per-project condition that verifies this properly.',
      }, null, 2),
      contentType: 'application/json',
    });
    return;
  }
  // What a signal may DO here depends on what it can PROVE — and the ONLY
  // signal that proves anything post-attempt is input[type=password]: a
  // semantic element, meaningful anywhere it appears (retained first factor
  // or newly revealed second one). It throws. The PIN signal (page-wide
  // digit-button count + dot/pin class names) proves nothing in EITHER
  // position: as a new-gate detector after a password login it reads a
  // calculator or dial pad — or any visible class containing "pin"
  // ("spinner", "pinned") — as a second factor, and even as SAME-KIND
  // retention it cannot tell a rejected PIN's standing gate from the
  // post-login view of a PIN-gated calculator app, whose own keypad
  // satisfies the identical page-wide signals. The count cannot associate
  // itself with the gate that was attempted. So the PIN signal gets what
  // this file gives every non-proof signal (the text-gate rule above): a
  // loud diagnostic, never a throw — directives#302's per-project
  // post-login condition is the real verdict for PIN gates and 2FA alike.
  const pinNow = await pinGateVisible(page);
  const pwNow  = await passwordGateVisible(page);
  if (!pwNow) {
    if (pinNow) {
      test.info().attach(mechanism === 'pin-keypad' ? 'auth-unverified' : 'auth-second-factor-suspected', {
        body: JSON.stringify({
          mechanism,
          note: mechanism === 'pin-keypad'
            ? 'PIN-keypad-like signals (>=9 digit buttons plus a dot/pin-class element) are still visible after the PIN attempt. This is EITHER the retained gate (rejected PIN) OR the app\'s own post-login numeric UI — a PIN-gated calculator or dial pad satisfies the same page-wide signals — and the signal cannot associate itself with the attempted gate, so this is a diagnostic rather than a failure. If downstream scenarios then measure a PIN screen, start here. directives#302 tracks the per-project post-login condition that verifies this properly.'
            : 'The password attempt cleared the password field, but PIN-keypad-like signals are visible (>=9 digit buttons plus a dot/pin-class element). This is EITHER a second auth factor this suite cannot pass with a single credential, OR ordinary numeric UI (calculator, dial pad) on the post-login view — the signal cannot distinguish the two, so this is a diagnostic rather than a failure. If downstream scenarios then measure a PIN screen, start here. directives#302 tracks the per-project post-login condition that verifies this properly.',
        }, null, 2),
        contentType: 'application/json',
      });
    }
    return; // no password gate on screen — cleared, still the WINDOW (#302) stated above
  }
  const attemptedKindGone = mechanism === 'pin-keypad' && !pinNow;
  // THREE versions of a "did login actually succeed" heuristic died in review
  // before this one: (1) any remaining gate fails — false red on an app whose
  // post-login view carries a password field; (2) changed view passes — a
  // rejection's inline error changes the view; (3) changed view + control-rich
  // page passes — login pages with social buttons and footer nav are rich. The
  // counterexamples were not exotic. CONCLUSION, not another heuristic: no DOM
  // shape generically proves a login succeeded. So this check does the one
  // thing it can do honestly — a page that still matches the gate heuristics
  // after an attempt FAILS, loudly, every time.
  //
  // KNOWN LIMIT, accepted: an app whose post-login landing view legitimately
  // shows a visible password field (an in-page change-password form) false-reds
  // here. That failure is LOUD and its message names this paragraph; the
  // alternative — any escape hatch keyed on view change or page richness —
  // passed rejected logins in review, and that failure is SILENT. Loud beats
  // silent. The real fix is per-project post-login evidence (a selector or a
  // request that only exists signed in) — directives#302's condition, which a
  // template cannot invent. When that lands, it replaces this paragraph.
  const viewNow = await viewSignature(page);
  throw new Error(
    `Auth gate still present after a '${mechanism}' attempt` +
    (viewNow === gateViewBefore ? ' (view unchanged)' : ' (view changed — likely a rejection message or reloaded gate)') +
    (attemptedKindGone
      ? ` — the attempted gate cleared but a ${pinNow ? 'PIN/keypad' : 'password'} view is now on screen: ` +
        `a second auth factor, which this suite cannot pass with a single credential`
      : '') +
    ` — refusing to run this scenario against the login screen. Check TEST_AUTH_CREDENTIAL` +
    (mechanism === 'password-form' ? ' and TEST_AUTH_EMAIL (email+password gates need both, directives#304)' : '') +
    `. A rejected credential and a never-filled field look identical from here. If your app's ` +
    `POST-LOGIN view legitimately shows a password field, this is the known limit documented ` +
    `above this throw — the per-project condition in directives#302 is the fix, not a wider heuristic.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE ELEMENT DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────

async function viewSignature(page) {
  return page.evaluate(() => {
    // First VISIBLE heading, not first in the DOM: a display:none SPA keeps the
    // previous view mounted, so querySelector returns the heading of the screen
    // the user just left and every level shares one signature.
    const heads = [...document.querySelectorAll('h1, h2, [role=heading]')];
    const visible = heads.find((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // A non-empty box is not visibility: an SPA that hides the previous view
      // with `visibility: hidden` (or opacity 0) keeps its heading's box, so the
      // stale heading was still picked and sibling levels shared one signature —
      // NAV then stopped drilling or declared the invariant inapplicable.
      // checkVisibility walks the rendered ancestor chain, which a computed-style
      // read on the element alone cannot: opacity is not inherited, so a panel at
      // opacity:0 leaves its heading reporting opacity 1 and a non-empty box.
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          contentVisibilityAuto: true,
        });
      }
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    });
    const h = (visible?.textContent || '').trim().slice(0, 80);
    const buttons = document.querySelectorAll('button, [role=button]').length;
    const inputs = document.querySelectorAll('input:not([type=hidden]), select, textarea').length;
    const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return `${h}#${buttons}#${inputs}#${text}`;
  });
}

// A single visible in-app back control, or an empty locator. Matches an accessible
// name / aria-label of "back" or a left-arrow glyph, or an explicit [data-back] hook.
// Deliberately narrow so the browser's Back button is NOT mistaken for an in-app one.

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
  // 240s, matching upstream. The arithmetic is goto 30 + settle 25 +
  // detectAuthGate 5 + detectAndAuth ~53-94 + post-auth settle 25 + assertions:
  // ~138s at a 4-char credential, ~179s at 8. Healthy runs here measure 11-12s
  // (first live execution, 2026-08-25) — THE BUDGET IS FOR THE FAILING CASE.
  // Until this landed, S2 inherited the 30s default while having never once run.
  test.setTimeout(240_000);
  test.skip(!LIVE_TARGET, 'Local tier serves the app statically and cannot reach the backend — qa-live is the authoritative gate for auth flows.');
  if (!AUTH_CREDENTIAL) test.skip(true, 'No auth credential found in CLAUDE.md or TEST_AUTH_CREDENTIAL env var — skipping auth test');
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const getApiCalls = await captureApiCalls(page);
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});

  // Captured BEFORE the attempt: expectGateCleared compares against it to tell a
  // cleared gate from one that merely re-rendered.
  const gateViewBefore = await viewSignature(page);

  const beforeSnap = await domSnapshot(page);
  const mechanism  = await detectAndAuth(page, AUTH_CREDENTIAL ?? '');
  const afterSnap  = await domSnapshot(page);

  // The defect #309 fixes: detectAndAuth's result was DISCARDED, so a wrong
  // credential left the scenario measuring the login screen and passing green.
  // Our gate is input[type=password] — the only THROWING signal in the kit — so
  // a rejected credential fails here loudly rather than attaching a diagnostic.
  await expectGateCleared(page, mechanism, gateViewBefore);

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
  test.skip(!LIVE_TARGET, 'Local tier serves the app statically and cannot reach the backend — qa-live is the authoritative gate for the interaction sweep.');
  if (!AUTH_CREDENTIAL) test.skip(true, 'No auth credential — skipping interaction sweep (auth required to reach app content)');
  const consoleErrors = [];
  const apiAnomalies  = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  const getApiCalls = await captureApiCalls(page);
  await page.goto('./');
  await page.waitForLoadState('networkidle').catch(() => {});
  const gateViewBefore = await viewSignature(page);
  const mechanism = await detectAndAuth(page, AUTH_CREDENTIAL ?? '');
  await page.waitForLoadState('networkidle').catch(() => {});
  // Without this the sweep maps the LOGIN SCREEN's elements and reports success.
  await expectGateCleared(page, mechanism, gateViewBefore);

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

test('S9: Keep auth gate blocks a signed-out deep link, rejects a bad password, admits the demo user, and releases the session on sign-out', async ({ page }) => {
  test.skip(!LIVE_TARGET, 'The Keep gate is real Supabase Auth — unreachable from the local CI server; qa-live covers it.');
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

  // Discard console noise from the rejected login HERE, scoped to this step,
  // rather than text-filtering at the end. A global /400|401/ filter would also
  // swallow a genuine 400/401 from a later dashboard or sign-out request — and
  // would match any error text that merely contains those digits. Everything
  // logged after this line is asserted strictly.
  consoleErrors.length = 0;

  // 3. Restore the credential the form shipped with → the dashboard opens.
  await pwField.fill(prefilled);
  await authcard.getByRole('button', { name: /log in/i }).click();
  await expect(dashboard, 'The prefilled demo credential did not reach the dashboard').toBeVisible({ timeout: 30_000 });
  await expect(dashboard).toHaveText(/welcome back,/i);
  await expect(authcard, 'The login form is still present after a successful sign-in').toHaveCount(0);

  // 4. Sign out must release the SESSION, not merely render the login page.
  //    Safe to exercise now: js/supabase.js signs out with scope: 'local', so
  //    this revokes only this browser's session. Under the previous global
  //    default it would have signed out real visitors on the shared demo
  //    identity and the other worker running this same spec.
  await page.goto('./#/keep/account');
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(authcard, 'Sign-out did not return to the login form').toBeVisible({ timeout: 30_000 });

  //    Landing on the login page proves nothing on its own: signOutButton()
  //    navigates to #/keep/login unconditionally after awaiting signOut(), so a
  //    failed or no-op sign-out renders exactly the same screen. Re-enter a
  //    protected route and make the guard answer.
  await page.goto('./#/keep');
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(dashboard, 'Session survived sign-out — #/keep still reached the dashboard').toHaveCount(0);
  await expect(authcard, 'Signed-out #/keep did not land on the login form').toBeVisible({ timeout: 30_000 });

  // Console-error gate: no uncaught page errors at any point, and no console
  // errors after the deliberate bad-password step (whose noise was cleared
  // above, scoped to that step).
  expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
});
