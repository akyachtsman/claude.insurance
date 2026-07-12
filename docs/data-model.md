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

## Known follow-ups (need a DB migration → separate, approval-gated)

- `entities.label` still holds stale free text ("You · personal") on old rows.
  Harmless now (nothing reads it for identity); a migration can null it out.
- `policies.premium` is `text` ("$2,260 / yr"); parsed by `annualPremium`. Could
  become a numeric amount + period.
- `policies.documents` is a jsonb string array with no id/type; could become a
  typed shape or its own table if documents grow beyond display.
