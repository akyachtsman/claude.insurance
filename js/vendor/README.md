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

**Regenerate** (produces this exact file — esbuild is deterministic for a given
version and flag set, so `sha256sum` should match the value above):

```sh
npm install @supabase/supabase-js@2.112.4 esbuild@0.28.2
echo "export { createClient } from '@supabase/supabase-js';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser \
  --target=es2020 --minify --legal-comments=eof --outfile=supabase-js.js
```

⚠️ **Both versions are pinned, and the esbuild pin is load-bearing.** The sha256
above is a claim about a *bundler build*, not just about the Supabase source: an
unpinned `esbuild` installs whatever is current and can emit a different byte
sequence from identical input, failing the check while nothing is actually
wrong. Pinning both is what makes the hash mean anything.

⚠️ **`--legal-comments=eof`, never `none`.** Stripping licence banners from
MIT-licensed code you redistribute is a licence violation. It happens that these
packages ship no banners today — `eof` currently produces a byte-identical file
— so the notices live in `LICENSES.md` instead. The flag stays `eof` so that a
future dependency version which *does* ship them carries them through without
anyone remembering to change it.

The bundle is built with esbuild **0.28.2**. Verify after regenerating: no bare
imports (`grep -cE 'from"[^."/]'` → 0), no remote references
(`grep -c 'esm\.sh'` → 0), and `createClient` exported.

⚠️ **`LICENSES.md` IS PART OF THIS ARTIFACT — regenerate it too.** The bundle
compiles nine packages into one file, so their licence notices must travel with
it. `LICENSES.md` is that notice and it is generated from the same
`node_modules` tree as the bundle; a bundle refreshed without it redistributes
someone else's code with the required notice missing.

⚠️ **REVISIT TRIGGER — a pinned bundle does not self-update.** Re-run the command
above and re-verify **whenever a Supabase client security advisory lands, and
otherwise at each `/refresh-repo`**. This is the cost of vendoring, accepted
deliberately: a dependency updated on a schedule beats one that can change or
vanish mid-request.
