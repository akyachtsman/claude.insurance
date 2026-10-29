# Design gaps

Where this project does not yet meet the house standard (`claude.directives`
`design.md`, owner rulings 2026-10-19), one line per screen and group, each
with the file it lives in. A change that touches a listed screen brings it up
to the standard, or says in its PR why not, and deletes the line it fixes.

Written 2026-10-29 at step 1 of the house-style move (`/design-intake` 1c).
Every screen below is still on its own look: its root carries `legacy-screen`
(set by `mount()` in `js/dom.js`, and in `index.html` for the chrome), and its
own classes are the renamed `legacy-btn`, `legacy-btn-primary`,
`legacy-btn-secondary`, `legacy-card`, `legacy-field`, `legacy-pill` and
`legacy-tag`. Step 2 moves them, in the order the owner picks from this list.
The palette and fonts are this project's own by owner ruling (CLAUDE.md →
Design Theme), so a moved screen takes the house components and patterns, not
the house colours.

## Contrast (whole project)

- `--color-accent` on `--color-bg` is **4.26:1**, under 4.5: every accent link and
  accent text at body size on the page canvas (`styles/tokens.css`; about 100
  `color: var(--color-accent)` rules in `css/`). The guardrail holds accent only
  against the surface (4.65) and does not measure this pair.
- The status colours `--color-ok`, `--color-warn` and `--color-gap` as text on
  their own tints measure **3.75, 3.88 and 4.15**, under 4.5: the expiry badges,
  gap counts and needs cards (`css/keep.css`, `css/views.css`, `css/forms.css`).
  The house status tokens now in `styles/tokens.css` pass; a moved screen uses
  those instead.

## Public site

- Site header and footer, with the `legacy-btn` call to action: `index.html`, `css/components.css`
- Shared marketing blocks (call-to-action links, glossary, progress bar): `js/components/ui.js`, `js/components/glossary.js`, `js/components/progress.js`
- Landing page (`#/`): `js/views/landing.js`, `css/views.css`
- Coverage sections (`#/residential`, `#/commercial`): `js/views/section.js`, `css/views.css`
- Coverage topic (`#/coverage/:id`): `js/views/coverage.js`, `css/views.css`
- Qualification flow and contact step (`#/qualify`): `js/views/qualify.js`, `css/forms.css`
- Summary (`#/summary`), including its empty state: `js/views/summary.js`, `css/forms.css`

## The Keep

- App chrome (app bar, compact nav and account menus, search, back links, demo ribbon): `js/keep/views/shell.js`, `css/keep.css`
- Login: `js/keep/views/keep.js`, `css/keep.css`
- Home (welcome, command box, at a glance, renewals, request status): `js/keep/views/keep.js`, `css/keep.css`
- Entities (list, cards, relationships map) and entity detail: `js/keep/views/entities.js`, `js/keep/views/relmap-view.js`, `css/keep.css`
- Add entity: `js/keep/views/keep.js`, `css/keep.css`
- Assets table, asset detail and add asset: `js/keep/views/assets.js`, `css/keep.css`
- Policies, policy detail, the request form and My requests: `js/keep/views/policies-view.js`, `css/keep.css`
- Documents, Account and Security (with the broker's Help desk model control): `js/keep/views/keep.js`, `css/keep.css`
- Help desk: `js/keep/views/help-view.js`, `css/keep.css`
