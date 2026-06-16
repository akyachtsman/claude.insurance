// qualify.js — qualification questionnaire as a small state machine.
// Branch (residential|commercial) -> stepped single-choice questions with inline
// glossary + progress -> deferred contact step (PII collected last) -> summary.

import { el, mount } from "../dom.js";
import { go } from "../main.js";

let schema = null;
// In-progress session, also read by the summary view.
let session = null;

export function getSession() {
  return session;
}

async function loadSchema() {
  if (!schema) {
    const res = await fetch("content/questionnaire.json");
    schema = await res.json();
  }
  return schema;
}

export async function renderQualify() {
  await loadSchema();
  if (!session) session = { domain: null, answers: {}, contact: null, stepIndex: 0 };

  if (!session.domain) return renderBranchChooser();

  const steps = schema.branches[session.domain].steps;
  if (session.stepIndex < steps.length) return renderStep(steps[session.stepIndex], steps.length);
  return renderContact();
}

function renderBranchChooser() {
  const container = el("div");
  container.appendChild(el("h2", { text: "Who are we finding coverage for?" }));

  const choices = el("div", { class: "choices" });
  for (const [key, branch] of Object.entries(schema.branches)) {
    choices.appendChild(el("button", {
      class: "choice",
      text: branch.label,
      on: { click: () => { session.domain = key; session.stepIndex = 0; go("#/qualify"); } },
    }));
  }
  container.appendChild(choices);
  container.appendChild(el("div", { class: "btn-row" }, [
    el("button", { class: "btn btn-secondary", text: "Back to coverages", on: { click: () => { reset(); go("#/hub"); } } }),
  ]));
  mount(container);
}

function renderStep(step, totalSteps) {
  const container = el("div");

  // Progress: substantive steps plus the final contact step.
  const total = totalSteps + 1;
  const current = session.stepIndex + 1;
  container.appendChild(progress(current, total));

  container.appendChild(el("h2", { text: step.question }));
  if (step.hint) container.appendChild(el("p", { text: step.hint }));

  const choices = el("div", { class: "choices" });
  const selected = session.answers[step.id];
  for (const opt of step.options) {
    const isSel = selected && selected.value === opt.value;
    choices.appendChild(el("button", {
      class: isSel ? "choice selected" : "choice",
      text: opt.label,
      on: { click: () => { session.answers[step.id] = opt; session.stepIndex += 1; go("#/qualify"); } },
    }));
  }
  container.appendChild(choices);

  const back = el("button", {
    class: "btn btn-secondary",
    text: "Back",
    on: { click: () => { session.stepIndex -= 1; if (session.stepIndex < 0) { session.domain = null; session.stepIndex = 0; } go("#/qualify"); } },
  });
  container.appendChild(el("div", { class: "btn-row" }, [back]));
  mount(container);
}

function renderContact() {
  const c = schema.contactStep;
  const container = el("div");
  const totalSteps = schema.branches[session.domain].steps.length;
  container.appendChild(progress(totalSteps + 1, totalSteps + 1));

  container.appendChild(el("h2", { text: c.question }));
  container.appendChild(el("div", { class: "disclaimer", text: c.hint }));

  const inputs = {};
  for (const field of c.fields) {
    const input = el("input", { attrs: { type: field.type, id: `contact-${field.id}`, name: field.id } });
    inputs[field.id] = input;
    container.appendChild(el("label", { class: "field" }, [
      el("span", { class: "field-label", text: field.required ? `${field.label} (required)` : `${field.label} (optional)` }),
      input,
    ]));
  }

  const errorBox = el("p", { class: "error" });
  container.appendChild(errorBox);

  const submit = el("button", {
    class: "btn btn-primary",
    text: "See my coverage needs",
    on: {
      click: () => {
        const name = inputs.name.value.trim();
        const email = inputs.email.value.trim();
        const phone = inputs.phone.value.trim();
        if (!name) return showError(errorBox, "Please enter a name.");
        if (!email && !phone) return showError(errorBox, "Please add an email or a phone number.");
        session.contact = { name, email: email || null, phone: phone || null };
        go("#/summary");
      },
    },
  });
  const back = el("button", {
    class: "btn btn-secondary",
    text: "Back",
    on: { click: () => { session.stepIndex = totalSteps - 1; go("#/qualify"); } },
  });
  container.appendChild(el("div", { class: "btn-row" }, [submit, back]));
  mount(container);
}

function progress(current, total) {
  const pct = Math.round((current / total) * 100);
  return el("div", { class: "progress" }, [
    el("div", { class: "progress-track" }, [
      el("div", { class: "progress-fill", attrs: { style: `width:${pct}%` } }),
    ]),
    el("div", { class: "progress-text", text: `Step ${current} of ${total}` }),
  ]);
}

function showError(box, message) {
  box.textContent = message;
}

export function reset() {
  session = null;
}
