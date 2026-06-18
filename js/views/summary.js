// summary.js — the lead summary (rebuilt). Reads the profile produced by qualify,
// computes prioritized needs from the broker-editable rules, frames them as
// Essential vs Recommended with the rationale shown, and submits a stub lead.
// Explicitly a lead summary — never a quote or bound policy.

import { el, mount } from "../dom.js";
import { icon, iconBadge, coverageIcon } from "../icons.js";
import { enhance } from "../motion.js";
import { computeNeeds } from "../rules.js";
import { fetchRules, submitLead } from "../supabase.js";
import { getProfile, getContact, isSubmitted, markSubmitted, hasProfile } from "../store.js";
import { getCoverage, findTopic } from "../content.js";
import { sectionHead, ctaLink, eyebrow } from "../components/ui.js";

export async function renderSummary() {
  if (!hasProfile()) return renderEmpty();

  const profile = getProfile();
  const contact = getContact() || {};
  const [settings, coverage] = await Promise.all([fetchRules(), getCoverage()]);
  const needs = computeNeeds(profile, settings);

  const essential = needs.filter((n) => n.priority === "high");
  const recommended = needs.filter((n) => n.priority !== "high");

  const submitState = el("div", { class: "submit-state" });

  const view = el("div", {}, [
    el("section", { class: "band band--tint band--tight" }, [
      el("div", { class: "container summary-head reveal" }, [
        eyebrow("Your coverage summary", "spark"),
        el("h1", { class: "display display-4xl u-mt-sm", text: heading(contact.name) }),
        el("p", { class: "disclaimer u-mt-md" }, [
          el("strong", { text: "This is a lead summary, not a quote. " }),
          el("span", { text:
            "It highlights coverage worth discussing — there's no price, policy, or " +
            "obligation here. A licensed broker will follow up to confirm details and options." }),
        ]),
        submitState,
      ]),
    ]),
    el("div", { class: "container summary-body" }, [
      needs.length
        ? el("div", {}, [
            needsGroup("Essential coverage", "The protection that matters most for your situation.", essential, coverage),
            needsGroup("Worth considering", "Coverage that may close gaps as your situation grows.", recommended, coverage),
          ])
        : noNeeds(),
      nextSteps(),
    ]),
  ]);

  mount(view);
  enhance();
  doSubmit(profile, contact, needs, submitState);
}

function heading(name) {
  return name ? `Here's what to protect, ${name}` : "Here's what to protect";
}

function needsGroup(title, blurb, items, coverage) {
  if (!items.length) return null;
  return el("section", { class: "needs-group" }, [
    sectionHead({ title, lede: blurb }),
    el("div", { class: "needs reveal-stagger" }, items.map((n) => needCard(n, coverage))),
  ]);
}

function needCard(n, coverage) {
  const found = findTopic(coverage, n.id);
  return el("article", { class: `need priority-${n.priority}` }, [
    el("div", { class: "need__head" }, [
      iconBadge(coverageIcon(n.id)),
      el("h3", { class: "need__title", text: n.title }),
      el("span", { class: `tag tag-${n.priority}`, text: n.priority === "high" ? "Essential" : "Recommended" }),
    ]),
    el("p", { class: "why", text: n.why }),
    found ? el("a", { class: "need__link", attrs: { href: `#/coverage/${n.id}` } }, [
      el("span", { text: `Learn about ${found.topic.title.toLowerCase()}` }), icon("arrow-right", { size: 16 }),
    ]) : null,
  ]);
}

function noNeeds() {
  return el("section", { class: "needs-group" }, [
    el("article", { class: "need priority-medium" }, [
      el("h3", { class: "need__title", text: "Your essentials look covered" }),
      el("p", { class: "why", text: "Based on your answers we didn't flag a major gap — but a broker can confirm and tailor limits to your situation." }),
    ]),
  ]);
}

function nextSteps() {
  return el("section", { class: "band band--deep summary-next" }, [
    el("div", { class: "container cta-band__inner reveal" }, [
      el("div", { class: "cta-band__copy" }, [
        el("h2", { class: "cta-band__title", text: "What happens next" }),
        el("p", { class: "u-mt-sm", text:
          "A licensed broker reviews your summary and reaches out to talk options — no pressure, " +
          "no obligation, and your details are never sold." }),
      ]),
      ctaLink("Back to coverage guide", "#/", { variant: "btn-secondary", noArrow: true }),
    ]),
  ]);
}

async function doSubmit(profile, contact, needs, host) {
  if (isSubmitted()) {
    host.appendChild(submittedNote());
    return;
  }
  const lead = {
    domain: profile.domain,
    answers: profile.answers,
    needs: needs.map((n) => ({ id: n.id, priority: n.priority })),
    contact,
    meta: { submittedAt: new Date().toISOString(), partial: false },
  };
  try {
    await submitLead(lead);
    markSubmitted();
    host.appendChild(submittedNote());
  } catch (err) {
    console.error("submitLead failed:", err);
    host.appendChild(el("p", { class: "error", attrs: { role: "alert" }, text:
      "We couldn't share your summary just now. Your needs are shown below — please try again shortly." }));
  }
}

function submittedNote() {
  return el("p", { class: "submit-ok" }, [
    icon("check", { size: 18 }),
    el("span", { text: "Shared with your broker — they'll be in touch." }),
  ]);
}

function renderEmpty() {
  mount(el("div", { class: "placeholder" }, [
    iconBadge("clipboard", { lg: true }),
    el("h1", { class: "placeholder__title", text: "No summary yet" }),
    el("p", { text: "Answer a few quick questions and we'll build your personalized coverage summary here." }),
    el("div", { class: "btn-row is-center" }, [
      ctaLink("Find what coverage I need", "#/qualify", { variant: "btn-primary" }),
    ]),
  ]));
}
