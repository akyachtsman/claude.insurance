// keep/logic/policies.js — pure helpers for policy expiry + renewal reminders.
// No Date use here so it's deterministic/testable; the view supplies the actual
// calendar date for display. "renewalInDays" is days from now (negative = past).

// Default lead-times (days before renewal) to send reminders on. Mirrored by the
// profiles.reminder_schedule column default in supabase/migrations — keep in sync.
export const REMINDER_SCHEDULE = [60, 30, 14, 7, 1];

// The ONLY value of `policies.status` that means "in force". Compared after
// trimming and lower-casing, because case and padding cannot be ambiguous.
// Deliberately a one-element set rather than a guess at the vocabulary: `active`
// is the only value that exists in the project today (measured 2026-10-14: 7 of
// 7 rows) and the only one `help-ask`'s prompt names. A value this list does not
// know is reported verbatim rather than rounded to a state — the same choice the
// Help-desk model tier makes for an unrecognised model id, and for the same
// reason: a status nobody recognises is exactly what somebody needs to see.
const IN_FORCE_STATUS = new Set(["active"]);

export function statusIsAffirmative(status) {
  return typeof status === "string" && IN_FORCE_STATUS.has(status.trim().toLowerCase());
}

// A non-affirmative status, shown to the client VERBATIM apart from an initial
// capital. Deliberately not mapped to a friendlier word: this app does not own
// the vocabulary of `policies.status` — the broker writes it, there is no CHECK
// constraint on the column (measured 2026-10-14), and rounding "non-renewed" to
// "Cancelled" would state something the record does not say.
export function statusText(status) {
  const t = String(status == null ? "" : status).trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

// Badge state for a policy.
//
// ⚠️ IT TAKES THE POLICY, NOT A NUMBER, SINCE 2026-10-14 — AND THAT IS THE FIX.
// It used to be `policyKind(renewalInDays)`: a date and nothing else. So no Keep
// screen could see a CANCELLED policy. `policies.status` was selected by the
// adapter and carried on every policy object, and **read by nothing** — a grep
// for `policy.status` across `js/keep/` returned zero consumers. A cancelled
// policy whose renewal date had not yet passed therefore rendered
// "Active · renews <date>", which is the worst thing this app can tell a client
// about their cover.
//
// THE RULE IS NOT INVENTED HERE. It is `help-ask`'s prompt rule, added
// 2026-10-09 for exactly this defect on the other reader of this table:
//
//   "Say a policy is active ONLY IF it has a `status` line that says so AND its
//    `cover starts` date is not in the future. If it has NO `status` line, say
//    the records do not say whether it is active ... a renewal date in the
//    future does NOT mean a policy is active — it may be cancelled, or not yet
//    started."
//
// ⚠️ So the two readers were never contradicting each other, and reading them
// that way is what delayed this. The desk reported `status`; the badge reported
// the date; each presented its own half as the whole answer. "One canonical
// label, one shared module" is usually about a LABEL — this is the same rule one
// layer down, about a FACT, and the module is this function.
//
// Precedence is the prompt's: status, then cover start, then the renewal date.
// Status must come first, or a cancelled policy with no renewal date on file
// would report "Renewal date not on file" instead of "Cancelled".
//
// Kinds: "nostatus" · "ended" · "pending" · null (no renewal date) · "exp" ·
// "warn" · "ok". Only "ok" and "warn" mean in force.
export function policyKind(policy) {
  const p = policy || {};
  // Absent status is NOT a fall-through to the dates. The prompt's comment says
  // why: `status` is nullable, so "no status, cover started in the past" is a
  // real row, and a cancelled policy with no status would read as active.
  if (p.status == null || String(p.status).trim() === "") return "nostatus";
  if (!statusIsAffirmative(p.status)) return "ended";
  // Cover has not begun. `effectiveInDays` is nullable too; absent means the
  // start is unrecorded, which is not evidence that cover is pending.
  if (p.effectiveInDays != null && p.effectiveInDays > 0) return "pending";

  // Unknown renewal date. Load-bearing: policies.renewal_date is nullable, so
  // renewalInDays arrives as null, and `null <= 0` is TRUE — without this the
  // client was told a perfectly live policy had lapsed. `renewalBand` takes the
  // same early return; these two must agree on what "unknown" means.
  const d = p.renewalInDays;
  if (d == null) return null;  // unknown — not a state, absent data
  if (d <= 0) return "exp";    // due today / expired / lapsed
  if (d <= 30) return "warn";  // expiring soon
  return "ok";                 // active
}

// Urgency band for an upcoming renewal, escalating as the date nears. Drives the
// colour priority on the landing renewals report. Returns null when the renewal
// is further out than the 60-day report window (or unknown).
// Bands: lapsed (past) · urgent (≤3d) · week (≤7d) · soon (≤30d) · upcoming (≤60d).
export function renewalBand(renewalInDays) {
  if (renewalInDays == null) return null;
  if (renewalInDays < 0) return "lapsed";
  if (renewalInDays <= 3) return "urgent";
  if (renewalInDays <= 7) return "week";
  if (renewalInDays <= 30) return "soon";
  if (renewalInDays <= 60) return "upcoming";
  return null;
}

// SINGLE source of truth for how a policy line presents everywhere, keyed on the
// canonical `line`. Each facet: key + label (the specific coverage type) + icon
// (detailed frame-less glyph for the Policies table's leading column) + card
// (small glyph on policy detail cards) + color (the `cic` tile-colour class).
// The adapter (js/supabase.js) and the views all read from here, so the two
// former line→presentation maps can no longer drift.
const POLICY_LINE = {
  "Homeowners (HO-3)": { key: "home", label: "Home insurance", icon: "as-home", card: "home", color: "home" },
  "Windstorm": { key: "windstorm", label: "Windstorm insurance", icon: "as-home", card: "umbrella", color: "home" },
  "Flood (NFIP)": { key: "flood", label: "Flood insurance", icon: "as-home", card: "flood", color: "boat" },
  "Dwelling": { key: "dwelling", label: "Dwelling insurance", icon: "as-home", card: "home", color: "home" },
  "Personal auto": { key: "auto", label: "Auto insurance", icon: "as-auto", card: "auto", color: "auto" },
  "Commercial auto": { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck", card: "commercial-auto", color: "auto" },
  "Watercraft": { key: "watercraft", label: "Watercraft insurance", icon: "as-boat", card: "boat", color: "boat" },
  "Scheduled personal property": { key: "valuables", label: "Valuables insurance", icon: "as-gem", card: "gem", color: "gem" },
  "Business owner's policy (BOP)": { key: "business", label: "Business insurance", icon: "as-commercial", card: "general-liability", color: "cp" },
  "General liability": { key: "liability", label: "Liability insurance", icon: "as-shield", card: "general-liability", color: "cp" },
  "Umbrella": { key: "umbrella", label: "Umbrella insurance", icon: "as-shield", card: "umbrella", color: "cp" },
};
const POLICY_LINE_OTHER = { key: "other", label: "Other", icon: "as-box", card: "shield", color: "home" };

// Ordered [pattern, facet] fallbacks — first match wins, so more specific lines
// (commercial auto, E&O, umbrella) must precede their broader cousins.
const POLICY_LINE_FALLBACK = [
  [/flood/, { key: "flood", label: "Flood insurance", icon: "as-home", card: "flood", color: "boat" }],
  [/wind|hail/, { key: "windstorm", label: "Windstorm insurance", icon: "as-home", card: "umbrella", color: "home" }],
  [/errors|omission|\be&o\b|professional liab/, { key: "eo", label: "Errors & omissions (E&O)", icon: "as-shield", card: "general-liability", color: "cp" }],
  [/worker|comp\b/, { key: "workers", label: "Workers' comp", icon: "as-commercial", card: "general-liability", color: "cp" }],
  [/umbrella/, { key: "umbrella", label: "Umbrella insurance", icon: "as-shield", card: "umbrella", color: "cp" }],
  // Auto lines are more specific than bare "liability" — a "commercial auto
  // liability" policy must match auto, not the general-liability catch-all
  // below. commercial-auto stays ahead of plain auto (it contains "auto").
  [/commercial auto/, { key: "commercial-auto", label: "Commercial auto insurance", icon: "as-truck", card: "commercial-auto", color: "auto" }],
  [/\bauto\b|vehicle|motor/, { key: "auto", label: "Auto insurance", icon: "as-auto", card: "auto", color: "auto" }],
  [/liability/, { key: "liability", label: "Liability insurance", icon: "as-shield", card: "general-liability", color: "cp" }],
  [/renter/, { key: "renters", label: "Renters insurance", icon: "as-home", card: "home", color: "home" }],
  [/condo/, { key: "condo", label: "Condo insurance", icon: "as-home", card: "home", color: "home" }],
  [/watercraft|boat|marine|yacht/, { key: "watercraft", label: "Watercraft insurance", icon: "as-boat", card: "boat", color: "boat" }],
  [/jewel|scheduled|valuab|fine art|collect/, { key: "valuables", label: "Valuables insurance", icon: "as-gem", card: "gem", color: "gem" }],
  [/business|\bbop\b|commercial|general/, { key: "business", label: "Business insurance", icon: "as-commercial", card: "general-liability", color: "cp" }],
  [/home|dwelling|hazard|property/, { key: "home", label: "Home insurance", icon: "as-home", card: "home", color: "home" }],
];

// The full presentation facet for a policy (or a bare line string). Used by the
// adapter to set the card icon + tile colour.
export function policyPresentation(policyOrLine) {
  const line = typeof policyOrLine === "string" ? policyOrLine : (policyOrLine && policyOrLine.line ? policyOrLine.line : "");
  // hasOwnProperty, not a bare lookup: `line` is free text, and
  // POLICY_LINE["constructor"] would otherwise return Object's constructor —
  // truthy, so the guard passes, and every facet read comes back undefined.
  if (Object.prototype.hasOwnProperty.call(POLICY_LINE, line)) return POLICY_LINE[line];
  const s = line.toLowerCase();
  for (const [pattern, facet] of POLICY_LINE_FALLBACK) if (pattern.test(s)) return facet;
  return POLICY_LINE_OTHER;
}

// The specific coverage type + the table's leading detailed icon.
export function policyType(policy) {
  const f = policyPresentation(policy);
  return { key: f.key, label: f.label, icon: f.icon };
}

// Annual premium as a number. Prefers the numeric source of truth
// (premiumAmount + premiumPeriod); falls back to parsing a `premium` text
// string ("$2,260 / yr"). Monthly is annualised (×12).
//
// The text path is NOT for "rows not yet migrated" — migration
// 20260713024147_policies_drop_premium_text dropped that column, so no live row
// can carry it. It survives for policy objects the adapter did not build: the
// offline fixture in js/keep/fixtures/sample.mjs (which still holds premium strings)
// and any hand-built row. Delete it only together with the fixture's strings.
export function annualPremium(policy) {
  if (policy == null) return null;
  if (policy.premiumAmount != null && Number.isFinite(policy.premiumAmount)) {
    const amt = Math.round(policy.premiumAmount);
    return /mo|month/i.test(policy.premiumPeriod || "") ? amt * 12 : amt;
  }
  const raw = policy.premium;
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  const m = String(raw).replace(/,/g, "").match(/-?[\d.]+/);
  if (!m) return null;
  const amt = parseFloat(m[0]);
  if (!Number.isFinite(amt)) return null;
  return Math.round(/\/\s*mo|month/i.test(raw) ? amt * 12 : amt);
}

// Display string for a premium ("$2,260 / yr"), formatted from the numeric
// source when present, else the legacy text, else "—".
export function formatPremium(policy) {
  if (policy && policy.premiumAmount != null && Number.isFinite(policy.premiumAmount)) {
    return `$${Math.round(policy.premiumAmount).toLocaleString("en-US")} / ${policy.premiumPeriod || "yr"}`;
  }
  return (policy && policy.premium) || "—";
}

// Which reminders have already fired and which is next, for a given lead-time
// schedule (default 60/30/14/7/1 days before renewal).
export function reminderInfo(renewalInDays, schedule = REMINDER_SCHEDULE) {
  // Unknown renewal date: nothing has been sent and nothing is scheduled.
  // Without this, `d > null` coerces to `d > 0` and every lead time reads as
  // already fired — telling the client all five reminders had gone out.
  if (renewalInDays == null) return { sent: [], next: null };
  const sent = schedule.filter((d) => d > renewalInDays).sort((a, b) => b - a);
  const upcoming = schedule.filter((d) => d <= renewalInDays).sort((a, b) => b - a);
  return { sent, next: upcoming.length ? upcoming[0] : null };
}

// The three numbers the Policies summary tiles report, from a list of
// renewalInDays values. Extracted from the view so the UNKNOWN case is
// unit-testable: every counter here routes through policyKind, so they cannot
// disagree about a policy with no renewal_date on file the way the inline
// versions did (`policyKind(x) !== "exp"` counted it as in force while the
// neighbouring `x <= 30` test correctly left it out).
//
// `undated` is NOT folded into either count. An undated policy is neither
// provably in force nor provably urgent, so it is surfaced on its own and the
// view labels it — absent data reported as absent, not guessed either way.
// ⚠️ TAKES POLICIES, NOT A LIST OF DAYS, since policyKind does. Passing
// `rows.map((r) => r.policy.renewalInDays)` here now yields `undated` for every
// row (a bare number has no `.status`), which is loud rather than silent — the
// deliberate direction for a signature change nothing else can catch.
//
// `undated` keeps its name and now covers every policy that is not PROVABLY in
// force or in trouble: no renewal date, no status, a status we do not recognise,
// or cover that has not started. All four are "absent or unclear data reported
// as such, never guessed into one of the other two counts", which is the rule
// this function was extracted to make testable in the first place.
export function renewalCounts(policies) {
  const out = { active: 0, attention: 0, undated: 0 };
  for (const p of policies || []) {
    const k = policyKind(p);
    if (k === null || k === "nostatus" || k === "ended" || k === "pending") out.undated += 1;
    if (k === "ok" || k === "warn") out.active += 1;        // "warn" = expiring soon, still in force
    if (k === "exp" || k === "warn") out.attention += 1;    // lapsed, or inside 30 days
  }
  return out;
}
