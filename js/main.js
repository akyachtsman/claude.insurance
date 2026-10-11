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
import { renderKeepHelp } from "./keep/views/help-view.js";
import { getSession, ensureData, onAuthChange } from "./supabase.js";
import { createNavStack, createHistorySignal } from "./nav.js";

// Programmatic navigation. Re-renders if the hash is unchanged.
export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// Navigation stack for "origin-aware back" (see CLAUDE.md coding standards).
// Logic lives in js/nav.js (pure + unit-tested in js/nav.test.mjs).
const nav = createNavStack();
// Stamps each history entry with an identity so the nav stack can tell a
// Back/Forward from a link, and WHICH entry it landed on. Lives in nav.js so
// the two halves of that scheme are unit-tested together — they disagreeing is
// what the last two review rounds found.
const navSignal = createHistorySignal(window.history);
export function previousRoute() { return nav.previous(); }

// ⚠️ A LOGIN CHANGE RE-DISPATCHES THE CURRENT ROUTE, including one that happened
// in ANOTHER TAB. Without this, a cross-tab sign-out left this tab sitting on a
// rendered Keep page — the Help desk still showing the previous person's
// question, answer and credited record values — because the epoch only guards
// what is WRITTEN or RESTORED, never what is already on screen. Re-dispatching
// runs the route guard, which sends an unauthenticated Keep route to the login
// card and so clears it. Found by Codex, round 19.
onAuthChange(() => { route(); });

// ⚠️ A DISPATCH IN FLIGHT MUST NOT MOUNT AFTER THE LOGIN BEHIND IT HAS CHANGED.
// `dispatchKeep` awaits `getSession()` and then `ensureData()`, so a COLD Keep
// navigation has two suspension points between the guard passing and the view
// mounting. A sign-out landing in either of them re-dispatches (above), renders
// the login card — and then the original dispatch resumed and mounted the
// signed-out client's private page OVER it, with their entities, policies and
// values on screen under no session at all. The epoch guards what Help WRITES
// and RESTORES, and round 19 guarded what is ALREADY RENDERED; neither reaches a
// render that has not happened yet. Found by Codex, round 20.
//
// One counter, bumped at the top of every `route()`: an auth change calls
// `route()`, so it supersedes by the same mechanism as a hashchange, and there is
// no second thing to keep in step. Checked after EVERY await on the way to a
// mount, and in `route()` itself so a superseded dispatch cannot paint the error
// placeholder or steal focus.
let dispatchGen = 0;

async function route() {
  const fullHash = location.hash || "#/";
  nav.track(fullHash, navSignal());

  const raw = location.hash.replace(/^#/, "") || "/";
  const [pathPart, query] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean); // ["coverage","home"]
  const params = new URLSearchParams(query || "");

  // ⚠️ BUMPED HERE, NOT AT THE TOP OF THE FUNCTION. The first version claimed
  // the counter and then ran `nav.track` and the hash parse above it, outside
  // the `try` — so a throw in either one superseded whatever was in flight and
  // then rendered nothing itself, leaving the page blank or stale with only an
  // unhandled rejection to show for it. Claiming the counter is a promise to
  // render; make it after the code that could break that promise. Found by an
  // independent review of the round-20 commit, which called it the only route to
  // a blank page it could find. Everything from here down is inside the `try`.
  // The Keep portal swaps the public site chrome for its own (CSS via body class).
  document.body.classList.toggle("in-keep", parts[0] === "keep");

  const gen = ++dispatchGen;
  try {
    await dispatch(parts, params, gen);
  } catch (err) {
    console.error("route error:", err);
    if (gen !== dispatchGen) return;
    mount(el("div", { class: "placeholder" }, [
      el("h1", { class: "placeholder__title", text: "Something went wrong" }),
      el("p", { text: "We couldn't load this view. Please reload the page." }),
    ]));
  }
  if (gen !== dispatchGen) return;
  setActiveNav(parts[0] ? `/${parts[0]}` : "/");
  focusMain();
}

async function dispatch(parts, params, gen) {
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
      return dispatchKeep(parts.slice(1), gen);
    case "hub": // back-compat with the old default route
      location.replace("#/residential");
      return;
    default:
      return renderLanding();
  }
}

// The Keep sub-router. All 18 routes: #/keep (landing), /login, /list (My
// Entities), /entities (relationships map), /grid, /entity/:id, /assets,
// /asset/:id, /insurance (all policies), /policy/:id, /requests (My requests),
// /request/:id, /add-asset, /add-entity, /documents, /account, /security, /help.
// (This header previously listed five of them.)
// Guards every route except login behind a Supabase Auth session, and loads the
// user's data once before rendering so the views can read it synchronously.
async function dispatchKeep(rest, gen) {
  const [sub, id] = rest;
  if (sub === "login") return renderKeepLogin();

  const session = await getSession();
  if (gen !== dispatchGen) return;
  if (!session) return renderKeepLogin();
  await ensureData(session.user);
  // The last gate before a signed-in view mounts. See the note on `dispatchGen`:
  // without this the page below renders under whatever session arrives next,
  // including none.
  if (gen !== dispatchGen) return;

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
    case "help":
      return renderKeepHelp();
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
