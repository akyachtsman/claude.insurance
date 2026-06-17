#!/usr/bin/env bash
# Preinstall the Playwright Chromium browser so the UI tests (.github/scripts/ui-tests)
# can run headlessly in cloud sessions. Idempotent — Playwright skips the download if
# the browser is already on disk — so this is cheap on cached or local environments.
#
# Requires network egress to cdn.playwright.dev (allow it via the environment's
# Network access settings: Custom + "cdn.playwright.dev", or Full). If egress is
# blocked the install fails harmlessly and the session still starts.
set -u

ui_dir="$(cd "$(dirname "$0")/../.github/scripts/ui-tests" 2>/dev/null && pwd)"
[ -n "${ui_dir:-}" ] || exit 0

# Skip quickly if a chromium build is already present.
if ls "$HOME"/.cache/ms-playwright/chromium-* >/dev/null 2>&1; then
  exit 0
fi

( cd "$ui_dir" && npx --yes playwright install chromium ) || true
