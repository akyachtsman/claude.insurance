// keep/keep-policies.js — the Policies & requests domain of the Keep portal.
// The policy detail page, the "request a coverage change" form, and the My
// requests list (lifecycle: requested → broker review → underwriting →
// approved/declined). Extracted from views/keep.js; hangs in the shared chrome
// from shell.js. Public: renderKeepPolicy / renderKeepRequest / renderKeepRequests.
import { el, mount } from "../dom.js";
import { go } from "../main.js";
import { icon } from "../icons.js";
import { s } from "../svg.js";
import { ASSET_META } from "./data.js";
import { policyKind, reminderInfo, formatPremium } from "./policies.js";
import { validateRequest, statusDisplay, defaultSubject, stageInfo, nextStage } from "./requests.js";
import { findPolicy, getUser, getPrefs, addEnhancementRequest, loadEnhancementRequests, notifyEnhancement, approveEnhancement, advanceRequest } from "../supabase.js";
import {
  sep, page, backLink, cic, dateFromDays, expiryBadge, docItem, activeSchedule, requestStepper,
} from "./shell.js";

export function renderKeepPolicy(params, id) {
  const found = findPolicy(id);
  if (!found) return renderKeepEntityList();
  const { entity, asset, policy } = found;
  const kind = policyKind(policy.renewalInDays);
  const statusLabel = kind === "exp" ? (policy.billingStatus === "Lapsed" ? "Lapsed" : "Expired")
    : (kind === "warn" ? "Expiring soon" : "Active");
  const rinfo = reminderInfo(policy.renewalInDays, activeSchedule());

  const grp = (ic, title, inner) => el("div", { class: "k-grp" }, [
    el("div", { class: "k-grp__h" }, [icon(ic, { size: 15 }), el("span", { text: title })]),
    inner,
  ]);
  const pg = (rows) => el("dl", { class: "k-pg" }, rows.map(([dt, dd]) =>
    el("div", {}, [el("dt", { text: dt }), el("dd", { text: dd })])));
  const chips = (items) => el("div", { class: "k-pcard__chips" }, items.map((c) => el("span", { class: "pill", text: c })));

  const covt = el("div", { class: "k-covt" }, policy.coverages.map((c) => {
    const amt = c.recommended
      ? el("span", { class: "amt" }, [el("span", { text: c.limit }), el("small", { text: `Recommended ${c.recommended} — underinsured` })])
      : el("span", { class: "amt", text: c.limit });
    return el("div", { class: "r" }, [
      el("span", { class: "lbl" }, [c.tag && c.tag !== "—" ? el("b", { text: c.tag }) : null, el("span", { text: c.label })]),
      amt,
    ]);
  }));

  const sections = [
    backLink(`#/keep/asset/${asset.id}`, asset.name),
    el("nav", { class: "k-crumbs" }, [
      el("a", { attrs: { href: "#/keep/list" }, text: "Entities" }), sep(),
      el("a", { attrs: { href: `#/keep/entity/${entity.id}` }, text: entity.name }), sep(),
      el("a", { attrs: { href: `#/keep/asset/${asset.id}` }, text: asset.name }), sep(),
      el("span", { text: "Policy" }),
    ]),
    el("div", { class: "k-phead" }, [
      el("span", { class: `k-cic k-cic--${policy.cic}` }, [icon(policy.icon, { size: 30 })]),
      el("div", { class: "k-phead__t" }, [
        el("h1", { text: policy.line }),
        el("div", { class: "sub", text: `${policy.carrier} · NAIC ${policy.naic}` }),
      ]),
      expiryBadge(policy.renewalInDays),
    ]),
    el("p", { class: "k-maint" }, [icon("lock", { size: 16 }), el("span", { text: `Maintained by your broker (${policy.agent}) · encrypted & private` })]),
    el("div", { class: "k-pactions" }, [
      el("a", { class: "k-btn", attrs: { href: `#/keep/request/${policy.id}` } }, [icon("spark", { size: 18 }), el("span", { text: "Request enhancement" })]),
      el("span", { class: "k-pactions__hint", text: "Ask your broker to add or change coverage on this policy." }),
    ]),
    grp("clipboard", "Policy", pg([
      ["Policy number", policy.number], ["Policy form", policy.form], ["Status", statusLabel],
      ["Effective", dateFromDays(policy.effectiveInDays)], ["Expires / renews", dateFromDays(policy.renewalInDays)], ["Auto-renew", policy.autoRenew ? "On" : "Off"],
      ["Named insured", policy.namedInsured], ["Agent of record", policy.agent], ["Agent contact", policy.agentContact],
    ])),
  ];

  if (policy.details && policy.details.length) {
    sections.push(grp(ASSET_META[asset.type] ? ASSET_META[asset.type].icon : "home", "Insured item", pg(policy.details)));
  }

  const covInner = el("div", {}, [covt]);
  if (policy.endorsements && policy.endorsements.length) {
    covInner.appendChild(el("div", { class: "k-grp__h mt" }, [icon("spark", { size: 15 }), el("span", { text: "Endorsements / riders" })]));
    covInner.appendChild(chips(policy.endorsements));
  }
  sections.push(grp("shield", "Coverages & limits", covInner));

  if (policy.deductibles && policy.deductibles.length) {
    sections.push(grp("flood", "Deductibles", pg(policy.deductibles)));
  }

  const billInner = el("div", {}, [pg([["Annual premium", formatPremium(policy)], ["Payment plan", policy.paymentPlan], ["Billing status", policy.billingStatus]])]);
  if (policy.discounts && policy.discounts.length) {
    billInner.appendChild(el("div", { class: "k-grp__h mt" }, [icon("spark", { size: 15 }), el("span", { text: "Discounts applied" })]));
    billInner.appendChild(chips(policy.discounts));
  }
  sections.push(grp("briefcase", "Premium & billing", billInner));

  if (policy.interests && policy.interests.length) {
    sections.push(grp("handshake", "Mortgagee & interests", pg(policy.interests)));
  }

  const sched = activeSchedule();
  const reminderText = (getPrefs().email && sched.length)
    ? ` Renewal reminders: ${sched.join(", ")} days before ${dateFromDays(policy.renewalInDays)}` + (rinfo.next ? ` · next at ${rinfo.next} days` : " · none upcoming")
    : " Renewal reminders are off — turn them on in Settings.";
  const docs = el("div", {}, [
    el("div", { class: "k-doclist" }, (policy.documents || []).map((d) => docItem(d, null, [policy.line, asset.name, policy.number ? `Policy ${policy.number}` : ""]))),
    el("p", { class: "k-note" }, [el("b", { text: "Claims history: " }), el("span", { text: policy.claims || "None" })]),
    el("p", { class: "k-note" }, [icon("bell", { size: 14 }), el("span", { text: reminderText })]),
  ]);
  sections.push(grp("doc", "Documents & history", docs));

  mount(page("list", sections, { narrow: true }));
}

// Request a policy enhancement. Optional policyId pre-fills the context from a
// specific policy (the "Modify" button on a policy page); without it, it's a
// general request (e.g. from the home smart prompt).
export function renderKeepRequest(policyId) {
  const found = policyId ? findPolicy(policyId) : null;
  const ctx = found
    ? { policyId: found.policy.id, assetId: found.asset.id, entityId: found.entity.id,
        label: `${found.policy.line} · ${found.asset.name}`, line: found.policy.line }
    : { policyId: null, assetId: null, entityId: null, label: "", line: "" };

  const subjectInput = el("input", { attrs: { type: "text", value: defaultSubject(ctx.line), maxlength: "200" } });
  const messageInput = el("textarea", { attrs: { rows: "5", placeholder: "Describe the change you'd like — e.g. raise liability to $500K, add flood coverage, schedule a new appraisal…", maxlength: "4000" } });
  const error = el("p", { class: "k-error", attrs: { role: "alert" } });
  const submit = el("button", { class: "k-btn k-btn--block", attrs: { type: "submit" } }, [el("span", { text: "Send request to broker" }), icon("arrow-right", { size: 20 })]);

  async function create() {
    error.textContent = "";
    const subject = subjectInput.value.trim();
    const message = messageInput.value.trim();
    const v = validateRequest({ subject, message });
    if (!v.ok) { error.textContent = v.error; return; }
    submit.setAttribute("disabled", "disabled"); submit.querySelector("span").textContent = "Sending…";
    const res = await addEnhancementRequest({ subject, message, policyId: ctx.policyId, assetId: ctx.assetId, entityId: ctx.entityId, context: ctx.label || null });
    if (!res.ok) {
      error.textContent = res.error || "Could not send your request. Please try again.";
      submit.removeAttribute("disabled"); submit.querySelector("span").textContent = "Send request to broker";
      return;
    }
    // Best-effort email to broker + client; the request is already saved.
    await notifyEnhancement(res.id, "requested");
    go("#/keep/requests");
  }

  const form = el("form", {}, [
    el("h1", { class: "k-h1", text: "Request a policy enhancement" }),
    el("p", { class: "k-sub", text: "Tell your broker what you'd like to add or change. They review every request and give final approval — you'll be emailed at each step." }),
    found ? el("div", { class: "k-reqctx" }, [
      el("span", { class: `k-cic k-cic--${found.policy.cic}` }, [icon(found.policy.icon, { size: 22 })]),
      el("div", {}, [
        el("div", { class: "k-reqctx__t", text: found.policy.line }),
        el("div", { class: "k-reqctx__s", text: `${found.asset.name}${found.policy.carrier ? ` · ${found.policy.carrier}` : ""}` }),
      ]),
    ]) : null,
    el("label", { class: "k-fld" }, [el("span", { text: "Subject" }), subjectInput]),
    el("label", { class: "k-fld" }, [el("span", { text: "What would you like to change?" }), messageInput]),
    submit, error,
    el("p", { class: "k-setnote" }, [icon("lock", { size: 14 }), el("span", { text: " This sends a request only — your broker confirms what's available and binds any change." })]),
  ]);
  form.addEventListener("submit", (e) => { e.preventDefault(); create(); });

  mount(page("requests", [backLink(found ? `#/keep/policy/${found.policy.id}` : "#/keep", found ? found.policy.line : "home"), form], { narrow: true }));
}

// The client's enhancement requests, newest first, with live status. Brokers
// additionally see an Approve control on pending requests.
export async function renderKeepRequests() {
  const requests = await loadEnhancementRequests();
  const role = (getUser() && getUser().role) || "client";
  const isStaff = role === "broker" || role === "underwriter";

  const when = (days) => days == null ? "" : (days === 0 ? "Today" : days === -1 ? "Yesterday" : `${Math.abs(days)} days ago`);

  // Role-aware stage controls. Broker moves a request up to underwriting; the
  // underwriter owns the underwriting → approved/declined decision. Approve
  // routes through approveEnhancement (status flip + best-effort email).
  const NEXT_LABEL = { broker_review: "Mark received", underwriting: "Send to underwriter" };
  function stageButton(label, ic, run) {
    const b = el("button", { class: "k-btn k-btn--sm", attrs: { type: "button" } }, [el("span", { text: label }), icon(ic, { size: 16 })]);
    b.addEventListener("click", async () => { b.setAttribute("disabled", "disabled"); b.querySelector("span").textContent = "Saving…"; await run(); renderKeepRequests(); });
    return b;
  }
  function declineButton(r) {
    const b = el("button", { class: "k-btn k-btn--ghost k-btn--sm", attrs: { type: "button" } }, [el("span", { text: "Decline" })]);
    b.addEventListener("click", async () => { b.setAttribute("disabled", "disabled"); b.querySelector("span").textContent = "…"; await advanceRequest(r.id, "declined"); renderKeepRequests(); });
    return b;
  }
  function stageControls(r) {
    if (r.status === "approved" || r.status === "declined") return [];
    if (role === "broker" && (r.status === "requested" || r.status === "broker_review")) {
      const nx = nextStage(r.status); // broker_review | underwriting
      return [stageButton(NEXT_LABEL[nx], "arrow-right", () => advanceRequest(r.id, nx)), declineButton(r)];
    }
    if (role === "underwriter" && r.status === "underwriting") {
      return [stageButton("Approve", "check", () => approveEnhancement(r.id)), declineButton(r)];
    }
    return [];
  }

  function card(r) {
    const st = statusDisplay(r.status);
    const info = stageInfo(r.status);
    return el("div", { class: "k-reqcard" }, [
      el("div", { class: "k-reqcard__top" }, [
        el("div", { class: "k-reqcard__main" }, [
          el("div", { class: "k-reqcard__subj", text: r.subject }),
          r.context ? el("div", { class: "k-reqcard__ctx", text: r.context }) : null,
        ]),
        el("span", { class: `k-pill ${st.cls}` }, [icon(st.icon, { size: 15 }), el("span", { text: st.label })]),
      ]),
      requestStepper(r.status),
      el("div", { class: "k-reqcard__stage" }, [icon(info.declined ? "alert" : "spark", { size: 14 }), el("span", { text: info.wait })]),
      el("p", { class: "k-reqcard__msg", text: r.message }),
      el("div", { class: "k-reqcard__foot" }, [
        el("span", { class: "k-reqcard__when", text: when(r.createdInDays) }),
        ...stageControls(r),
      ]),
    ]);
  }

  const HEAD = {
    broker: { h: "Requests to action", s: "Client requests — review and send to underwriting." },
    underwriter: { h: "Underwriting queue", s: "Requests submitted for underwriting approval." },
    client: { h: "My requests", s: "Policy enhancements you've asked your broker for." },
  };
  const head = HEAD[role] || HEAD.client;
  const emptyText = isStaff ? "No requests to action right now." : "No requests yet. Use “New request” or the home prompt to ask your broker for a coverage change.";

  const view = page("requests", [
    backLink("#/keep", "home"),
    el("div", { class: "k-reqhead" }, [
      el("div", {}, [
        el("h1", { class: "k-h1", text: head.h }),
        el("p", { class: "k-sub", text: head.s }),
      ]),
      isStaff ? null : el("a", { class: "k-btn", attrs: { href: "#/keep/request" } }, [icon("plus", { size: 18 }), el("span", { text: "New request" })]),
    ]),
    requests.length
      ? el("div", { class: "k-reqlist" }, requests.map(card))
      : el("div", { class: "k-empty", text: emptyText }),
  ], { narrow: true });
  mount(view);
}

