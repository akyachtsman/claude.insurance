// keep/views/help-view.js — the Help desk page (#/keep/help, feature 003).
//
// Ask a question in plain language, get an answer from the app's help guide and
// your own records. The page's job beyond rendering is FR-10 and FR-8's UI half:
// it labels every answer AI-generated and offers the broker channel, and it does
// so UNCONDITIONALLY — never off a flag the model controls. That is the third of
// the three independent places the fact/advice boundary is enforced (plan, Key
// decision 3), and it is the one that still holds when the other two fail.
import { el, mount } from "../../dom.js";
import { icon } from "../../icons.js";
import { askHelp, loadHelpGuide } from "../../supabase.js";
import {
  cleanQuestion, validateQuestion, suggestionChips, answerShape, creditedTopics,
} from "../logic/help.js";
import { page, originBackRow } from "./shell.js";

// FR-10's sentence, in ONE place. It is shown up front (before any question, so
// the client knows what they are reading before they type) and again on every
// answer. Two surfaces, one string — a label the user sees only after asking
// cannot inform the decision to ask.
const AI_NOTE =
  "Answers are AI-generated from this app's help guide and your own records — " +
  "check anything important with your broker.";

export async function renderKeepHelp() {
  const guide = await loadHelpGuide();

  const input = el("input", {
    class: "k-help__input",
    attrs: { type: "text", placeholder: "Ask a question…", "aria-label": "Ask a question", autocomplete: "off" },
  });
  const submit = el("button", { class: "k-btn k-help__ask", attrs: { type: "submit" } }, [el("span", { text: "Ask" })]);
  const error = el("p", { class: "k-error", attrs: { role: "alert" } });
  const answerRegion = el("div", { class: "k-help__out", attrs: { "aria-live": "polite" } }, [
    el("p", { class: "k-help__ai", text: AI_NOTE }),
  ]);

  // One in-flight request at a time. A second ask aborts the first rather than
  // racing it — two answers arriving out of order would render the older one.
  let inFlight = null;

  function setBusy(busy) {
    submit.disabled = busy;
    input.disabled = busy;
    submit.querySelector("span").textContent = busy ? "Asking…" : "Ask";
  }

  function renderNotice(shaped) {
    answerRegion.replaceChildren(el("div", { class: "k-help__notice" }, [
      icon("alert", { size: 18 }),
      el("p", { text: shaped.notice }),
    ]));
  }

  function renderAnswer(shaped, question) {
    const used = creditedTopics(guide, shaped.topics);
    const blocks = [
      el("p", { class: "k-help__q", text: question }),
      // `white-space: pre-line` in keep.css — the answer may carry line breaks
      // and collapsing them would run separate points together.
      el("div", { class: "k-help__a" }, [el("p", { text: shaped.answer })]),
    ];

    // FR-11: name what it drew on, so the client can check it.
    if (used.length || shaped.records.length) {
      blocks.push(el("div", { class: "k-help__src" }, [
        el("div", { class: "k-lbl", text: "Based on" }),
        ...used.map((t) => el("a", { class: "k-ilink", attrs: { href: t.route }, text: t.title })),
        ...shaped.records.map((r) => el("span", { class: "k-imuted", text: r })),
      ]));
    }

    // FR-8's hand-off. Shown when the assistant declined a coverage question,
    // which `brokerHandoff` carries so the view never has to read the answer text.
    if (shaped.brokerHandoff) {
      blocks.push(el("div", { class: "k-help__broker" }, [
        el("p", { text: "This one needs your broker — they can give you a coverage answer in writing." }),
        el("a", { class: "k-ilink", attrs: { href: "#/keep/insurance" }, text: "Open a policy to send a request" }),
      ]));
    }

    // FR-10, rendered on EVERY answer regardless of what came back. A model that
    // ignored its instructions cannot remove this line, which is the point.
    blocks.push(el("p", { class: "k-help__ai", text: AI_NOTE }));
    answerRegion.replaceChildren(...blocks);
  }

  async function ask(raw) {
    // cleanQuestion, NOT the raw value: the migration's CHECK caps the RAW text
    // at 500 while testing non-blankness on the TRIMMED text, so validating one
    // string and sending another is how a question passes here and is refused by
    // the INSERT. One normalisation, used for both.
    const question = cleanQuestion(raw);
    const v = validateQuestion(question);
    error.textContent = v.ok ? "" : v.error;
    if (!v.ok) { input.focus(); return; }

    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;
    setBusy(true);
    answerRegion.replaceChildren(el("p", { class: "k-imuted", text: "Looking…" }));

    const payload = await askHelp(question, { signal: controller.signal });
    if (controller.signal.aborted) return;        // superseded by a newer ask
    inFlight = null;
    setBusy(false);

    const shaped = answerShape(payload);
    if (shaped.ok) renderAnswer(shaped, question); else renderNotice(shaped);
  }

  const form = el("form", { class: "k-help__form", attrs: { novalidate: "novalidate" },
    on: { submit: (e) => { e.preventDefault(); ask(input.value); } } }, [input, submit]);

  // `k-chiprow` / `k-chiptog` are the Keep's existing pill-button recipe (hover,
  // 44px target, disabled state). Reused rather than restyled: a second chip
  // class drifts from the first the moment either is touched.
  const chips = suggestionChips(guide);
  const chipRow = chips.length
    ? el("div", { class: "k-chiprow k-help__chips" }, chips.map((c) =>
        el("button", { class: "k-chiptog", attrs: { type: "button" },
          on: { click: () => { input.value = c.ask; ask(c.ask); } }, text: c.ask })))
    : null;

  // `mid` (880px): an answer is prose, and prose set to the Keep's full 1200px
  // measure runs past a comfortable line length — the ask box stretches with it
  // and ends up a 1100px-wide single-line input. Measured at 1280px before the
  // change.
  mount(page("help", [
    originBackRow(),
    el("h1", { class: "k-h1", text: "Help" }),
    el("p", { class: "k-sub", text: "Ask about anything in the Keep — I'll point you to the right screen, or read back what's on your file." }),
    chipRow,
    form,
    error,
    answerRegion,
  ], { mid: true }));
}
