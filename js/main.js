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
  renderKeepLogin, renderKeepLanding, renderKeepInsurance, renderKeepEntityList, renderKeepEntityGrid, renderKeepEntities, renderKeepEntity,
  renderKeepAsset, renderKeepAddAsset, renderKeepAddEntity, renderKeepPolicy, renderKeepAssets,
  renderKeepRequest, renderKeepRequests,
  renderKeepDocuments, renderKeepAccount, renderKeepSecurity,
} from "./keep/views/keep.js";
import { getSession, ensureData } from "./supabase.js";
import { createNavStack } from "./nav.js";

// Programmatic navigation. Re-renders if the hash is unchanged.
export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// Navigation stack for "origin-aware back" (see CLAUDE.md coding standards).
// Logic lives in js/nav.js (pure + unit-tested in js/nav.test.mjs).
const nav = createNavStack();
export function previousRoute() { return nav.previous(); }

// Tell the nav stack whether this navigation was a history traversal.
//
// A fresh hash navigation — an in-app link or go() — arrives with
// history.state === null, because setting location.hash creates a NEW entry. We
// stamp that entry immediately. When the user later traverses to it with
// Back/Forward the browser restores the entry WITH its stamp, which is how we
// know the difference. Nothing else distinguishes the two: both fire a bare
// hashchange with only the resulting hash.
//
// replaceState (not pushState) — we are labelling the entry we are already on,
// not adding one. Wrapped because a sandboxed or file:// context can throw on
// it. If stamping is unavailable every navigation reads as non-traversal, and
// nav.js is built for that: it pops a single-step back WITHOUT the flag, so the
// common case still works and only multi-step Back degrades to a push. (An
// earlier version of this comment claimed that fallback was "the old, safer
// behaviour" — it would not have been, because nav.js gated the single-step pop
// on the flag too, which would have reinstated the circular A<->B loop.)
let navSeq = 0;
function enteredByTraversal() {
  const st = history.state;
  if (st && typeof st.navSeq === "number") return true;   // restored: already stamped
  navSeq += 1;
  try { history.replaceState({ navSeq }, ""); } catch { /* unstampable context */ }
  return false;
}

async function route() {
  const fullHash = location.hash || "#/";
  nav.track(fullHash, enteredByTraversal());

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

// The Keep sub-router. All 17 routes: #/keep (landing), /login, /list (My
// Entities), /entities (relationships map), /grid, /entity/:id, /assets,
// /asset/:id, /insurance (all policies), /policy/:id, /requests (My requests),
// /request/:id, /add-asset, /add-entity, /documents, /account, /security.
// (This header previously listed five of them.)
// Guards every route except login behind a Supabase Auth session, and loads the
// user's data once before rendering so the views can read it synchronously.
async function dispatchKeep(rest) {
  const [sub, id] = rest;
  if (sub === "login") return renderKeepLogin();

  const session = await getSession();
  if (!session) return renderKeepLogin();
  await ensureData(session.user);

  switch (sub) {
    case undefined:
      return renderKeepLanding();
    case "insurance":
      return renderKeepInsurance();
    case "list":
      return renderKeepEntityList();
    case "grid":
      return renderKeepEntityGrid();
    case "add-asset":
      return renderKeepAddAsset(id);
    case "add-entity":
      return renderKeepAddEntity();
    case "entities":
      return renderKeepEntities();
    case "entity":
      return renderKeepEntity({}, id);
    case "assets":
      return renderKeepAssets();
    case "asset":
      return renderKeepAsset({}, id);
    case "policy":
      return renderKeepPolicy({}, id);
    case "request":
      return renderKeepRequest(id);
    case "requests":
      return renderKeepRequests();
    case "documents":
      return renderKeepDocuments();
    case "account":
      return renderKeepAccount();
    case "security":
      return renderKeepSecurity();
    default:
      return renderKeepLanding();
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
