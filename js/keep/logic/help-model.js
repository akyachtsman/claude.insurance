// help-model.js — the Help desk's model tiers, for the broker-facing control.
//
// Pure: no DOM, no network. The view renders it; `js/supabase.js` reads and
// writes the stored value; the Edge Function allow-lists the same ids again on
// its own side.
//
// ⚠️ THE ALLOWED IDS EXIST IN THREE PLACES AND THAT IS DELIBERATE, NOT SLOPPY.
// This file (what a broker can pick), `HELP_MODELS` in
// `supabase/functions/help-ask/handler.ts` (what may reach the provider), and a
// CHECK constraint in `supabase/migrations/20261014001500_help_settings.sql`
// (what may be stored at all). None of the three can import from the others —
// one is browser ES modules, one is Deno, one is SQL — so the copies are a fact
// of the deployment rather than a choice.
//
// What is NOT left to care: `help-model.test.mjs` parses all three sources and
// asserts the lists are IDENTICAL, in the same ORDER. Order matters because the
// default is positional in two of the three (`HELP_MODELS[0]` and the column
// default), so set equality alone would let the default diverge silently.
//
// Why three layers rather than trusting one: an id the provider does not know
// comes back 400, and FR-17 renders every failure as the same quiet "not
// available" notice — so a bad value here would be indistinguishable from an
// outage, a missing key, or an undeployed function. That single notice is this
// repo's most repeated defect.

// Order is load-bearing: the first entry is the default, in this file, in
// `handler.ts`, and in the column default.
export const HELP_MODEL_CHOICES = [
  {
    id: "claude-opus-5-5",
    label: "Opus",
    blurb: "Deepest reasoning. The default, and what the desk was proven on.",
    inPer1M: 4,
    outPer1M: 20,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet",
    blurb: "Half the cost of Opus, and strong on straightforward questions.",
    inPer1M: 2,
    outPer1M: 10,
  },
  {
    id: "claude-haiku-5-5",
    label: "Haiku",
    blurb: "Fastest and cheapest. Best for high volume, weakest on nuance.",
    inPer1M: 0.1,
    outPer1M: 0.5,
  },
];

export const DEFAULT_HELP_MODEL = HELP_MODEL_CHOICES[0].id;

// ⚠️ DATED ON PURPOSE. These are Anthropic list prices as recorded in CLAUDE.md
// on 2026-10-13; nothing in this app reads them from a billing API, so they are
// a snapshot and will eventually be wrong. The control shows this line beside
// them rather than presenting a stale number as live — the alternative, dropping
// the figures entirely, would leave a broker choosing a spend tier with no idea
// of the ratio, which is the only reason the control exists.
export const PRICES_AS_AT = "2026-10-13";

/** True only for an id a broker may actually select. Case and surrounding space
 *  are forgiven for the same reason `resolveModel` forgives them — they cannot
 *  be ambiguous — so a value round-tripped through a form still matches. */
export function isHelpModel(id) {
  const want = typeof id === "string" ? id.trim().toLowerCase() : "";
  return HELP_MODEL_CHOICES.some((c) => c.id === want);
}

/** The display label for a stored id, or "" when it is not one of ours.
 *  "" rather than the raw id: an unrecognised value is not something to put on
 *  screen as though it were a tier, and the caller decides what to say instead. */
export function helpModelLabel(id) {
  const want = typeof id === "string" ? id.trim().toLowerCase() : "";
  const hit = HELP_MODEL_CHOICES.find((c) => c.id === want);
  return hit ? hit.label : "";
}

/** The stored value, normalised, or the default when it is absent or unknown.
 *  Falls back rather than refusing, matching the function: a bad stored value
 *  should cost a wrong-looking control, not a dead help desk. */
export function normaliseHelpModel(id) {
  const want = typeof id === "string" ? id.trim().toLowerCase() : "";
  return isHelpModel(want) ? want : DEFAULT_HELP_MODEL;
}

/** "$4 / $20 per million tokens in / out" — one shared formatter so the control
 *  and any future readout cannot disagree about how a price is written. */
export function priceLine(choice) {
  const n = (v) => (Number.isInteger(v) ? `$${v}` : `$${Number(v).toFixed(2)}`);
  return `${n(choice.inPer1M)} / ${n(choice.outPer1M)} per million tokens in / out`;
}
