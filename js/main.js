// main.js — app bootstrap and hash router.
// Routes: #/hub (default), #/qualify, #/summary.

import { el, mount } from "./dom.js";
import { renderHub } from "./views/hub.js";
import { renderQualify } from "./views/qualify.js";
import { renderSummary } from "./views/summary.js";

// Hoisted function declaration so view modules can import it despite the
// circular reference (main <-> views).
export function go(hash) {
  if (location.hash === hash) {
    route(); // same hash: re-render explicitly
  } else {
    location.hash = hash;
  }
}

const ROUTES = {
  "/hub": renderHub,
  "/qualify": renderQualify,
  "/summary": renderSummary,
};

async function route() {
  const raw = location.hash.replace(/^#/, "") || "/hub";
  const [path, query] = raw.split("?");
  const handler = ROUTES[path] || renderHub;
  const params = new URLSearchParams(query || "");
  try {
    await handler(params);
  } catch (err) {
    console.error("route error:", err);
    mount(el("div", { class: "card" }, [
      el("h2", { text: "Something went wrong" }),
      el("p", { text: "We couldn't load this view. Please reload the page." }),
    ]));
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);
// If the document is already parsed (module loaded late), route now.
if (document.readyState !== "loading") route();
