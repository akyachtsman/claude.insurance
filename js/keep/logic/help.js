// keep/logic/help.js — pure helpers for the Keep's help desk (#/keep/help).
// No DOM, no network, no imports: question validation, suggestion chips derived
// from the help corpus, and the shaping of whatever the `help-ask` Edge Function
// returns. Unit-tested (help.test.mjs).
//
// Spec: specs/003-help-desk/spec.md · Plan: specs/003-help-desk/plan.md (T3).
//
// The contract with the function, in one place so T5 has something to satisfy:
//   success →  { answer: "<text>", usedTopics: ["<topic id>", …],
//                usedRecords: ["<display line>", …],
//                reason: "answered" | "refused" | "no_records" }
//   failure →  { answer: null, reason: "<key of FAILURE_NOTICE>",
//                retryAfter: <seconds, rate_limited only — sent ONLY when the
//                            function can actually derive it>,
//                window:     <seconds, rate_limited only — the cap's window,
//                            sent INSTEAD of retryAfter when the wait cannot be
//                            derived. The two are mutually exclusive.>,
//                scope: "client" | "shared" (rate_limited only — WHICH cap) }
// Credited TOPICS travel as corpus ids, never as titles: the title shown to the
// client is read back from the corpus by creditedTopics(), per CLAUDE.md's "one
// canonical label, one shared module" rule. A model's own wording for a screen
// is not a label. Credited RECORDS have no corpus to resolve against — they are
// the client's own rows — so the function sends the display line and the view
// renders it as text.

// Matches the limit the FUNCTION enforces — `handler.ts`'s QUESTION_MAX, which is
// now the only authority for the number.
//
// ⚠️ TWO CORRECTIONS, and the second was still wrong after the first. This note
// used to describe a `help_queries` CHECK constraint
// (`char_length(btrim(question)) >= 1 and char_length(question) <= 500`); that
// table no longer stores the question text at all, because nothing read it. The
// first fix pointed here at `handler.ts` instead — but kept the constraint's
// ASYMMETRY, which the handler does not share:
//
//     const question = payload.question.trim();          // handler.ts
//     if (question.length > QUESTION_MAX) ... "invalid";  // the TRIMMED length
//
// The old CHECK capped the RAW column and tested non-blankness on the trimmed
// text, so padding could not buy characters. The handler trims FIRST, so both
// tests are on the trimmed text and padding is simply ignored: measured, 400
// spaces + 500 x's (raw 900) is ACCEPTED, and 501 x's is not.
//
// What that retires is a whole hazard this file was built around: there is no
// longer any way to be told a question is fine here and then have the server
// refuse it for length, because the server normalises the same way. cleanQuestion()
// is still the documented entry — it keeps what the client sees validated
// identical to what is sent — but it is no longer load-bearing against a
// server-side rejection.
export const QUESTION_MAX = 500;

// How many suggestion chips the empty state offers (FR-2). The corpus is longer
// than any sensible chip row, so the cap lives here rather than in the view —
// one number, next to the derivation it bounds.
export const CHIP_LIMIT = 6;

// Every field a corpus entry must carry: the view needs `title`/`route`/`nav` to
// name and link a topic, the prompt needs `body` to answer from, `ask` seeds the
// chip, and `id` is what an answer credits back to. Exported so the test loops
// over it — add a seventh field here and the test covers it with no edit.
export const TOPIC_FIELDS = Object.freeze(["id", "title", "route", "nav", "body", "ask"]);

// Reasons that come WITH an answer. `refused` is a coverage determination the
// assistant declined (FR-8) — the refusal text IS the answer. `no_records` is
// FR-12's "nothing on file yet", which is a correct answer, not a failure.
//
// ⚠️ `refused` does NOT gate the broker hand-off, and this shape used to carry a
// `brokerHandoff` flag that said it did. The view now renders the hand-off on
// every answer, because the flag was model-controlled end to end: a model that
// declined in prose without the marker left the client refused with no broker
// channel, and one that answered a coverage question AND set the marker put
// "this needs your broker" under a coverage determination, which reads as
// broker-endorsed. The flag is gone rather than left unread — an unread field
// that looks like a feature is what that defect was made of. `reason` still
// carries the distinction for anything that genuinely needs it.
export const ANSWER_REASONS = Object.freeze(["answered", "refused", "no_records"]);

// Reasons there is NO answer, with the plain-language line the view shows in its
// place. Keys are the function's `reason` values (plan.md → Failure modes).
// `malformed` deliberately shares `unavailable`'s wording: the client does not
// need to know whether the endpoint was down or sent nonsense, but the keys stay
// distinct so a failure is still diagnosable from the shaped result.
export const FAILURE_NOTICE = Object.freeze({
  unavailable: "The help desk isn't available just now. Nothing else in the Keep is affected — your records are all still here.",
  // Built from the same template as the retryAfter version, so the two wordings
  // cannot drift. Function declarations hoist, so this call is safe here.
  rate_limited: rateLimitNotice(null),
  incomplete: "The answer didn't come through in full, so there's nothing to show. Please ask again.",
  // NOT "nothing on file": plan.md → Failure modes requires a read error and an
  // empty result to be distinguishable. Telling a client they hold no policies
  // because a SELECT failed is exactly the invented answer FR-12 forbids.
  records_error: "We couldn't read your records just now, so there's no answer to give. Please try again shortly.",
  invalid: "That question couldn't be read. Try rewording it and asking again.",
  malformed: "The help desk isn't available just now. Nothing else in the Keep is affected — your records are all still here.",
});

// A trimmed string, or "" for anything that is not a usable string. Every field
// read in this module goes through it: `null`, a number and "   " are all the
// same thing here — absent — and none of them may reach a view as a value.
function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

// The question as it should be SENT: trimmed, and "" for anything that is not a
// usable string. NOT "and stored" — nothing stores it; help_queries keeps only
// `owner` and `asked_at`. Callers validate and send the same value —
//   const q = cleanQuestion(input.value);
//   const v = validateQuestion(q); if (!v.ok) { show(v.error); return; }
//   await askHelp(q);
// — so the length validateQuestion measured is the length the SERVER measures.
// The old warning here said sending the raw input instead gets "rejected by the
// database"; there is no such rejection now, because the handler trims before it
// caps. What is left is a smaller, real reason: one normalisation means the client
// cannot show a character count that disagrees with the one being enforced
// mode client-side validation exists to prevent.
export function cleanQuestion(text) {
  return str(text);
}

// Validate a question before it is sent. Returns { ok } or { ok:false, error }.
// Errors are shown to the client, so they are sentences, not codes.
export function validateQuestion(text) {
  // A non-string is treated as "nothing typed" rather than thrown on. The only
  // caller is an input's `.value`, so a non-string is a programming error — but
  // this runs on the render path, and the help page still has to render.
  // (requests.js's `(subject || "").trim()` throws on a number; this does not.)
  const q = str(text);
  if (!q) return { ok: false, error: "Type a question to ask the help desk." };
  // Measured on the TRIMMED text — which is also what the handler measures, since
  // it trims before it caps. (This said "the migration's cap is on the raw column
  // value", describing a constraint that no longer exists on a column that no
  // longer exists; the two now agree by construction rather than by the caller
  // being careful.)
  if (q.length > QUESTION_MAX) {
    // "to N or fewer", not requests.js's "under N": the limit is inclusive, and
    // a client who hits exactly 500 should not be told 500 is too many.
    return { ok: false, error: `That's too long — keep your question to ${QUESTION_MAX} characters or fewer.` };
  }
  return { ok: true };
}

// The corpus's topic array, or [] for anything that is not a guide.
// Tolerant on purpose: the corpus is fetched JSON, so a 404 body, a failed parse
// or a half-written file all arrive here as "not a guide". Returning [] keeps
// the help page rendering (FR-17) instead of throwing on the render path.
function topicList(guide) {
  return guide && typeof guide === "object" && Array.isArray(guide.topics) ? guide.topics : [];
}

// Does this corpus entry carry everything the view and the prompt need?
// ONE gate for the whole module: an entry that fails here seeds no chip, and
// cannot be credited either — so chips, prompt and credits can never disagree
// about which topics exist. A failing entry is a bug to fix in
// content/help-guide.json, not something to paper over with a synthesised value.
export function isWellFormedTopic(topic) {
  if (!topic || typeof topic !== "object") return false;
  return TOPIC_FIELDS.every((f) => str(topic[f]) !== "");
}

// Suggestion chips for the empty state (FR-2), derived from the corpus's `ask`
// fields so chips and corpus cannot drift. Each chip is { id, ask }: `ask` is
// both what the chip SAYS and what it SENDS — one field read once, so a chip
// cannot display one question and ask another.
//
// `limit` caps the list (default CHIP_LIMIT); pass null or 0 for every chip.
// Never throws: a missing or malformed guide gives [].
export function suggestionChips(guide, limit = CHIP_LIMIT) {
  const out = [];
  const seen = new Set();
  for (const t of topicList(guide)) {
    if (!isWellFormedTopic(t)) continue;
    const ask = str(t.ask);
    const key = ask.toLowerCase();
    if (seen.has(key)) continue; // two chips with the same text ask the same thing twice
    seen.add(key);
    out.push({ id: str(t.id), ask });
  }
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? out.slice(0, n) : out;
}

// "in about a minute" / "in about 3 minutes", or "" when no usable number was
// given. Seconds in, matching HTTP Retry-After.
function waitPhrase(seconds) {
  // Minutes only, once, produced "in about 1333 minutes" for a 22-hour wait —
  // technically true and useless to read. The daily cap can be nearly a day out.
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 90) return "in about a minute";
  if (s < 5400) return `in about ${Math.round(s / 60)} minutes`;
  const h = Math.round(s / 3600);
  return h >= 20 ? "tomorrow" : `in about ${h} hour${h === 1 ? "" : "s"}`;
}

// The throttle notice, with the retry time when the function gave one and a
// complete sentence when it did not — never a hole where the number should be.
function rateLimitNotice(seconds, scope, window) {
  // Two different caps reach this, and the wording has to survive both. The
  // per-client cap clears within the hour; the SHARED daily one can be most of a
  // day away, and it is not the reader's doing — they may have asked nothing.
  // The first version said "You've asked a few questions in a short time" with a
  // minute count, which rendered a 22-hour wait as "about 1333 minutes" and
  // blamed the wrong person for it.
  //
  // ⚠️ That fix switched on the WAIT, which is a proxy for the cap and a wrong
  // one. A shared-cap refusal whose window clears in under 90 minutes — the
  // COMMON case for a rolling 24h window, not an edge — still read "You've asked
  // a few questions in a short time", to someone who may have asked none. The
  // function now says which cap fired and that is what decides the wording.
  // The duration heuristic survives ONLY as a fallback for a deployed function
  // older than this field; it is a guess, and labelled as one.
  // ⚠️ THE `window` BRANCH EXISTS BECAUSE A NUMBER CANNOT SAY "I DO NOT KNOW".
  // The function sends `retryAfter` only when it is derived from rows that have
  // settled; when the refusal depends on rows that may be peers about to release,
  // it cannot tell "clears in seconds" from "clears in an hour" and sends the
  // WINDOW instead. Three rounds of review were spent trying to express that
  // uncertainty as a duration — a flat hour (overstated), nothing at all (which
  // this function read as "a few minutes", understating), and a five-second grace
  // (understating by up to an hour, on 20 real asks inside that grace). Each
  // wording below is true across the whole of its window, which is the property
  // none of the three numbers had.
  // ⚠️ `!Number.isFinite(Number(seconds))` IS WRONG HERE and was the first
  // version: `answerShape` passes `null` when no number was sent, `Number(null)`
  // is **0**, and 0 is finite — so this branch never fired and the whole redesign
  // was inert, rendering the same "in a few minutes" it exists to replace. Caught
  // by its own test on the first run, which is the only reason it is not in the
  // commit. The test asserts the WORDING, not the branch, which is why it could
  // catch it at all.
  const haveSeconds = Number.isFinite(Number(seconds)) && Number(seconds) > 0;
  if (!haveSeconds && Number.isFinite(Number(window)) && Number(window) > 0) {
    return scope === "shared"
      ? "The help desk is at its limit right now. Please try again later."
      : "You've reached your limit of questions for the hour. Please try again later in the hour.";
  }
  if (scope === "client") {
    return `You've asked a few questions in a short time. Please try again ${waitPhrase(seconds) || "in a few minutes"}.`;
  }
  const hours = scope === "shared" || (!scope && Number.isFinite(seconds) && seconds > 5400);
  if (hours) {
    // ⚠️ A SHORT SHARED WAIT IS NOT "TODAY'S LIMIT". The shared cap can be
    // reached by reservations that are being RELEASED — a handful of concurrent
    // asks at the boundary — in which case the function sends a wait of seconds
    // and the next ask is admissible almost immediately. "Reached its limit for
    // today. Please try again in about a minute." is incoherent, and the version
    // of this that omitted the number entirely was worse: `waitPhrase` returns ""
    // and the fallback said **"tomorrow"**, which is the ~24h overstatement the
    // function-side fix had just removed. Found by Codex, who checked the
    // CONSUMER of that fix rather than the fix.
    // Threshold is waitPhrase's own first bucket, so the two cannot disagree
    // about what counts as short.
    const s = Number(seconds);
    if (Number.isFinite(s) && s > 0 && s < 90) {
      return `The help desk is briefly at its limit. Please try again ${waitPhrase(s)}.`;
    }
    return `The help desk has reached its limit for today. Please try again ${waitPhrase(seconds) || "tomorrow"}.`;
  }
  return `You've asked a few questions in a short time. Please try again ${waitPhrase(seconds) || "in a few minutes"}.`;
}

// Credited help topics as corpus ids: a bare id, or an object carrying one
// (whose other fields are ignored — see the header). De-duplicated, order kept.
function idList(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const id = typeof x === "string" ? x.trim() : str(x && x.id);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

// Credited records as the display lines the function sent: a string, or an
// object carrying `label`. No corpus to resolve against — these are the
// client's own rows.
function labelList(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const label = typeof x === "string" ? x.trim() : str(x && x.label);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

// Why there is no answer. `reason` arrives off a network payload, so the lookup
// is hasOwnProperty, not a bare one: FAILURE_NOTICE["constructor"] is truthy and
// would pass a plain guard while every field read came back undefined — the bug
// class policies.js (policyPresentation) and requests.js (statusDisplay) both
// document. An unknown or success-shaped reason with no answer behind it falls
// to `unavailable`: the view's branch is the same, and the key stays one of ours.
function failureKey(payload, rawAnswer, reason) {
  if (!payload) return "malformed";
  if (Object.prototype.hasOwnProperty.call(FAILURE_NOTICE, reason)) return reason;
  if (rawAnswer == null) return "unavailable";          // a failure the function did not label
  if (typeof rawAnswer !== "string") return "malformed"; // the answer was not text at all
  return "incomplete";                                  // present but empty — not an answer
}

// Normalise the function's payload into exactly what the view renders:
//
//   { ok:          true only when there is a real answer — the ONLY gate the
//                  view needs before rendering one,
//     answer:      the answer text, trimmed, line breaks intact (FR-4).
//                  ALWAYS a string, and "" whenever ok is false,
//     topics:      credited corpus topic ids (FR-11) — resolve with creditedTopics(),
//     records:     credited record display lines (FR-11),
//     reason:      one of ANSWER_REASONS when ok, else a key of FAILURE_NOTICE —
//                  never a raw string off the wire,
//     notice:      the plain-language line to show INSTEAD of an answer; "" when ok,
//     retryAfter:  seconds the function asked us to wait, or null }
//
// The absent-data rule (CLAUDE.md; policyKind/renewalCounts are the precedent)
// is enforced here: a null, blank or non-text answer yields ok:false and
// answer:"", so no reason key, notice or "null" can be printed where an answer
// goes — and the credits are dropped with it, because naming a source for an
// answer that does not exist would imply one. Never throws.
export function answerShape(payload) {
  const p = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  const raw = p ? p.answer : null;
  const answer = str(raw);
  const reason = p ? str(p.reason) : "";

  if (!answer) {
    const key = failureKey(p, raw, reason);
    const seconds = Number(p && p.retryAfter);
    const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    return {
      ok: false,
      answer: "",
      topics: [],
      records: [],
      reason: key,
      notice: key === "rate_limited" ? rateLimitNotice(retryAfter, str(p && p.scope), p && p.window) : FAILURE_NOTICE[key],
      retryAfter,
    };
  }

  // An unrecognised success reason normalises to `answered` rather than reaching
  // the view's switch (or the screen) as whatever the wire said.
  const kind = ANSWER_REASONS.includes(reason) ? reason : "answered";
  return {
    ok: true,
    answer,
    topics: idList(p.usedTopics),
    records: labelList(p.usedRecords),
    reason: kind,
    notice: "",
    retryAfter: null,
  };
}

// Resolve credited topic ids against the corpus, so an answer can name WHICH
// help topic it used (FR-11) with the corpus's own title and nav path. Unknown
// ids are dropped rather than shown: an id with no topic behind it is not
// something to put in front of a client. Order follows the ids given.
export function creditedTopics(guide, ids) {
  const byId = new Map();
  for (const t of topicList(guide)) {
    if (isWellFormedTopic(t)) byId.set(str(t.id), t);
  }
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const t = byId.get(typeof id === "string" ? id.trim() : "");
    if (t) out.push({ id: str(t.id), title: str(t.title), route: str(t.route), nav: str(t.nav) });
  }
  return out;
}
