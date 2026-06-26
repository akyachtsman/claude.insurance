// coverage.js — data-driven explainer for a single coverage. One template renders
// all 14 (the mockup showcases this with the residential "home" topic).

import { el, mount } from "../dom.js";
import { icon, iconBadge, coverageIcon } from "../icons.js";
import { enhance } from "../motion.js";
import { getCoverage, findTopic } from "../content.js";
import { sectionHead, ctaBand, ctaLink, eyebrow } from "../components/ui.js";

export async function renderCoverage(params, id) {
  const data = await getCoverage();
  const found = findTopic(data, id);
  if (!found) return renderMissing();
  const { section, topic } = found;

  const view = el("div", {}, [
    covHero(section, topic),
    el("div", { class: "cov-body" }, [
      coversSection(topic),
      prose("Who typically needs it", topic.whoNeeds),
      prose("What to consider", topic.consider),
      topic.scenario ? scenario(topic.scenario) : null,
      related(data, section, topic),
    ]),
    ctaBand({
      title: "Not sure if this fits you?",
      body: "Answer a few quick questions and we'll show you which coverage matters for your situation.",
      cta: "Find what coverage I need",
      href: `#/qualify?domain=${section.id}&from=${topic.id}`,
    }),
  ]);
  mount(view);
  enhance();
}

function covHero(section, topic) {
  return el("section", { class: "cov-hero" }, [
    el("div", { class: "container" }, [
      el("nav", { class: "breadcrumb", attrs: { "aria-label": "Breadcrumb" } }, [
        el("a", { text: "Home", attrs: { href: "#/" } }),
        el("span", { class: "sep", text: "/" }),
        el("a", { text: section.label, attrs: { href: `#/${section.id}` } }),
        el("span", { class: "sep", text: "/" }),
        el("span", { text: topic.title }),
      ]),
      el("div", { class: "cov-hero__inner reveal" }, [
        iconBadge(coverageIcon(topic.id), { lg: true, class: "icon-badge--ring" }),
        el("div", {}, [
          eyebrow(`${section.label} coverage`, "shield"),
          el("h1", { class: "cov-hero__title", text: topic.title }),
          el("p", { class: "cov-hero__def", text: topic.definition }),
          el("div", { class: "btn-row cov-hero__cta" }, [
            ctaLink("See if you need this", `#/qualify?domain=${section.id}&from=${topic.id}`),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function coversSection(topic) {
  return el("section", { class: "cov-section reveal" }, [
    el("h2", { class: "cov-section__title", text: "What it covers — and what it doesn't" }),
    el("div", { class: "split" }, [
      el("div", { class: "split__col split__col--yes" }, [
        el("div", { class: "split__head" }, [iconBadge("check", { iconSize: 18 }), el("span", { text: "What it covers" })]),
        el("p", { text: topic.covers }),
      ]),
      el("div", { class: "split__col split__col--no" }, [
        el("div", { class: "split__head" }, [iconBadge("x", { iconSize: 18 }), el("span", { text: "What it doesn't" })]),
        el("p", { text: topic.doesntCover }),
      ]),
    ]),
  ]);
}

function prose(title, body) {
  if (!body) return null;
  return el("section", { class: "cov-section reveal" }, [
    el("h2", { class: "cov-section__title", text: title }),
    el("p", { text: body }),
  ]);
}

function scenario(text) {
  // Wrap a $-amount in an emphasis span if present (textContent-only, no innerHTML).
  const parts = splitAmount(text);
  return el("section", { class: "cov-section reveal" }, [
    el("div", { class: "scenario" }, [
      eyebrow("A real-world scenario", "spark"),
      el("p", { class: "scenario__text" }, parts.map((p) =>
        p.amount ? el("span", { class: "amount", text: p.text }) : el("span", { text: p.text })
      )),
    ]),
  ]);
}

function splitAmount(text) {
  const re = /(\$[\d,]+(?:\.\d+)?(?:\s?(?:million|thousand|K|M))?)/gi;
  const out = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], amount: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function related(data, section, topic) {
  const ids = topic.related || [];
  const cards = ids.map((id) => {
    const f = findTopic(data, id);
    if (!f) return null;
    return el("a", { class: "coverage-card", attrs: { href: `#/coverage/${id}` } }, [
      iconBadge(coverageIcon(id)),
      el("h3", { class: "coverage-card__title", text: f.topic.title }),
      el("span", { class: "coverage-card__more" }, [el("span", { text: "Read more" }), icon("arrow-right", { size: 18 })]),
    ]);
  }).filter(Boolean);
  if (!cards.length) return null;
  return el("section", { class: "cov-section" }, [
    sectionHead({ eyebrow: "Keep exploring", ebIcon: "book", title: "Related coverages" }),
    el("div", { class: "card-grid card-grid--3 reveal-stagger" }, cards),
  ]);
}

function renderMissing() {
  mount(el("div", { class: "placeholder" }, [
    iconBadge("book", { lg: true }),
    el("h1", { class: "placeholder__title", text: "Coverage not found" }),
    el("p", { text: "We couldn't find that coverage. Browse the residential or commercial sections to find what you're looking for." }),
    el("div", { class: "btn-row is-center" }, [
      ctaLink("Browse residential", "#/residential", { variant: "btn-secondary", noArrow: true }),
      ctaLink("Browse commercial", "#/commercial", { variant: "btn-secondary", noArrow: true }),
    ]),
  ]));
}
