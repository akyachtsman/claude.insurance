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

## `entities.label` is overloaded (real data, not stale)

A read of live data corrected an earlier assumption: `label` is **not** junk — it
carries different meaning per kind, distinct from `subtype` (the legal structure):

| kind | `label` holds | `subtype` holds |
|---|---|---|
| business | **industry** ("Media", "Real estate", "Holding company") | legal structure ("LLC", "C-Corp") |
| person | **relationship role** ("Spouse", "Child", "Business partner") | often generic "Individual" |
| trust | **specific trust type** ("Revocable trust", "Irrevocable trust") | generic "Trust" |
| personal | *(was "You · personal" — cleared)* | null |

`entitySubtype` deliberately surfaces `label` when `subtype` is generic (so a
person shows their role, a trust its specific type). **Do not blanket-clear
`label`** — it would lose the industry/role/trust-type. Only the stale personal
identity string was removed (migration `clear_stale_personal_entity_label`). A
proper tidy would split business industry into its own column — deliberate schema
work, not an automated cleanup.

## Known follow-ups (need a DB migration → separate, approval-gated)

- `policies.premium` is `text` ("$2,260 / yr"); parsed by `annualPremium`. Could
  become a numeric amount + period.
- `policies.documents` is a jsonb string array with no id/type; could become a
  typed shape or its own table if documents grow beyond display.
- `entities.label` overload (industry vs role vs trust-type) → a dedicated
  `industry` column for businesses would be cleaner than the shared field.
