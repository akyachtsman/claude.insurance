// qualify.js — guided, deferred-PII questionnaire (rebuilt).
// One step at a time, branching, auto-advancing choices, inline glossary, progress
// + back, honeypot, and an "assembling your needs" transition into the summary.

import { el, mount } from "../dom.js";
import { go, previousRoute } from "../main.js";
import { icon, iconBadge } from "../icons.js";
import { enhance } from "../motion.js";
import { getQuestionnaire } from "../content.js";
import { setProfile } from "../store.js";
import { progress } from "../components/progress.js";
import { withGlossary } from "../components/glossary.js";
import { eyebrow } from "../components/ui.js";

const prefersReduced = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function renderQualify(params) {
  const data = await getQuestionnaire();
  const glossary = data.glossary || {};

  // Flow state lives in this closure; a fresh navigation starts over.
  const presetDomain = params && params.get("domain");
  const state = {
    domain: (presetDomain === "residential" || presetDomain === "commercial") ? presetDomain : null,
    locked: Boolean(presetDomain),   // entered from a coverage page with a domain
    stepIndex: 0,
    answers: {},
    error: "",
  };

  function steps() {
    return state.domain ? data.branches[state.domain].steps : [];
  }
  function total() {
    return steps().length + 1; // + contact step
  }

  function render() {
    if (!state.domain) return mount(shell(branchChooser()));
    const all = steps();
    if (state.stepIndex >= all.length) return mount(shell(contactStep(data.contactStep)));
    return mount(shell(stepView(all[state.stepIndex])));
  }

  // Outer chrome shared by every step.
  function shell(inner) {
    const view = el("div", { class: "qualify" }, [
      el("div", { class: "qualify__inner reveal" }, [inner]),
    ]);
    queueMicrotask(() => enhance());
    return view;
  }

  // ── Branch chooser ──────────────────────────────────────────────────────
  function branchChooser() {
    return el("div", {}, [
      eyebrow("Find what you need", "clipboard"),
      el("h1", { class: "qualify__q", text: "Who are we protecting?" }),
      el("p", { class: "qualify__hint", text: "Pick a starting point. It's anonymous, takes about two minutes, and ends with a summary — not a quote." }),
      el("div", { class: "choices" },
        Object.entries(data.branches).map(([id, branch]) =>
          choiceButton(branch.label, id === "residential" ? "home" : "briefcase", () => {
            state.domain = id;
            state.stepIndex = 0;
            render();
          })
        )
      ),
    ]);
  }

  // ── A single question step ──────────────────────────────────────────────
  function stepView(step) {
    const selected = state.answers[step.id] && state.answers[step.id].value;
    return el("div", {}, [
      progress({
        current: state.stepIndex + 1,
        total: total(),
        onBack: () => goBack(),
      }),
      el("h1", { class: "qualify__q" }, [withGlossary(step.question, glossary)]),
      step.hint ? el("p", { class: "qualify__hint" }, [withGlossary(step.hint, glossary)]) : null,
      el("div", { class: "choices" },
        step.options.map((opt) =>
          choiceButton(opt.label, null, () => selectOption(step, opt), selected === opt.value)
        )
      ),
    ]);
  }

  function selectOption(step, opt) {
    const answer = { value: opt.value };
    if (typeof opt.amount === "number") answer.amount = opt.amount;
    if (opt.professional) answer.professional = true;
    state.answers[step.id] = answer;
    state.stepIndex += 1;
    render();
  }

  function goBack() {
    if (state.stepIndex > 0) {
      state.stepIndex -= 1;
    } else if (!state.locked) {
      state.domain = null; // back to the branch chooser
    } else {
      // Locked flow (entered from a coverage page): return to the page the user
      // actually came from, falling back to the section index on a deep link.
      const prev = previousRoute();
      go(prev && prev !== location.hash ? prev : `#/${state.domain}`);
      return;
    }
    render();
  }

  // ── Contact step (deferred PII, last) ───────────────────────────────────
  function contactStep(contact) {
    const fieldEls = {};
    const wrap = el("div", {}, [
      progress({ current: total(), total: total(), onBack: () => goBack() }),
      el("h1", { class: "qualify__q", text: contact.question }),
      contact.hint ? el("p", { class: "qualify__hint", text: contact.hint }) : null,
      el("form", { class: "contact-form", attrs: { novalidate: "novalidate" }, on: { submit: onSubmit } }, [
        ...contact.fields.map((f) => {
          const input = el("input", {
            attrs: {
              id: `contact-${f.id}`, name: f.id, type: f.type,
              autocomplete: f.id === "name" ? "name" : f.id,
              ...(f.required ? { required: "required" } : {}),
            },
          });
          fieldEls[f.id] = input;
          return el("label", { class: "field" }, [
            el("span", { class: "field-label", text: f.label + (f.required ? "" : " (optional)") }),
            input,
          ]);
        }),
        // Honeypot — visually hidden; real users never fill it.
        el("div", { class: "hp-field", attrs: { "aria-hidden": "true" } }, [
          el("label", { text: "Company website" }),
          el("input", { attrs: { id: "contact-website", name: "website", type: "text", tabindex: "-1", autocomplete: "off" } }),
        ]),
        state.error ? el("p", { class: "error", text: state.error, attrs: { role: "alert" } }) : null,
        el("p", { class: "disclaimer" }, [
          el("strong", { text: "This creates a lead summary, not a quote. " }),
          el("span", { text: "Your details are shared with a licensed broker to follow up — never sold." }),
        ]),
        el("button", { class: "btn btn-primary btn-lg", attrs: { type: "submit" } }, [
          el("span", { text: "See my coverage needs" }), icon("arrow-right", { size: 20 }),
        ]),
      ]),
    ]);

    function onSubmit(e) {
      e.preventDefault();
      const honeypot = wrap.querySelector("#contact-website");
      if (honeypot && honeypot.value) return; // silently drop bots
      const name = fieldEls.name.value.trim();
      const email = fieldEls.email ? fieldEls.email.value.trim() : "";
      const phone = fieldEls.phone ? fieldEls.phone.value.trim() : "";
      if (!name) return setError("Please add your name so the broker knows who to reach.");
      if (!email && !phone) return setError("Add an email or phone number so the broker can reach you.");
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("That email doesn't look right — please check it.");

      setProfile(state.domain, state.answers, { name, email, phone });
      transitionToSummary();
    }

    function setError(msg) {
      state.error = msg;
      render();
      const live = document.querySelector(".error");
      if (live) live.scrollIntoView({ block: "center", behavior: prefersReduced() ? "auto" : "smooth" });
    }

    return wrap;
  }

  // ── "Assembling your needs" transition ──────────────────────────────────
  function transitionToSummary() {
    mount(el("div", { class: "qualify" }, [
      el("div", { class: "assembling" }, [
        iconBadge("spark", { lg: true, class: "icon-badge--ring" }),
        el("h1", { class: "assembling__title", text: "Assembling your coverage needs…" }),
        el("p", { class: "assembling__sub", text: "Matching your answers against what fits your situation." }),
        el("div", { class: "assembling__bar" }, [el("div", { class: "assembling__bar-fill" })]),
      ]),
    ]));
    const delay = prefersReduced() ? 0 : 900;
    setTimeout(() => go("#/summary"), delay);
  }

  render();
}

// A reusable .choice button (auto-advancing).
function choiceButton(label, iconName, onClick, selected) {
  return el("button", {
    class: `choice${selected ? " selected" : ""}`,
    attrs: { type: "button" },
    on: { click: onClick },
  }, [
    iconName ? iconBadge(iconName) : null,
    el("span", { class: "choice__label", text: label }),
    icon("arrow-right", { size: 18, class: "choice__arrow" }),
  ]);
}
