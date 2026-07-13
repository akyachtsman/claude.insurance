# The Keep — data model & label organization

**Rule:** every label shown in any view derives from one canonical record field,
through one shared module. Labels are never re-synthesized per view — that's what
caused the "You · personal" (map) vs "UBO" (table) divergence.

## Canonical records (Supabase, RLS-protected)

| Table | Canonical identity/type fields | Notes |
|---|---|---|
| `entities` | `kind` ∈ {personal, business, trust, person}, `name`, `subtype` | `subtype` is the **one** specific-type column ("LLC", "Revocable Trust", "Spouse"). `label` is legacy/display-only — no longer written or read as identity. |
| `entity_relationships` | `from_entity`, `to_entity`, `role`, `stake` | Directed ownership/trustee edges. |
| `assets` | `type`, `name`, `value`, `meta` | `type` is the one key driving icon/label/depreciation. |
| `policies` | `line`, `carrier`, `number`, `renewal_date`, `premium`, `coverages`, `documents` | `line` is the one key driving type label + icons + colour. |
| `profiles` | `full_name`, `role` ∈ {client, broker, underwriter} | |

## Where every label comes from (one source each)

| Domain | Canonical field | Single source module | Produces |
|---|---|---|---|
| Entity | `kind` (+ `subtype`) | `js/keep/entity-display.js` | category (UBO / Individual / Company / Trust), subtype text, colour, avatar icon, map sub-label |
| Asset | `type` | `js/keep/data.js` `ASSET_META` | label, icon, colour · (+ `depreciation.js` for ACV) |
| Policy | `line` | `js/keep/policies.js` `policyPresentation` | type label, table icon, card icon, tile colour |

- `js/supabase.js` is a **thin adapter**: it maps DB rows to the view shape and
  reads the same source modules (e.g. `policyPresentation` for a policy's card
  icon) — it does not invent labels. `getMapData` returns raw record fields; the
  view derives the display sub-label via `entityMapSub`.
- The account holder (`kind === "personal"`) is the **UBO**. It's a distinct
  category (not "Individual"), so it isn't double-counted, and its map node reads
  "You · UBO" — computed in one place, so it agrees everywhere.

## `entities.label` was overloaded — now split (migration `entities_split_label_overload`)

`label` used to carry three different things by kind. It's been split so each
lands in a proper column and `subtype` consistently means "the specific type":

| kind | before (`label`) | now |
|---|---|---|
| business | industry ("Media", "Real estate") | → `industry` column · `subtype` = legal structure ("LLC", "C-Corp") |
| person | relationship role ("Spouse", "Child") | → `subtype` ("Spouse") · was generic "Individual" |
| trust | specific trust type ("Revocable trust") | → `subtype` ("Revocable trust") · was generic "Trust" |
| personal | "You · personal" | cleared earlier |

`label` is now fully retired (null everywhere). `subtype` holds the specific
type; businesses carry `industry` separately (surfaced on the entity detail as
"LLC · Media" via `entityIndustry`). The migration was output-neutral — the app
already read the specific type from `subtype`.

## Completed normalizations

- **`policies.premium` → numeric** (migration `policies_premium_numeric`).
  Added `premium_amount` + `premium_period` ('yr'|'mo'), backfilled from the
  legacy text. `annualPremium` reads the numeric source; `formatPremium` renders
  the display string. The `premium` text column is kept as a display fallback.
- **`policies.documents` → typed records** (migration `policies_documents_typed`).
  Each document is now `{ name, kind }` instead of a bare string. Read through
  `docName`/`docKind` (js/keep/docfile.js), which accept either shape.
- **Stale personal `label` cleared** (migration `clear_stale_personal_entity_label`).
- **`entities.label` overload split** (migration `entities_split_label_overload`) —
  business industry → `industry`, person role & trust type → `subtype`, `label` retired.

## Known follow-ups (still open)

- None outstanding at the data-model level.
