// section.js — a hub section index (Residential / Commercial): intro + coverage grid.

import { el, mount } from "../dom.js";
import { icon, iconBadge, coverageIcon } from "../icons.js";
import { enhance } from "../motion.js";
import { getCoverage, getSection, firstSentence } from "../content.js";
import { sectionHead, trustStrip, ctaBand, eyebrow } from "../components/ui.js";

export async function renderSection(params, id) {
  const data = await getCoverage();
  const section = getSection(data, id);
  if (!section) return mount(el("div", { class: "placeholder" }, [
    el("h1", { class: "placeholder__title", text: "Section not found" }),
  ]));

  const view = el("div", {}, [
    el("section", { class: "band band--tint band--tight" }, [
      el("div", { class: "container" }, [
        el("div", { class: "reveal" }, [
          eyebrow(`${section.label} insurance`, section.id === "residential" ? "home" : "briefcase"),
          el("h1", { class: "display display-5xl u-mt-sm", text: `${section.label} coverage` }),
          el("p", { class: "lede u-mt-md", text: section.blurb }),
        ]),
      ]),
    ]),
    el("section", { class: "band band--surface band--tight" }, [
      el("div", { class: "container" }, [
        el("div", { class: "card-grid card-grid--3 reveal-stagger" },
          section.topics.map((topic) =>
            el("a", { class: "coverage-card", attrs: { href: `#/coverage/${topic.id}` } }, [
              iconBadge(coverageIcon(topic.id), { lg: true }),
              el("h3", { class: "coverage-card__title", text: topic.title }),
              el("p", { class: "coverage-card__blurb", text: firstSentence(topic.definition) }),
              el("span", { class: "coverage-card__more" }, [el("span", { text: "Learn more" }), icon("arrow-right", { size: 18 })]),
            ])
          )
        ),
      ]),
    ]),
    el("section", { class: "band band--tight" }, [el("div", { class: "container" }, [trustStrip()])]),
    ctaBand({
      title: "Ready to see what you need?",
      body: "Answer a few questions and get a personalized summary to share with a broker.",
      cta: "Find what coverage I need",
      href: `#/qualify?domain=${section.id}`,
    }),
  ]);
  mount(view);
  enhance();
}
