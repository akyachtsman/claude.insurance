# `fitProblems`' default 2s cap times out on headless WebKit

**Status:** written, not sent. Found 2026-10-25 in `claude.insurance`, writing
the S5+ type-ahead scenarios the iPhone message asks for. Upstream head read:
`83597ffec71473b0c972e8802fdc5ed5417ecccc`.

## What

`templates/ui-tests/tests/lib/fit.js` races one `evaluateAll` against
`FIT_MS = 2000`. For every box that scrolls it awaits two animation frames
(`frame()`), and headless WebKit delivers frames late under load.

Measured on this repo's `iphone` project (WebKit, iPhone 12) over seven runs of
the same two scenarios, each checking one type-ahead list of ~10 rows:

| engine | one `fitProblems` call |
|---|---|
| WebKit (`iphone`) | **22ms to 2545ms** |
| Chromium (`mobile-chrome`) | 14ms to 89ms |

So at the default cap the check reported `FIT CHECK TIMED OUT after 2000ms` on
a list that fits, on the one project the check exists for. Run with
`{ timeout: 10_000 }`, every one of the same runs came back empty.

## Why it matters upstream

DISMISS adds `FIT_MS` to each of its 27 overlay paths, and `iphone` is the
project that has to be trusted. A cap that trips on a passing list makes the
`fit` dismisser report a finding that is not real, on WebKit only, which is the
shape that gets a check muted.

## Suggested fix

Raise the default (this repo uses 10s per call), or cap the frames rather than
the call. This repo passes the timeout at its own call sites and keeps the
vendored `fit.js` verbatim.
