// landing.js — the expressive home: hero -> how it works -> explore -> stats ->
// trust -> closing CTA. Data-light; the marketing surface.

import { el, mount } from "../dom.js";
import { icon, iconBadge } from "../icons.js";
import { enhance } from "../motion.js";
import { sectionHead, trustStrip, ctaBand, ctaLink, eyebrow, heroArt } from "../components/ui.js";

const STEPS = [
  { n: "1", icon: "book", title: "Learn in plain language", body: "Browse residential and commercial coverage explained without jargon — what each policy covers, what it doesn't, and who actually needs it." },
  { n: "2", icon: "clipboard", title: "See what you need", body: "Answer a short, guided set of questions. We highlight the coverage that fits your situation and the gaps worth a closer look." },
  { n: "3", icon: "handshake", title: "Connect with a broker", body: "Get a clear summary of your needs and hand it to a licensed broker to follow up — on your terms, with no obligation." },
];

const SECTIONS = [
  { id: "residential", icon: "home", title: "Residential", blurb: "Protect your home, vehicles, belongings, income, and personal liability.", items: ["Homeowners", "Auto", "Renters", "Umbrella", "Life", "Flood"] },
  { id: "commercial", icon: "briefcase", title: "Commercial", blurb: "Protect your business — its property, people, data, and liability.", items: ["BOP", "General liability", "Property", "Professional liability", "Workers' comp", "Cyber", "Commercial auto", "Umbrella"] },
];

export function renderLanding() {
  const view = el("div", {}, [
    hero(),
    howItWorks(),
    explore(),
    stats(),
    trustBand(),
    ctaBand({
      title: "Find the coverage that fits you",
      body: "A few minutes, fully anonymous. You'll leave with a clear picture of what to protect.",
      cta: "Find what coverage I need",
      href: "#/qualify",
    }),
  ]);
  mount(view);
  enhance(document, (n) => String(n));
}

function hero() {
  return el("section", { class: "hero" }, [
    el("div", { class: "container hero__grid" }, [
      el("div", { class: "hero__copy reveal" }, [
        eyebrow("Insurance, made clear", "shield"),
        el("h1", { class: "display display-6xl hero__title" }, [
          el("span", { text: "Understand your coverage " }),
          el("span", { class: "accent", text: "before" }),
          el("span", { text: " you ever talk to anyone." }),
        ]),
        el("p", { class: "lede hero__lede", text:
          "Harborline explains home and business insurance in plain language, then helps you " +
          "pinpoint exactly what you need — and shares it with a licensed broker when you're ready." }),
        el("div", { class: "btn-row hero__cta" }, [
          ctaLink("Find what coverage I need", "#/qualify", { size: "btn-lg" }),
          ctaLink("Explore coverage", "#/residential", { variant: "btn-secondary", noArrow: true }),
        ]),
        el("div", { class: "hero__assure" }, [
          el("span", {}, [icon("lock", { size: 16 }), el("span", { text: "100% anonymous" })]),
          el("span", {}, [icon("check", { size: 16 }), el("span", { text: "No sales calls" })]),
          el("span", {}, [icon("check", { size: 16 }), el("span", { text: "A lead summary, not a quote" })]),
        ]),
      ]),
      el("div", { class: "hero__art reveal" }, [heroArt()]),
    ]),
  ]);
}

function howItWorks() {
  return el("section", { class: "band band--surface" }, [
    el("div", { class: "container" }, [
      sectionHead({
        eyebrow: "How it works", ebIcon: "spark", center: true,
        title: "From confused to covered, in three steps",
        lede: "No logins, no pressure — just a clear path from learning to a confident next move.",
      }),
      el("div", { class: "card-grid card-grid--3 reveal-stagger" },
        STEPS.map((step) =>
          el("div", { class: "step" }, [
            el("span", { class: "step__num", text: step.n }),
            iconBadge(step.icon, { lg: true }),
            el("h3", { class: "step__title", text: step.title }),
            el("p", { class: "step__body", text: step.body }),
          ])
        )
      ),
    ]),
  ]);
}

function explore() {
  return el("section", { class: "band band--tint" }, [
    el("div", { class: "container" }, [
      sectionHead({
        eyebrow: "Explore coverage", ebIcon: "book",
        title: "Two worlds of protection, one clear guide",
        lede: "Whether you're protecting a household or running a business, start with the basics explained simply.",
      }),
      el("div", { class: "card-grid card-grid--2 reveal-stagger" },
        SECTIONS.map((sec) =>
          el("a", { class: "coverage-card", attrs: { href: `#/${sec.id}` } }, [
            iconBadge(sec.icon, { lg: true }),
            el("h3", { class: "coverage-card__title", text: sec.title }),
            el("p", { class: "coverage-card__blurb", text: sec.blurb }),
            el("div", { class: "pill-row" }, sec.items.map((it) => el("span", { class: "pill", text: it }))),
            el("span", { class: "coverage-card__more" }, [
              el("span", { text: `Explore ${sec.title.toLowerCase()}` }), icon("arrow-right", { size: 18 }),
            ]),
          ])
        )
      ),
    ]),
  ]);
}

function stats() {
  const items = [
    { to: 14, suffix: "", label: "Coverage types explained, plainly" },
    { to: 2, suffix: " min", label: "To a personalized needs summary" },
    { to: 0, suffix: "", label: "Logins, sales calls, or data sold" },
  ];
  return el("section", { class: "band band--deep" }, [
    el("div", { class: "container" }, [
      el("div", { class: "stat-strip reveal" },
        items.map((it) =>
          el("div", { class: "stat" }, [
            el("div", { class: "stat__num" }, [
              el("span", { text: "0", attrs: { "data-count-to": String(it.to) } }),
              it.suffix ? el("span", { text: it.suffix }) : null,
            ]),
            el("p", { class: "stat__label", text: it.label }),
          ])
        )
      ),
    ]),
  ]);
}

function trustBand() {
  return el("section", { class: "band band--tight" }, [
    el("div", { class: "container" }, [trustStrip()]),
  ]);
}
