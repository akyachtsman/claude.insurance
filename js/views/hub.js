// hub.js — knowledge hub. Renders coverage topics from content/coverage.json and
// routes into the qualification flow.

import { el, mount } from "../dom.js";
import { go } from "../main.js";

let coverageCache = null;
let glossaryCache = null;

async function loadCoverage() {
  if (!coverageCache) {
    const res = await fetch("content/coverage.json");
    coverageCache = await res.json();
  }
  return coverageCache;
}

async function loadGlossary() {
  if (!glossaryCache) {
    const res = await fetch("content/questionnaire.json");
    const data = await res.json();
    glossaryCache = data.glossary || {};
  }
  return glossaryCache;
}

export async function renderHub(params) {
  const data = await loadCoverage();
  const topicId = params.get("topic");

  if (topicId) {
    const found = findTopic(data, topicId);
    if (found) return renderTopic(found.topic, data);
  }
  const glossary = await loadGlossary();
  renderIndex(data, glossary);
}

function renderIndex(data, glossary) {
  const container = el("div");

  // How this works — orient the visitor before the list of coverages.
  container.appendChild(el("div", { class: "card" }, [
    el("h2", { text: "How this works" }),
    el("ol", {}, [
      el("li", { text: "Browse the coverages below to learn what each one protects." }),
      el("li", { text: "Answer a few quick questions about your household or business." }),
      el("li", { text: "Get a plain-language summary of what to consider — and, if you choose, send it to a broker who can follow up." }),
    ]),
    el("p", { text: "This is educational and helps prepare a lead for a broker. It is not a quote, a price, or a bound policy." }),
  ]));

  for (const section of data.sections) {
    container.appendChild(el("div", { class: "section-label", text: section.label }));
    container.appendChild(el("p", { text: section.blurb }));
    for (const topic of section.topics) {
      const card = el("div", {
        class: "card clickable",
        attrs: { role: "button", tabindex: "0", "aria-label": `Learn about ${topic.title}` },
        on: {
          click: () => go(`#/hub?topic=${topic.id}`),
          keydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(`#/hub?topic=${topic.id}`); } },
        },
      }, [
        el("h3", { text: topic.title }),
        el("p", { text: topic.definition }),
      ]);
      container.appendChild(card);
    }
  }

  container.appendChild(el("div", { class: "btn-row" }, [
    el("button", { class: "btn btn-primary", text: "Find what coverage I need", on: { click: () => go("#/qualify") } }),
  ]));

  const terms = glossaryTerms(glossary);
  if (terms.length) {
    container.appendChild(el("div", { class: "section-label", text: "Key terms" }));
    const dl = el("dl");
    for (const [term, def] of terms) {
      dl.appendChild(el("dt", { text: capitalize(term) }));
      dl.appendChild(el("dd", { text: def }));
    }
    container.appendChild(el("div", { class: "card" }, [dl]));
  }

  mount(container);
}

function renderTopic(topic, data) {
  const dl = el("dl");
  const rows = [
    ["What it is", topic.definition],
    ["What it covers", topic.covers],
    ["What it doesn't cover", topic.doesntCover],
    ["Who needs it", topic.whoNeeds],
    ["Things to consider", topic.consider],
  ];
  for (const [term, desc] of rows) {
    if (!desc) continue;
    dl.appendChild(el("dt", { text: term }));
    dl.appendChild(el("dd", { text: desc }));
  }

  const card = el("div", { class: "card" }, [el("h2", { text: topic.title }), dl]);

  // Related coverages — quick cross-links to topics worth reading alongside this one.
  const related = (topic.related || [])
    .map((id) => findTopic(data, id))
    .filter(Boolean);
  if (related.length) {
    const links = el("div", { class: "choices" });
    for (const { topic: rel } of related) {
      links.appendChild(el("button", {
        class: "choice",
        text: rel.title,
        on: { click: () => go(`#/hub?topic=${rel.id}`) },
      }));
    }
    card.appendChild(el("h3", { text: "Related coverages" }));
    card.appendChild(links);
  }

  const container = el("div", {}, [
    card,
    el("div", { class: "btn-row" }, [
      el("button", { class: "btn btn-secondary", text: "Back to all coverages", on: { click: () => go("#/hub") } }),
      el("button", { class: "btn btn-primary", text: "See what I need", on: { click: () => go("#/qualify") } }),
    ]),
  ]);
  mount(container);
}

function findTopic(data, topicId) {
  for (const section of data.sections) {
    for (const topic of section.topics) {
      if (topic.id === topicId) return { section, topic };
    }
  }
  return null;
}

function glossaryTerms(glossary) {
  return Object.entries(glossary || {}).sort((a, b) => a[0].localeCompare(b[0]));
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
