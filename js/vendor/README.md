# js/vendor/ — third-party code, not ours

Files here are **vendored dependencies**: pinned third-party builds committed so
the app boots from its own origin with no runtime fetch to anyone else.

Do not hand-edit them. Do not apply this project's coding standards to them —
they are someone else's output and are replaced wholesale, never patched.

## supabase-js.js

| | |
|---|---|
| package | `@supabase/supabase-js` |
| version | **2.112.4** (pinned exactly — not `@2`) |
| built | 2026-08-26 |
| sha256 | `d8290c68c5362ccdbef284b89c0595f129e5153b4be6c78a9d77537a43c15003` |

**Why it is here.** The app previously imported this client from
`https://esm.sh/@supabase/supabase-js@2` at runtime, on every page load, at a
**floating major version**. That put a third party on the critical path of every
render — including the authenticated Keep portal — so an esm.sh outage took the
app down and an esm.sh compromise would have executed in users' browsers with
access to their Supabase session. ES module imports cannot carry an integrity
hash, so there was no way to pin that path. Vendoring removes it entirely.

### Regenerate

⚠️ **Run this from the repository root.** The block enters `js/vendor/` itself on
its first line and every path after that is relative to it — so do **not** `cd`
there first, or `cd js/vendor` resolves to `js/vendor/js/vendor` and the
regeneration either aborts (under `set -e`) or, worse, carries on in the wrong
directory without it.

That first line is load-bearing and must stay. An earlier version of this block
used bare relative paths with no `cd`, so running it from the root — the normal
way to run a documented repo command — wrote `entry.mjs` and `supabase-js.js`
**into the root** and left the deployed `js/vendor/supabase-js.js`, the file the
app actually imports, untouched. The build succeeded, the sha256 matched the
artifact you had just made, and nothing shipped.

```sh
cd js/vendor
npm ci                       # exact tree from package-lock.json — never `npm install`
echo "export { createClient } from '@supabase/supabase-js';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser \
  --target=es2020 --minify --legal-comments=eof --outfile=supabase-js.js
sha256sum supabase-js.js     # must equal the value in the table above
rm -rf entry.mjs node_modules
```

⚠️ **`npm ci` against the committed lockfile, never `npm install`.** Pinning
`@supabase/supabase-js` and `esbuild` pins only those two: their **transitive**
dependencies resolve by range, so a clean `npm install` after any of them
publishes a compatible release produces a different tree — different bytes and a
different licence inventory — while both named versions still read as unchanged.
`package-lock.json` here pins all 36 packages, and it is what makes the sha256
above a reproducible claim rather than a description of one past build.
*(Verified 2026-08-26: `npm ci` + the command above reproduces the recorded hash
byte-for-byte.)*

⚠️ **The sha256 is a claim about a *bundler build*, not just about the Supabase
source.** An unpinned `esbuild` installs whatever is current and can emit a
different byte sequence from identical input, failing the check while nothing is
actually wrong. The lockfile pins the bundler too.

⚠️ **`--legal-comments=eof`, never `none`.** Stripping licence banners from
MIT-licensed code you redistribute is a licence violation. It happens that these
packages ship no banners today — `eof` currently produces a byte-identical file
— so the notices live in `LICENSES.md` instead. The flag stays `eof` so that a
future dependency version which *does* ship them carries them through without
anyone remembering to change it.

**Verify after regenerating** — also from the repository root, so every path in
this file means the same thing:

```sh
grep -cE 'from"[^."/]' js/vendor/supabase-js.js   # bare imports        -> 0
grep -c  'esm\.sh'      js/vendor/supabase-js.js   # remote references   -> 0
grep -c  'createClient' js/vendor/supabase-js.js   # export present      -> >=1
node --check            js/vendor/supabase-js.js   # parses
sha256sum               js/vendor/supabase-js.js   # matches the table above
```

⚠️ **`LICENSES.md` IS PART OF THIS ARTIFACT — regenerate it too.** The bundle
compiles nine packages into one file, so their licence notices must travel with
it. `LICENSES.md` is that notice and it is generated from the same
`node_modules` tree as the bundle; a bundle refreshed without it redistributes
someone else's code with the required notice missing. The nine are the runtime
dependencies in `package-lock.json` (the `@esbuild/*` platform binaries are
build-only and are not bundled).

⚠️ **`index.html` must keep `js/vendor/supabase-js.js` in its `MODULES` list.**
That list builds the cache-busting import map. `js/supabase.js` imports this
bundle by a *relative* path, which resolves to an unversioned URL unless the map
rewrites it — so dropping the entry means returning browsers keep serving the
old bundle indefinitely and a security update never reaches them.

⚠️ **REVISIT TRIGGER — a pinned bundle does not self-update.** Re-run the command
above and re-verify **whenever a Supabase client security advisory lands, and
otherwise at each `/refresh-repo`**. This is the cost of vendoring, accepted
deliberately: a dependency updated on a schedule beats one that can change or
vanish mid-request.

**Check the trigger like this, from the repository root:**

```sh
cd js/vendor && npm audit --package-lock-only
```

It reads the committed lockfile, so it needs no install and no network beyond
the registry. **Version drift is NOT the trigger** — an advisory is. Do not
regenerate a 216KB third-party bundle because minor releases have shipped; the
whole point of pinning is that it does not move on its own.

#### Advisory-check log

Record every check here, with its result and the drift at the time. An
unrecorded check is invisible: the next session cannot tell "checked, clean"
from "never looked", so it either redoes the work blind or skips it — and
skipping reads exactly like a clean result. That is the failure shape this
whole directory exists to avoid, so the log is part of the obligation, not
bookkeeping about it.

| date | result | pinned | latest then | action |
|---|---|---|---|---|
| 2026-10-05 | **0 advisories** (info→critical, all zero) | 2.112.4 | 2.117.2 | none — trigger did not fire |

⚠️ **What that check does and does not cover.** It queries **npm's advisory
database only**. A cross-check against GitHub's global advisory DB was attempted
and **refused with 403** — a Claude Code session is bound to its configured
repositories, so `/advisories` is unavailable here. So a clean row above rests on
**one source, not two**. It would not catch a Supabase-authored security notice
that was never filed as an npm advisory. If you need that assurance, check the
`supabase/supabase-js` repository's own security advisories by hand.

### package.json / package-lock.json

Build-only. They are **not** shipped to users in any meaningful sense (nothing
imports them; the browser never reads them) and exist solely to make the bundle
reproducible. `node_modules/` and `entry.mjs` are gitignored; the lockfile is
deliberately **not**.
