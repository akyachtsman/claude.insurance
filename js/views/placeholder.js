// placeholder.js — interim view for routes not yet built in the visual mockup
// (the guided qualification flow and lead summary land in the full build).

import { el, mount } from "../dom.js";
import { iconBadge } from "../icons.js";
import { ctaLink } from "../components/ui.js";

export function renderPlaceholder(params, kind) {
  const copy = {
    qualify: {
      icon: "clipboard",
      title: "The guided questionnaire is coming next",
      body: "This is a visual mockup of the landing and coverage pages. The full guided " +
        "qualification flow — one question at a time, with your needs summary at the end — " +
        "is built in the next phase.",
    },
    summary: {
      icon: "spark",
      title: "Your needs summary lands here",
      body: "Once the questionnaire is built, this page shows your prioritized coverage " +
        "needs and packages them as a lead summary for a broker.",
    },
  }[kind] || { icon: "book", title: "Coming soon", body: "This view is part of the full build." };

  mount(el("div", { class: "placeholder" }, [
    iconBadge(copy.icon, { lg: true }),
    el("h1", { class: "placeholder__title", text: copy.title }),
    el("p", { text: copy.body }),
    el("div", { class: "btn-row is-center" }, [
      ctaLink("Back to home", "#/", { variant: "btn-secondary", noArrow: true }),
      ctaLink("Explore coverage", "#/residential", { variant: "btn-primary", noArrow: true }),
    ]),
  ]));
}
