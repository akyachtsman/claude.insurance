// hub.js — knowledge hub. Renders coverage topics from content/coverage.json and
// routes into the qualification flow.

import { el, mount } from "../dom.js";
import { go } from "../main.js";

let cache = null;

async function loadCoverage() {
  if (!cache) {
    const res = await fetch("content/coverage.json");
    cache = await res.json();
  }
  return cache;
}

export async function renderHub(params) {
  const data = await loadCoverage();
  const topicId = params.get("topic");

  if (topicId) {
    const found = findTopic(data, topicId);
    if (found) return renderTopic(found.topic);
  }
  renderIndex(data);
}

function renderIndex(data) {
  const container = el("div");

  container.appendChild(el("p", {
    text: "Browse common coverages, then answer a few questions so a broker can follow up with what fits you.",
  }));

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

  mount(container);
}

function renderTopic(topic) {
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

  const container = el("div", {}, [
    el("div", { class: "card" }, [el("h2", { text: topic.title }), dl]),
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
