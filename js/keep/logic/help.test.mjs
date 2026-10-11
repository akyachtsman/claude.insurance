// node --test js/keep/logic/help.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  QUESTION_MAX,
  CHIP_LIMIT,
  TOPIC_FIELDS,
  ANSWER_REASONS,
  FAILURE_NOTICE,
  cleanQuestion,
  validateQuestion,
  suggestionChips,
  isWellFormedTopic,
  answerShape,
  creditedTopics,
} from "./help.js";

// ---------------------------------------------------------------------------
// Fixtures. Shaped like content/help-guide.json (plan.md -> Data shapes), but
// built here rather than read from disk so these tests do not depend on T1.
// The ONE test that reads the shipped corpus says so, and self-skips if the
// file is absent.
// ---------------------------------------------------------------------------
const goodTopic = (over = {}) => ({
  id: "add-entity",
  title: "Add a business or trust",
  route: "#/keep/add-entity",
  nav: "Entities → Add",
  body: "Creates a new entity under your account.",
  ask: "How do I add a business entity?",
  ...over,
});
const guideOf = (...topics) => ({ topics });

// ---------------------------------------------------------------------------
// validateQuestion
// ---------------------------------------------------------------------------

test("validateQuestion: accepts a real question", () => {
  assert.deepEqual(validateQuestion("Where do I add a business entity?"), { ok: true });
});

test("validateQuestion: rejects an empty string", () => {
  const r = validateQuestion("");
  assert.equal(r.ok, false);
  assert.match(r.error, /question/i);
});

// The trim is load-bearing, not tidiness: a space-only box looks typed-in to
// the submit handler, and a blank question reaching the endpoint burns a paid
// call and a throttle slot to answer nothing.
test("validateQuestion: rejects blank-but-present input", () => {
  for (const blank of ["   ", "\t", "\n  \n", "   "]) {
    assert.equal(validateQuestion(blank).ok, false, `"${blank}" must not pass`);
  }
});

test("validateQuestion: rejects a non-string without throwing", () => {
  // The only caller is an input's .value, so a non-string is a programming
  // error — but the help page still has to render, so it must not throw.
  for (const bad of [undefined, null, 42, {}, [], true]) {
    const r = validateQuestion(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  }
});

test("validateQuestion: the limit is inclusive — QUESTION_MAX exactly is accepted", () => {
  assert.deepEqual(validateQuestion("x".repeat(QUESTION_MAX)), { ok: true });
});

test("validateQuestion: one character over QUESTION_MAX is rejected", () => {
  const r = validateQuestion("x".repeat(QUESTION_MAX + 1));
  assert.equal(r.ok, false);
  assert.match(r.error, new RegExp(String(QUESTION_MAX)));
});

// The length is measured on the TRIMMED text, which is what cleanQuestion()
// produces and the caller sends. Padding a question to the limit therefore does
// not refuse it.
test("validateQuestion: trailing whitespace does not push an at-limit question over", () => {
  assert.deepEqual(validateQuestion("  " + "x".repeat(QUESTION_MAX) + "   "), { ok: true });
});

test("validateQuestion: QUESTION_MAX matches the limit the FUNCTION enforces", () => {
  // Renamed from "the stored column cap": help_queries no longer stores the
  // question text, so there is no column to mirror. The number must still match
  // the server, or a question the client accepts comes back as `invalid`.
  assert.equal(QUESTION_MAX, 500); // supabase/functions/help-ask/handler.ts: QUESTION_MAX
});

test("cleanQuestion: is the one normalisation, and is what validation measured", () => {
  assert.equal(cleanQuestion("  How do I add a trust?  "), "How do I add a trust?");
  assert.equal(cleanQuestion("   "), "");
  for (const bad of [undefined, null, 42, {}, []]) assert.equal(cleanQuestion(bad), "");
});

// What the SERVER does, which is not what this comment used to describe:
//   const question = payload.question.trim();            // handler.ts
//   if (!question) return unavailable("invalid");
//   if (question.length > QUESTION_MAX) return unavailable("invalid");
// Both tests are on the TRIMMED text. The old `help_queries` CHECK was asymmetric
// — non-blank on the trimmed text, the cap on the RAW column — but that column
// was dropped, and this comment kept describing it. Padding is now simply ignored
// rather than rejected.
// Client-side validation exists so the client never reports a length the server
// disagrees with, so anything validateQuestion accepts must be accepted by the
// server WHEN SENT AS cleanQuestion() output. This test is that implication,
// one-directional on purpose.
test("validateQuestion + cleanQuestion agree with what the function accepts", () => {
  // Models handler.ts, NOT a CHECK constraint: the cap is on `.trim()`ed length.
  const serverAccepts = (sent) =>
    typeof sent === "string" && sent.trim().length >= 1 && sent.trim().length <= QUESTION_MAX;
  const samples = [
    "", "   ", "\n", "ok?", "  ok?  ", "x".repeat(QUESTION_MAX),
    "  " + "x".repeat(QUESTION_MAX) + "   ", "x".repeat(QUESTION_MAX + 1),
    " " + "x".repeat(QUESTION_MAX + 1) + " ", 42, null, undefined, {},
  ];
  let accepted = 0;
  for (const s of samples) {
    if (!validateQuestion(s).ok) continue;
    accepted += 1;
    const sent = cleanQuestion(s);
    assert.ok(serverAccepts(sent), `validation accepted ${sent.length} chars the function would reject`);
  }
  assert.ok(accepted >= 4, "the sample set has to actually exercise the accepting branch");
});

test("validateQuestion: errors are plain language a client can act on", () => {
  for (const bad of ["", "x".repeat(QUESTION_MAX + 1)]) {
    const e = validateQuestion(bad).error;
    assert.ok(e.length > 10 && /[.!?]$/.test(e), `not a sentence: ${e}`);
    assert.doesNotMatch(e, /null|undefined|btrim|QUESTION_MAX|\berror\b/i);
  }
});

// ---------------------------------------------------------------------------
// suggestionChips
// ---------------------------------------------------------------------------

test("suggestionChips: one chip per topic, in corpus order", () => {
  const g = guideOf(goodTopic(), goodTopic({ id: "assets", ask: "Where do I see all my assets?" }));
  assert.deepEqual(suggestionChips(g), [
    { id: "add-entity", ask: "How do I add a business entity?" },
    { id: "assets", ask: "Where do I see all my assets?" },
  ]);
});

// FR-2: the chip's text IS the question it sends — one field, read once, so a
// chip cannot display one question and ask another.
test("suggestionChips: the chip carries the corpus `ask` verbatim", () => {
  const ask = "How do I ask to change my cover?";
  const [chip] = suggestionChips(guideOf(goodTopic({ ask })));
  assert.equal(chip.ask, ask);
  assert.deepEqual(Object.keys(chip).sort(), ["ask", "id"]);
});

test("suggestionChips: tolerates a missing or malformed guide by returning []", () => {
  // The corpus is fetched JSON: a 404 body, a failed parse or a half-written
  // file all arrive here as "not a guide". The page must still render (FR-17).
  for (const bad of [undefined, null, {}, { topics: null }, { topics: {} }, { topics: [] }, "topics", 7, []]) {
    assert.deepEqual(suggestionChips(bad), [], `${JSON.stringify(bad)} should give no chips`);
  }
});

test("suggestionChips: topics with no `ask` produce no chips", () => {
  const noAsk = guideOf(goodTopic({ ask: undefined }), goodTopic({ id: "x", ask: "   " }));
  assert.deepEqual(suggestionChips(noAsk), []);
});

test("suggestionChips: skips entries that are not usable topics, keeps the rest", () => {
  const g = guideOf(
    null,
    "nope",
    goodTopic({ id: "", ask: "Who am I?" }),          // no id to credit back to
    goodTopic({ body: undefined, ask: "Ungrounded?" }), // no body -> nothing to answer from
    goodTopic(),
  );
  assert.deepEqual(suggestionChips(g), [{ id: "add-entity", ask: "How do I add a business entity?" }]);
});

test("suggestionChips: two topics with the same ask give one chip", () => {
  const g = guideOf(goodTopic(), goodTopic({ id: "dupe", ask: "how do I ADD a business entity?" }));
  assert.equal(suggestionChips(g).length, 1);
});

test("suggestionChips: caps at CHIP_LIMIT, and an explicit limit wins", () => {
  const many = guideOf(...Array.from({ length: CHIP_LIMIT + 4 }, (_, i) => goodTopic({ id: `t${i}`, ask: `Question ${i}?` })));
  assert.equal(suggestionChips(many).length, CHIP_LIMIT);
  assert.equal(suggestionChips(many, 2).length, 2);
  assert.equal(suggestionChips(many, null).length, CHIP_LIMIT + 4); // null/0 = no cap
  assert.equal(suggestionChips(many, 0).length, CHIP_LIMIT + 4);
});

test("suggestionChips: does not mutate the guide it was given", () => {
  const g = guideOf(goodTopic());
  const before = JSON.stringify(g);
  suggestionChips(g);
  assert.equal(JSON.stringify(g), before);
});

// ---------------------------------------------------------------------------
// isWellFormedTopic
// ---------------------------------------------------------------------------

test("isWellFormedTopic: accepts a complete topic", () => {
  assert.equal(isWellFormedTopic(goodTopic()), true);
});

test("isWellFormedTopic: rejects a topic missing any one required field", () => {
  // Looped over TOPIC_FIELDS on purpose: adding a seventh required field to the
  // module extends this test automatically instead of leaving a silent gap.
  assert.deepEqual([...TOPIC_FIELDS].sort(), ["ask", "body", "id", "nav", "route", "title"]);
  for (const field of TOPIC_FIELDS) {
    const missing = goodTopic();
    delete missing[field];
    assert.equal(isWellFormedTopic(missing), false, `missing \`${field}\` must be rejected`);

    // Present-but-blank is the same absence wearing a hat.
    assert.equal(isWellFormedTopic(goodTopic({ [field]: "   " })), false, `blank \`${field}\` must be rejected`);
    assert.equal(isWellFormedTopic(goodTopic({ [field]: null })), false, `null \`${field}\` must be rejected`);
    assert.equal(isWellFormedTopic(goodTopic({ [field]: 42 })), false, `non-string \`${field}\` must be rejected`);
  }
});

test("isWellFormedTopic: rejects non-topics without throwing", () => {
  for (const bad of [undefined, null, "", "add-entity", 42, [], [goodTopic()], true]) {
    assert.equal(isWellFormedTopic(bad), false, `${JSON.stringify(bad)} is not a topic`);
  }
});

test("isWellFormedTopic: extra fields are allowed", () => {
  assert.equal(isWellFormedTopic(goodTopic({ keywords: ["llc"], weight: 3 })), true);
});

// ---------------------------------------------------------------------------
// answerShape — success
// ---------------------------------------------------------------------------

const ok = (over = {}) => ({
  answer: "Open Entities and choose Add.",
  usedTopics: ["add-entity"],
  usedRecords: [],
  reason: "answered",
  ...over,
});

test("answerShape: a good answer is renderable and credited", () => {
  const s = answerShape(ok({ usedRecords: ["Policy · Personal auto"] }));
  assert.equal(s.ok, true);
  assert.equal(s.answer, "Open Entities and choose Add.");
  assert.deepEqual(s.topics, ["add-entity"]);
  assert.deepEqual(s.records, ["Policy · Personal auto"]);
  assert.equal(s.reason, "answered");
  assert.equal(s.notice, "");
  assert.equal(s.retryAfter, null);
  assert.ok(!("brokerHandoff" in s), "brokerHandoff is gone — the hand-off is unconditional in the view");
});

test("answerShape: absent credits come back as arrays, never undefined", () => {
  // The view iterates these. `undefined.map` is the whole reason they are
  // normalised here rather than guarded at every call site.
  const s = answerShape({ answer: "Nothing on file yet.", reason: "no_records" });
  assert.deepEqual(s.topics, []);
  assert.deepEqual(s.records, []);
  assert.equal(s.reason, "no_records");
  assert.equal(s.ok, true);
});

test("answerShape: credits accept {id}/{label} objects and drop junk", () => {
  const s = answerShape(ok({
    usedTopics: [{ id: "insurance", title: "model's own wording" }, "add-entity", "add-entity", null, 7, { nope: 1 }],
    usedRecords: [{ label: "Asset · Tesla Model Y" }, "Policy · Flood (NFIP)", "", null],
  }));
  assert.deepEqual(s.topics, ["insurance", "add-entity"]); // de-duplicated, order kept
  assert.deepEqual(s.records, ["Asset · Tesla Model Y", "Policy · Flood (NFIP)"]);
});

test("answerShape: a refused coverage question keeps its answer, and carries no hand-off flag", () => {
  // FR-8: the refusal text IS the answer. The view renders the broker channel on
  // every answer rather than off a flag the model controls — see ANSWER_REASONS
  // in help.js for why that flag was removed rather than left unread.
  const s = answerShape(ok({ answer: "That is a coverage question for your broker.", reason: "refused" }));
  assert.equal(s.ok, true);
  assert.equal(s.reason, "refused");
  assert.ok(!("brokerHandoff" in s), "brokerHandoff is gone; `reason` carries the distinction");
  assert.equal(s.notice, "");
});

test("answerShape: an unrecognised success reason normalises to `answered`", () => {
  // The view switches on `reason`; an unknown string from the wire must not
  // leak into that switch (or onto the screen).
  for (const r of ["vibes", "", undefined, 42, "constructor", "unavailable_but_answered"]) {
    const s = answerShape(ok({ reason: r }));
    assert.equal(s.ok, true);
    assert.ok(ANSWER_REASONS.includes(s.reason), `${JSON.stringify(r)} -> ${s.reason}`);
  }
});

test("answerShape: the answer is trimmed but otherwise untouched, line breaks kept", () => {
  const s = answerShape(ok({ answer: "\n  Line one.\nLine two.\n\n" }));
  assert.equal(s.answer, "Line one.\nLine two."); // FR-4 renders the breaks
});

// ---------------------------------------------------------------------------
// answerShape — failure. Every reason in plan.md -> Failure modes.
// ---------------------------------------------------------------------------

const FAILURES = [
  ["no provider key", { answer: null, reason: "unavailable" }, "unavailable"],
  ["throttled", { answer: null, reason: "rate_limited" }, "rate_limited"],
  ["throttled with a retry time", { answer: null, reason: "rate_limited", retryAfter: 180 }, "rate_limited"],
  ["stop_reason not end_turn", { answer: null, reason: "incomplete" }, "incomplete"],
  ["record read failed", { answer: null, reason: "records_error" }, "records_error"],
  ["question rejected server-side", { answer: null, reason: "invalid" }, "invalid"],
  ["failure with no reason at all", { answer: null }, "unavailable"],
  ["unknown reason string", { answer: null, reason: "kaboom" }, "unavailable"],
  ["prototype key as a reason", { answer: null, reason: "constructor" }, "unavailable"],
  ["empty answer string", { answer: "   " }, "incomplete"],
  ["answer that is not text", { answer: 42 }, "malformed"],
  ["not a payload at all", undefined, "malformed"],
  ["null payload", null, "malformed"],
  ["a string payload", "unavailable", "malformed"],
  ["an array payload", [], "malformed"],
  ["an empty object", {}, "unavailable"],
];

for (const [name, payload, reason] of FAILURES) {
  test(`answerShape: ${name} -> reason ${reason}, nothing renderable`, () => {
    const s = answerShape(payload);
    assert.equal(s.ok, false);
    assert.equal(s.reason, reason);
    assert.equal(s.answer, "");
    assert.ok(s.notice.length > 0, "a failure must give the client a line to read");
    assert.deepEqual(s.topics, []);
    assert.deepEqual(s.records, []);
    assert.ok(!("brokerHandoff" in s));
  });
}

// THE ABSENT-DATA RULE (CLAUDE.md: absent data is never rendered as a confident
// statement; policies.js -> policyKind/renewalCounts are the precedent). A
// failure must not come back as anything the view would print as an answer:
// not "null", not the reason key, not the notice.
test("answerShape: a null or absent answer is never renderable as text", () => {
  for (const [name, payload] of FAILURES) {
    const s = answerShape(payload);
    assert.equal(typeof s.answer, "string", name);
    assert.equal(s.answer, "", name);
    assert.notEqual(s.answer, s.notice, name);     // the notice is not an answer
    assert.notEqual(s.answer, s.reason, name);     // the reason is not an answer
    assert.doesNotMatch(s.answer, /null|undefined/, name);
    assert.equal(`${s.answer}`.trim(), "", name);  // interpolating it prints nothing
    assert.equal(s.ok, false, name);               // and `ok` is the only gate the view needs
  }
});

test("answerShape: a failure drops its credits — no source for an answer that does not exist", () => {
  // FR-11 credits what an answer drew on. With no answer there is nothing to
  // credit, and a dangling "we read your auto policy" line would imply one.
  const s = answerShape({ answer: null, reason: "unavailable", usedTopics: ["add-entity"], usedRecords: ["Policy · Personal auto"] });
  assert.deepEqual(s.topics, []);
  assert.deepEqual(s.records, []);
});

test("answerShape: every failure reason has a notice, and FAILURE_NOTICE covers them", () => {
  for (const key of Object.keys(FAILURE_NOTICE)) {
    const s = answerShape({ answer: null, reason: key });
    assert.equal(s.reason, key);
    assert.ok(s.notice.length > 0);
  }
  // Each reason the plan's failure table can produce is a known key.
  for (const key of ["unavailable", "rate_limited", "incomplete", "records_error", "invalid", "malformed"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(FAILURE_NOTICE, key), `missing notice for ${key}`);
  }
});

test("answerShape: a record-read error does not say 'nothing on file'", () => {
  // plan.md -> Failure modes distinguishes "query error" from "empty": an error
  // renders an error state. Telling a client they hold no policies because a
  // SELECT failed is the invented answer FR-12 exists to prevent.
  const s = answerShape({ answer: null, reason: "records_error" });
  assert.doesNotMatch(s.notice, /nothing on file|no policies|no records|don't have/i);
  assert.match(s.notice, /couldn't|could not|unable/i);
});

test("answerShape: a retry time reaches the client in plain language", () => {
  const soon = answerShape({ answer: null, reason: "rate_limited", retryAfter: 45 });
  assert.equal(soon.retryAfter, 45);
  assert.match(soon.notice, /minute/i);

  const later = answerShape({ answer: null, reason: "rate_limited", retryAfter: 180 });
  assert.match(later.notice, /3 minutes/);

  // No retry time given: still a complete sentence, with no hole in it.
  const bare = answerShape({ answer: null, reason: "rate_limited" });
  assert.equal(bare.retryAfter, null);
  assert.doesNotMatch(bare.notice, /null|undefined|NaN/);
  assert.match(bare.notice, /\.$/);

  // Junk retry times are ignored rather than printed.
  for (const junk of ["soon", NaN, Infinity, -5, 0, {}, null]) {
    const s = answerShape({ answer: null, reason: "rate_limited", retryAfter: junk });
    assert.equal(s.retryAfter, null, `${JSON.stringify(junk)}`);
    assert.doesNotMatch(s.notice, /null|undefined|NaN|Infinity/);
  }
  // A numeric string is accepted — JSON from the function may quote it.
  assert.equal(answerShape({ answer: null, reason: "rate_limited", retryAfter: "120" }).retryAfter, 120);
});

test("answerShape: never throws, whatever arrives on the wire", () => {
  const hostile = [
    undefined, null, 0, "", "null", [], [1, 2], () => {}, Symbol("x"), 9007199254740993n,
    { answer: { toString: null } }, { answer: [], usedTopics: "add-entity", usedRecords: 3 },
    { answer: "fine", usedTopics: [[["nested"]]], usedRecords: [{}] },
    Object.create(null), { reason: Object.create(null) },
  ];
  for (const p of hostile) {
    const s = answerShape(p);
    assert.equal(typeof s.ok, "boolean");
    assert.equal(typeof s.answer, "string");
    assert.ok(Array.isArray(s.topics) && Array.isArray(s.records));
  }
});

// ---------------------------------------------------------------------------
// creditedTopics — FR-11, resolved against the corpus
// ---------------------------------------------------------------------------

test("creditedTopics: resolves ids to the corpus entry, in the order credited", () => {
  const g = guideOf(goodTopic(), goodTopic({ id: "insurance", title: "All your policies", route: "#/keep/insurance", nav: "Policies", ask: "Where are my policies?" }));
  assert.deepEqual(creditedTopics(g, ["insurance", "add-entity"]), [
    { id: "insurance", title: "All your policies", route: "#/keep/insurance", nav: "Policies" },
    { id: "add-entity", title: "Add a business or trust", route: "#/keep/add-entity", nav: "Entities → Add" },
  ]);
});

test("creditedTopics: the title comes from the corpus, not from the payload", () => {
  // CLAUDE.md: one canonical label, one shared module. A model-supplied title
  // would be a second source for the same label.
  const g = guideOf(goodTopic());
  const s = answerShape(ok({ usedTopics: [{ id: "add-entity", title: "the entity adding screen" }] }));
  assert.deepEqual(creditedTopics(g, s.topics), [
    { id: "add-entity", title: "Add a business or trust", route: "#/keep/add-entity", nav: "Entities → Add" },
  ]);
});

test("creditedTopics: an id with no topic behind it is dropped, not shown", () => {
  assert.deepEqual(creditedTopics(guideOf(goodTopic()), ["ghost", "", null, 42]), []);
});

test("creditedTopics: a malformed guide or id list gives [] rather than throwing", () => {
  for (const g of [undefined, null, {}, { topics: "x" }, 7]) assert.deepEqual(creditedTopics(g, ["add-entity"]), []);
  for (const ids of [undefined, null, "add-entity", 7, {}]) assert.deepEqual(creditedTopics(guideOf(goodTopic()), ids), []);
});

test("creditedTopics: an incomplete corpus entry is not credited", () => {
  // One gate everywhere: if isWellFormedTopic rejects it, it seeds no chip, is
  // not in the prompt, and cannot be credited. Those three cannot disagree.
  assert.deepEqual(creditedTopics(guideOf(goodTopic({ body: undefined })), ["add-entity"]), []);
});

// ---------------------------------------------------------------------------
// The shipped corpus. Reads content/help-guide.json for the same reason
// js/test-settings.mjs reads content/rule-defaults.json: the test should
// exercise the real data, not a hand-copy of it. Self-skips if T1 is absent.
// ---------------------------------------------------------------------------
const GUIDE_PATH = new URL("../../../content/help-guide.json", import.meta.url);
// NOT skipped when absent, which is what these did while the file was still
// being written ("T1"). It ships now, and BOTH halves of the feature read it —
// the page for its chips and credits, the Edge Function for its prompt. A rename
// would have turned the only validation this corpus has into two silent passes,
// and `test.md` is explicit that a skipped test is not evidence.
assert.ok(existsSync(GUIDE_PATH), "content/help-guide.json is missing — the Help desk has no corpus");

test("content/help-guide.json: every topic is well formed and seeds its chip", () => {
  const guide = JSON.parse(readFileSync(GUIDE_PATH, "utf8"));
  assert.ok(Array.isArray(guide.topics) && guide.topics.length > 0, "the corpus has topics");
  for (const t of guide.topics) {
    assert.equal(isWellFormedTopic(t), true, `malformed topic: ${t && t.id}`);
  }
  const ids = guide.topics.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "topic ids are unique");

  const chips = suggestionChips(guide);
  assert.equal(chips.length, Math.min(CHIP_LIMIT, guide.topics.length));
  const asks = new Set(guide.topics.map((t) => t.ask));
  for (const c of chips) assert.ok(asks.has(c.ask), `chip text not in the corpus: ${c.ask}`);

  // Every topic is creditable, so any topic the prompt can use can be named
  // back to the client (FR-11).
  assert.equal(creditedTopics(guide, ids).length, guide.topics.length);
});

// Every topic's `route` is an address a CLIENT IS SENT TO, so it has to be
// navigable — which is a stricter thing than "the router has a case for it".
// Found by rendering the page: three topics shipped `#/keep/asset/:id` and
// `#/keep/policy/:id`, whose `case` in dispatchKeep exists and whose link is
// still dead, because `:id` arrives as the literal string ":id" and resolves to
// no record. CLAUDE.md claimed these had been "checked against js/main.js" —
// true, and the wrong check. This one is the right check, and it runs.
const MAIN_PATH = new URL("../../main.js", import.meta.url);

test("content/help-guide.json: every route is a navigable static Keep address", () => {
  const guide = JSON.parse(readFileSync(GUIDE_PATH, "utf8"));
  const main = readFileSync(MAIN_PATH, "utf8");

  // The sub-routes dispatchKeep actually answers, read out of its switch rather
  // than hand-listed here — a list copied from the router drifts from it.
  const keepBlock = main.slice(main.indexOf("async function dispatchKeep"));
  const cases = new Set([...keepBlock.matchAll(/case "([a-z-]+)":/g)].map((m) => m[1]));
  assert.ok(cases.size > 5, `dispatchKeep cases not found by the parser (got ${cases.size}) — this test is only as good as its parse`);
  assert.ok(cases.has("help"), "dispatchKeep has no `help` case — the Help desk route is not wired");

  for (const t of guide.topics) {
    assert.ok(t.route.startsWith("#/keep"), `${t.id}: route is outside the Keep — ${t.route}`);
    assert.ok(!t.route.includes(":"), `${t.id}: route carries a parameter placeholder — ${t.route} is not an address a client can be sent to. Point it at the list the item is picked from; \`nav\` and \`body\` carry the "open one" step.`);
    const sub = t.route.replace(/^#\/keep\/?/, "").split("/")[0];
    if (sub === "") continue;                      // "#/keep" — the landing route
    assert.ok(cases.has(sub), `${t.id}: route ${t.route} has no case in dispatchKeep`);
  }
});

test("a shared-cap refusal does not blame the client, whatever the wait", () => {
  // The wording used to switch on the WAIT (>5400s), which is a proxy for the cap
  // and a wrong one: a rolling 24h window usually clears in under 90 minutes, so
  // the COMMON shared-cap refusal read "You've asked a few questions in a short
  // time" to someone who may have asked none all day. The function now says which
  // cap fired.
  const shared = answerShape({ answer: null, reason: "rate_limited", retryAfter: 4000, scope: "shared" });
  assert.ok(!/you've asked/i.test(shared.notice),
    `a shared-cap refusal blamed the client: ${shared.notice}`);
  assert.match(shared.notice, /limit for today/i);
  assert.match(shared.notice, /67 minutes/);

  // A shared cap with no retryAfter must still not say "in a few minutes".
  const bare = answerShape({ answer: null, reason: "rate_limited", scope: "shared" });
  assert.ok(!/you've asked/i.test(bare.notice), `bare shared-cap refusal blamed the client: ${bare.notice}`);
  assert.match(bare.notice, /limit for today/i);

  // ⚠️ A SHORT SHARED WAIT MUST NOT SAY "TODAY" OR "TOMORROW". The shared cap can
  // be reached by concurrent reservations that are being released, in which case
  // the function sends a wait of SECONDS. "Reached its limit for today. Please
  // try again in about a minute." is incoherent, and the earlier version of the
  // function omitted the number instead — which landed on the `|| "tomorrow"`
  // fallback and reproduced the ~24h overstatement it was meant to remove, in
  // the view rather than the function. This is the consumer half of that fix.
  const brief = answerShape({ answer: null, reason: "rate_limited", retryAfter: 5, scope: "shared" });
  assert.ok(!/tomorrow/i.test(brief.notice), `a 5-second shared wait said "tomorrow": ${brief.notice}`);
  assert.ok(!/for today/i.test(brief.notice), `a 5-second shared wait claimed today's limit: ${brief.notice}`);
  assert.ok(!/you've asked/i.test(brief.notice), `a short shared-cap refusal blamed the client: ${brief.notice}`);
  assert.match(brief.notice, /in about a minute/,
    `a short shared wait must still name a wait: ${brief.notice}`);
  // And the boundary stays with the long wording: 90s is waitPhrase's own cutoff.
  assert.match(answerShape({ answer: null, reason: "rate_limited", retryAfter: 4000, scope: "shared" }).notice,
    /limit for today/i, "a genuinely long shared wait lost its wording");

  // The per-client cap keeps its own wording, including over the old threshold.
  const mine = answerShape({ answer: null, reason: "rate_limited", retryAfter: 3600, scope: "client" });
  assert.match(mine.notice, /you've asked a few questions/i);
  const longMine = answerShape({ answer: null, reason: "rate_limited", retryAfter: 9000, scope: "client" });
  assert.match(longMine.notice, /you've asked a few questions/i,
    "an explicit client scope must not be overridden by the duration heuristic");

  // No scope at all — an older deployed function — falls back to the heuristic.
  assert.match(answerShape({ answer: null, reason: "rate_limited", retryAfter: 80000 }).notice, /limit for today/i);
  assert.match(answerShape({ answer: null, reason: "rate_limited", retryAfter: 120 }).notice, /you've asked/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// THE `window` WORDING. A number cannot say "I do not know, but it is bounded by
// this", and three review rounds were spent trying to make one do it: a flat
// hour on the daily cap (understated it), omitting the number (which the
// branches below read as "a few minutes" / "tomorrow", so the overstatement just
// moved from the function into this file), and a five-second grace (understated
// by up to an hour when the rows inside it were real). `global.md` -> Review
// Rounds Have to Terminate. The function now sends `retryAfter` only when it can
// derive it, and `window` otherwise — and these are the wordings that have to be
// true across the WHOLE of a window, which is the property none of the three
// numbers had.
// ─────────────────────────────────────────────────────────────────────────────
test("a client-scope refusal with only a window promises no duration", () => {
  const s = answerShape({ answer: null, reason: "rate_limited", scope: "client", window: 3600 });
  assert.match(s.notice, /limit of questions for the hour/i);
  assert.match(s.notice, /later in the hour/i);
  // The two readings this must survive: it may clear in seconds (a peer
  // releasing) or hold for nearly the full hour (twenty real asks in a burst).
  assert.ok(!/few minutes|about a minute|about \d+ minutes/i.test(s.notice),
    `a bounded-but-unknown wait was rendered as a duration: ${s.notice}`);
  assert.equal(s.retryAfter, null, "no retryAfter was sent, so none may be reported");
});

test("a shared-scope refusal with only a window does not say tomorrow", () => {
  const s = answerShape({ answer: null, reason: "rate_limited", scope: "shared", window: 86_400 });
  assert.match(s.notice, /at its limit right now/i);
  assert.ok(!/tomorrow|today/i.test(s.notice),
    `a rolling 24-hour window was rendered as a calendar claim: ${s.notice}`);
  assert.ok(!/few minutes/i.test(s.notice), `an unknown wait was rendered as minutes: ${s.notice}`);
});

test("a derived retryAfter still wins over a window, and keeps its own wording", () => {
  // The two are mutually exclusive on the wire, but a defensive consumer must
  // not start ignoring a number it was actually given.
  const s = answerShape({ answer: null, reason: "rate_limited", scope: "client", retryAfter: 180, window: 3600 });
  assert.match(s.notice, /about 3 minutes/i);
  assert.equal(s.retryAfter, 180);
  const sh = answerShape({ answer: null, reason: "rate_limited", scope: "shared", retryAfter: 45, window: 86_400 });
  assert.match(sh.notice, /briefly at its limit/i);
});

test("a junk window is ignored rather than rendered", () => {
  for (const junk of [0, -1, "soon", null, undefined, NaN, {}]) {
    const s = answerShape({ answer: null, reason: "rate_limited", scope: "client", window: junk });
    assert.ok(s.notice && !/\bnull\b|\bundefined\b|NaN|\[object/.test(s.notice),
      `window ${JSON.stringify(junk)} leaked into the notice: ${s.notice}`);
  }
});
