// supabase.js — live data client for both the public site and the Keep.
//
// Public path (anonymous): fetchRules + submitLead, anon/publishable key only.
// Keep path (authenticated): Supabase Auth session + per-user reads/writes for
// entities, assets, policies, relationships and reminder prefs — all guarded by
// RLS (owner = auth.uid()). The service-role key is NEVER used in the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ASSET_META } from "./keep/data.js";

const CONFIG = {
  url: "https://bdsegmjcgfmgzuxwiplj.supabase.co",
  // Publishable key — safe in the browser; RLS is the actual guard.
  anonKey: "sb_publishable_38rZb9UyalhHQ8rFyr-77A_2NXk2bht",
};

// Keep client — carries the signed-in session (persisted) for authenticated reads/writes.
export const supabase = createClient(CONFIG.url, CONFIG.anonKey);

// Public client — never carries a session, so the anonymous lead-capture path
// always runs as the `anon` role even if a Keep user is signed in elsewhere.
const publicClient = createClient(CONFIG.url, CONFIG.anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function isLive() {
  return Boolean(CONFIG.url && CONFIG.anonKey);
}

// Demo logins (RLS still scopes every read/write). Two roles for testing:
//   user   → the client view (owns the seeded demo data)
//   broker → the broker view (can approve enhancement requests)
// A bare username is expanded to <name>@example.com by signIn().
export const DEMO_CREDENTIAL = { email: "user", password: "keep-demo-2026" };

// Expand a bare demo username ("user"/"broker") to its email; pass real emails through.
function normalizeLogin(id) {
  const v = (id || "").trim();
  return v.includes("@") ? v : `${v.toLowerCase()}@example.com`;
}

// ── Public lead capture (anonymous) ─────────────────────────────────────────
export async function fetchRules() {
  const { data, error } = await publicClient.from("rule_settings").select("settings").eq("id", 1).maybeSingle();
  if (!error && data && data.settings) return data.settings;
  if (error) console.warn("fetchRules: falling back to bundled defaults —", error.message);
  const res = await fetch("content/rule-defaults.json");
  return res.json();
}

export async function submitLead(lead) {
  const { error } = await publicClient.from("leads").insert(lead);
  if (error) throw new Error(`submitLead failed: ${error.message}`);
  return { ok: true };
}

// ── Auth ────────────────────────────────────────────────────────────────────
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizeLogin(email), password });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, session: data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
  invalidate();
}

// ── Keep data: load once, assemble the nested shape the views expect ─────────
let cache = null;
export function invalidate() { cache = null; }

// Optionally pass the already-known signed-in user (the route guard has it) to
// skip a redundant getUser() round-trip.
export async function ensureData(user) {
  if (!cache) cache = await loadTree(user);
  return cache;
}

async function loadTree(knownUser) {
  const user = knownUser || (await supabase.auth.getUser()).data.user;
  const uid = user ? user.id : null;

  const [profileRes, entRes, assetRes, polRes, relRes] = await Promise.all([
    supabase.from("profiles").select("full_name, role, reminder_email, reminder_schedule").eq("id", uid).maybeSingle(),
    supabase.from("entities").select("*").order("created_at"),
    supabase.from("assets").select("*").order("created_at"),
    supabase.from("policies").select("*").order("renewal_date"),
    supabase.from("entity_relationships").select("*"),
  ]);

  // Surface query failures (e.g. an RLS denial) instead of rendering silently empty.
  for (const [label, res] of [["profiles", profileRes], ["entities", entRes], ["assets", assetRes], ["policies", polRes], ["entity_relationships", relRes]]) {
    if (res.error) console.warn(`loadTree: ${label} query failed —`, res.error.message);
  }

  const profile = profileRes.data || {};
  const entityRows = entRes.data || [];
  const assetRows = assetRes.data || [];
  const policyRows = polRes.data || [];
  const relRows = relRes.data || [];

  // Index policies under their asset, assets under their entity.
  const polByAsset = groupBy(policyRows.map(adaptPolicy), (p) => p._assetId);
  const assetsByEntity = groupBy(
    assetRows.map((a) => adaptAsset(a, polByAsset[a.id] || [])),
    (a) => a._entityId
  );
  const entities = entityRows.map((e) => adaptEntity(e, assetsByEntity[e.id] || []));

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const relationships = relRows.map((r) => ({
    from: r.from_entity, to: r.to_entity, role: r.role, stake: r.stake,
  }));

  const name = profile.full_name || (user && user.email) || "Member";
  return {
    user: {
      name,
      initials: initialsOf(name),
      email: (user && user.email) || "",
      role: profile.role || "client",
      id: uid,
    },
    entities,
    entityById,
    relationships,
    prefs: {
      email: profile.reminder_email !== false,
      schedule: Array.isArray(profile.reminder_schedule) ? [...profile.reminder_schedule] : [60, 30, 14, 7, 1],
    },
  };
}

// ── Row adapters (DB row → the stub's nested shape) ─────────────────────────
function adaptEntity(row, assets) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    label: row.label,
    subtype: row.subtype || undefined,
    meta: row.meta || undefined,
    icon: row.kind === "business" ? "briefcase" : (row.kind === "trust" ? "doc" : undefined),
    initials: row.kind === "personal" ? "ME" : initialsOf(row.name),
    assets,
    _hasAssets: assets.length > 0,
    // Entities you manage (hold assets/policies in) vs. related individuals
    // (e.g. a spouse) who only appear in the relationship map.
    _managed: row.kind !== "person",
  };
}

function adaptAsset(row, policies) {
  return {
    id: row.id,
    _entityId: row.entity_id,
    type: row.type,
    name: row.name,
    meta: row.meta || "",
    value: row.value != null ? Number(row.value) : null,
    facts: row.facts || [],
    attrs: row.attrs || {},
    held: row.held || [],
    policies,
  };
}

// Per-line presentation (icon glyph + asset-tile color class) — not stored in the
// DB; derived here so the policy cards render with the right marker.
const LINE_PRES = {
  "Homeowners (HO-3)": { icon: "home", cic: "home" },
  "Flood (NFIP)": { icon: "flood", cic: "boat" },
  "Windstorm": { icon: "umbrella", cic: "home" },
  "Personal auto": { icon: "auto", cic: "auto" },
  "Scheduled personal property": { icon: "gem", cic: "gem" },
  "Business owner's policy (BOP)": { icon: "general-liability", cic: "cp" },
  "Commercial auto": { icon: "commercial-auto", cic: "auto" },
};

function adaptPolicy(row) {
  const pres = LINE_PRES[row.line] || { icon: "shield", cic: "home" };
  return {
    id: row.id,
    _assetId: row.asset_id,
    line: row.line,
    form: row.form,
    icon: pres.icon,
    cic: pres.cic,
    carrier: row.carrier,
    naic: row.naic,
    number: row.number,
    status: row.status,
    autoRenew: row.auto_renew,
    renewalInDays: daysFromToday(row.renewal_date),
    effectiveInDays: daysFromToday(row.effective_date),
    namedInsured: row.named_insured,
    agent: row.agent,
    agentContact: row.agent_contact,
    premium: row.premium,
    paymentPlan: row.payment_plan,
    billingStatus: row.billing_status,
    coverages: row.coverages || [],
    endorsements: row.endorsements || [],
    deductibles: row.deductibles || [],
    discounts: row.discounts || [],
    interests: row.interests || [],
    documents: row.documents || [],
    details: row.details || [],
    claims: row.claims,
  };
}

// ── Accessors over the loaded cache (sync; call ensureData() first) ──────────
export function getUser() { return cache ? cache.user : null; }

// Dashboard / entity lists show entities you manage (yourself, businesses,
// trusts); related individuals (e.g. a spouse) live only in the map.
export function getEntities() { return cache ? cache.entities.filter((e) => e._managed) : []; }

export function getEntity(id) { return cache ? cache.entityById.get(id) || null : null; }

export function findAsset(assetId) {
  if (!cache) return null;
  for (const entity of cache.entities) {
    const asset = entity.assets.find((a) => a.id === assetId);
    if (asset) return { entity, asset };
  }
  return null;
}

export function findPolicy(policyId) {
  if (!cache) return null;
  for (const entity of cache.entities) {
    for (const asset of entity.assets) {
      const policy = (asset.policies || []).find((p) => p.id === policyId);
      if (policy) return { entity, asset, policy };
    }
  }
  return null;
}

// Relationship-map data: every entity referenced by a relationship, plus edges.
// Only entities you manage (with assets) get a clickable href.
export function getMapData() {
  if (!cache) return { nodes: [], edges: [] };
  const ids = new Set();
  cache.relationships.forEach((r) => { ids.add(r.from); ids.add(r.to); });
  const nodes = [...ids].map((id) => {
    const e = cache.entityById.get(id);
    if (!e) return null;
    return {
      id: e.id,
      kind: e.kind,
      name: e.name,
      sub: e.label || e.subtype || "",
      initials: e.initials,
      href: e._managed ? `#/keep/entity/${e.id}` : null,
    };
  }).filter(Boolean);
  // Only keep edges whose endpoints both survived (a relationship to an entity
  // that didn't load would otherwise crash the map renderer).
  const present = new Set(nodes.map((n) => n.id));
  const edges = cache.relationships
    .filter((r) => present.has(r.from) && present.has(r.to))
    .map((r) => ({
      from: r.from, to: r.to,
      label: r.role + (r.stake ? ` · ${r.stake}` : ""),
    }));
  return { nodes, edges };
}

// ── Reminder preferences (profiles) ─────────────────────────────────────────
export function getPrefs() {
  return cache ? cache.prefs : { email: true, schedule: [60, 30, 14, 7, 1] };
}

export async function savePrefs(prefs) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase.from("profiles")
    .update({ reminder_email: prefs.email, reminder_schedule: prefs.schedule })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  if (cache) { cache.prefs.email = prefs.email; cache.prefs.schedule = [...prefs.schedule]; }
  return { ok: true };
}

// ── Writes (clients have CRUD on their own entities/assets) ──────────────────
export async function addEntity({ kind, name, subtype }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const label = kind === "personal" ? "You · personal" : (subtype || (kind === "trust" ? "Trust" : "Business"));
  const { data, error } = await supabase.from("entities")
    .insert({ owner: user.id, kind, name, label, subtype: subtype || null })
    .select().single();
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, id: data.id };
}

export async function addAsset({ entityId, type, name, meta, value }) {
  const { error, data } = await supabase.from("assets")
    .insert({
      entity_id: entityId, type, name,
      meta: meta || "", value: value != null ? value : null,
      facts: [], attrs: {}, held: [],
    })
    .select().single();
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, id: data.id };
}

// ── Policy enhancement requests ──────────────────────────────────────────────
// A client asks the broker to add/increase coverage; the broker gives final
// approval. Emails (to broker + client) fire at both steps via the
// notify-enhancement Edge Function. Requests are fetched fresh (not part of the
// cached tree) so status changes show without a full reload.
function adaptRequest(row) {
  return {
    id: row.id,
    policyId: row.policy_id || null,
    assetId: row.asset_id || null,
    entityId: row.entity_id || null,
    subject: row.subject,
    message: row.message,
    context: row.context || "",
    status: row.status,
    createdInDays: daysFromToday((row.created_at || "").slice(0, 10)),
    approved: row.status === "approved",
  };
}

export async function addEnhancementRequest({ subject, message, policyId, assetId, entityId, context }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data, error } = await supabase.from("enhancement_requests")
    .insert({
      owner: user.id, subject, message,
      policy_id: policyId || null, asset_id: assetId || null, entity_id: entityId || null,
      context: context || null,
    })
    .select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function loadEnhancementRequests() {
  const { data, error } = await supabase.from("enhancement_requests").select("*").order("created_at", { ascending: false });
  if (error) { console.warn("loadEnhancementRequests failed —", error.message); return []; }
  return (data || []).map(adaptRequest);
}

// Invoke the Edge Function to email everyone for an event ("requested" |
// "approved"). Best-effort: the request is already saved; email may be off if
// the provider key isn't configured yet.
export async function notifyEnhancement(requestId, event) {
  try {
    const { data, error } = await supabase.functions.invoke("notify-enhancement", { body: { requestId, event } });
    if (error) { console.warn("notifyEnhancement failed —", error.message); return { ok: false, error: error.message }; }
    return { ok: true, result: data };
  } catch (e) {
    console.warn("notifyEnhancement threw —", e.message);
    return { ok: false, error: e.message };
  }
}

// Broker-only final approval (RLS + the Edge Function both enforce role).
// Routed through the Edge Function so the approval emails fire.
export async function approveEnhancement(requestId) {
  return notifyEnhancement(requestId, "approved");
}

// Broker-only intermediate stage change (broker_review, underwriting, declined).
// No email — just moves the tracker along; RLS enforces the broker role.
export async function advanceRequest(requestId, status) {
  const { error } = await supabase.from("enhancement_requests").update({ status }).eq("id", requestId);
  if (error) { console.warn("advanceRequest failed —", error.message); return { ok: false, error: error.message }; }
  return { ok: true };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function initialsOf(name) {
  return (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function daysFromToday(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    (out[k] || (out[k] = [])).push(item);
  }
  return out;
}

// ASSET_META re-exported so views keep a single import surface for Keep data.
export { ASSET_META };
