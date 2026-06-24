// main.js — app bootstrap and hash router.
// Routes: #/ (landing), #/residential, #/commercial, #/coverage/:id,
//         #/qualify, #/summary. Deep-linkable; old #/hub redirects to #/residential.

import { el, mount } from "./dom.js";
import { renderLanding } from "./views/landing.js";
import { renderSection } from "./views/section.js";
import { renderCoverage } from "./views/coverage.js";
import { renderQualify } from "./views/qualify.js";
import { renderSummary } from "./views/summary.js";
import {
  renderKeepLogin, renderKeepDashboard, renderKeepEntity,
  renderKeepAsset, renderKeepAddAsset,
} from "./views/keep.js";

// Programmatic navigation. Re-renders if the hash is unchanged.
export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathPart, query] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean); // ["coverage","home"]
  const params = new URLSearchParams(query || "");

  // The Keep portal swaps the public site chrome for its own (CSS via body class).
  document.body.classList.toggle("in-keep", parts[0] === "keep");

  try {
    await dispatch(parts, params);
  } catch (err) {
    console.error("route error:", err);
    mount(el("div", { class: "placeholder" }, [
      el("h1", { class: "placeholder__title", text: "Something went wrong" }),
      el("p", { text: "We couldn't load this view. Please reload the page." }),
    ]));
  }
  setActiveNav(parts[0] ? `/${parts[0]}` : "/");
  focusMain();
}

async function dispatch(parts, params) {
  const [top, sub] = parts;
  switch (top) {
    case undefined:
      return renderLanding();
    case "residential":
    case "commercial":
      return renderSection(params, top);
    case "coverage":
      return renderCoverage(params, sub);
    case "qualify":
      return renderQualify(params);
    case "summary":
      return renderSummary(params);
    case "keep":
      return dispatchKeep(parts.slice(1));
    case "hub": // back-compat with the old default route
      location.replace("#/residential");
      return;
    default:
      return renderLanding();
  }
}

// The Keep sub-router: #/keep, #/keep/login, #/keep/add-asset,
// #/keep/entity/:id, #/keep/asset/:id.
function dispatchKeep(rest) {
  const [sub, id] = rest;
  switch (sub) {
    case undefined:
      return renderKeepDashboard();
    case "login":
      return renderKeepLogin();
    case "add-asset":
      return renderKeepAddAsset();
    case "entity":
      return renderKeepEntity({}, id);
    case "asset":
      return renderKeepAsset({}, id);
    default:
      return renderKeepDashboard();
  }
}

function setActiveNav(path) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.getAttribute("data-nav") === path) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// Move focus to the main region on navigation (a11y), without scroll jank.
function focusMain() {
  const app = document.getElementById("app");
  if (app) app.focus({ preventScroll: true });
}

// Delegated navigation for non-anchor controls (e.g. the nav CTA button).
document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-go]");
  if (trigger) {
    e.preventDefault();
    go(`#${trigger.getAttribute("data-go")}`);
  }
});

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);
if (document.readyState !== "loading") route();
