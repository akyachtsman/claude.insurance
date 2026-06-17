// summary.js — shows the prioritized needs and submits the lead. The result is
// explicitly framed as a lead for a broker, not a quote or bound policy.

import { el, mount } from "../dom.js";
import { go } from "../main.js";
import { getSession, reset } from "./qualify.js";
import { computeNeeds } from "../rules.js";
import { fetchRules, submitLead } from "../supabase.js";

export async function renderSummary() {
  const session = getSession();
  if (!session || !session.domain || !session.contact) {
    // Nothing to summarize — send the user back to the start.
    return go("#/qualify");
  }

  const settings = await fetchRules();
  const needs = computeNeeds({ domain: session.domain, answers: session.answers }, settings);

  const container = el("div");
  container.appendChild(el("h2", { text: "Coverage a broker should review with you" }));
  container.appendChild(el("div", {
    class: "disclaimer",
    text: "This is a lead for your broker — not a quote, a price, or a bound policy. A licensed broker will follow up to confirm details and costs.",
  }));

  if (needs.length === 0) {
    container.appendChild(el("p", { text: "Based on your answers, no specific gaps stood out — a broker can still review your situation." }));
  } else {
    const list = el("div", { class: "card" });
    for (const n of needs) {
      list.appendChild(el("div", { class: `need priority-${n.priority}` }, [
        el("h3", { text: n.title }),
        el("p", { class: "why", text: n.why }),
      ]));
    }
    container.appendChild(list);
  }

  const status = el("p", { class: "progress-text" });
  container.appendChild(status);

  const sendBtn = el("button", { class: "btn btn-primary", text: "Send to a broker" });
  const startOver = el("button", { class: "btn btn-secondary", text: "Start over", on: { click: () => { reset(); go("#/hub"); } } });
  const buttons = el("div", { class: "btn-row" }, [sendBtn, startOver]);
  container.appendChild(buttons);

  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    status.textContent = "Sending…";
    try {
      await submitLead(buildLead(session, needs, false), { honeypot: session.contact.honeypot });
      status.textContent = "Sent. A broker will be in touch.";
    } catch (err) {
      sendBtn.disabled = false;
      status.textContent = "";
      const error = el("p", { class: "error", text: "Something went wrong sending your details. Please try again." });
      buttons.parentNode.insertBefore(error, buttons);
      console.error(err);
    }
  });

  mount(container);
}

function buildLead(session, needs, isPartial) {
  return {
    domain: session.domain,
    industry: session.answers.industry ? session.answers.industry.value : null,
    answers: session.answers,
    needs,
    contact_name: session.contact.name,
    contact_email: session.contact.email,
    contact_phone: session.contact.phone,
    is_partial: isPartial,
  };
}
