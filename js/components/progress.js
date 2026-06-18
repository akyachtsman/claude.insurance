// progress.js — questionnaire progress bar + optional Back control.

import { el } from "../dom.js";
import { icon } from "../icons.js";

// current/total are 1-based step counts. onBack omitted hides the Back button.
export function progress({ current, total, onBack }) {
  const pct = Math.round((current / total) * 100);
  return el("div", { class: "progress" }, [
    el("div", { class: "progress__top" }, [
      onBack
        ? el("button", { class: "progress__back", attrs: { type: "button" }, on: { click: onBack } }, [
            icon("arrow-right", { size: 18, class: "icon-flip" }),
            el("span", { text: "Back" }),
          ])
        : el("span", {}),
      el("span", { class: "progress__text", text: `Step ${current} of ${total}` }),
    ]),
    el("div", { class: "progress-track", attrs: { role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" } }, [
      el("div", { class: "progress-fill", attrs: { style: `width:${pct}%` } }),
    ]),
  ]);
}
