// supabase.js — live data client for both the public site and the Keep.
//
// Public path (anonymous): fetchRules + submitLead, anon/publishable key only.
// Keep path (authenticated): Supabase Auth session + per-user reads/writes for
// entities, assets, policies, relationships and reminder prefs — all guarded by
// RLS (owner = auth.uid()). The service-role key is NEVER used in the browser.

// VENDORED, not fetched. This was `https://esm.sh/@supabase/supabase-js@2` — a
// third party on the critical path of every render, at a floating major, with no
// integrity pinning available to an ES module import. An outage there took the
// app down; a compromised build there would have run in users' browsers holding
// their Keep session. js/vendor/README.md carries the version, the regenerate
// command, the sha256 and the revisit trigger a pinned copy obliges us to keep.
import { createClient } from "./vendor/supabase-js.js";
import { ASSET_META } from "./keep/logic/asset-meta.js";
import { policyPresentation } from "./keep/logic/policies.js";

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

// ── Login generation ────────────────────────────────────────────────────────
// Bumped on every signIn and signOut, and on NOTHING else. A view that caches
// something private across navigations binds it to this, so signing out ends it.
//
// ⚠️ NOT FOLDED INTO `invalidate()`, which three data writes also call
// (addEntity, addRelationship, addAsset) — the Help desk's cached answer would
// then vanish whenever the client added an asset.
//
// ⚠️ AND NOT DERIVABLE FROM THE USER ID, which is the whole reason it exists.
// The login screen prefills ONE shared demo credential, so two different people
// signing into the SAME account on a shared machine is the ordinary case here,
// not a contrived one — CLAUDE.md already records exactly this for
// `help_queries`' RLS ("every visitor using that demo authenticates as the SAME
// owner, so `using (owner = auth.uid())` is not a per-person fence there"). An
// owner-scoped guard cannot tell A's session from B's when both are that
// account; only a generation can. Found by Codex on PR #254, against a fix that
// had already been through three rounds on owner-scoping alone.
// ⚠️ The bump in `signOut` is SUBSUMED today, and is kept deliberately. No
// scenario can distinguish it, because the Keep's route guard means nobody can
// reach a cached-answer view while signed out, and the next `signIn` bumps the
// epoch before they could — mutation testing confirms removing it changes
// nothing. It stays because the CONTRACT ("bumped on every signIn and signOut")
// is what makes this primitive safe for the next consumer: one that can render
// while signed out would be relying on it.
let loginEpoch = 0;
export function authEpoch() { return loginEpoch; }

// Called when the LOGIN changes — here or in another tab. The router re-dispatches
// so a cross-tab sign-out leaves the Keep, and views drop anything they cached.
const authListeners = new Set();
export function onAuthChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }

// The identity of a LOGIN, not of an account: the user plus WHEN they signed in.
//
// ⚠️ `SIGNED_IN` IS NOT A NEW LOGIN. The vendored client re-establishes the
// session on tab refocus (`_onVisibilityChanged` → `_recoverAndRefresh`) and
// emits `SIGNED_IN` for the SAME session. Bumping on every such event — which is
// what the first version of this listener did — meant that switching tabs while
// an ask was running failed the epoch check and DISCARDED a paid answer, and a
// completed answer stopped restoring after navigation. Found by Codex, round 19,
// against the round-18 fix.
//
// `last_sign_in_at` is what distinguishes two logins to the same account:
// measured against the live project, two sign-ins 1.5s apart on the shared demo
// credential returned `2026-10-09T23:04:48.840374353Z` and
// `...:50.40940621Z`. It does not move on a refresh.
//
// ⚠️ THE FALLBACK IS A VALUE THAT NEVER COMPARES EQUAL, not the user id. If the
// field is ever absent, "cannot tell these logins apart" must resolve as
// CHANGED: the cost is a discarded answer, where the other direction is showing
// one person's records to the next. Deliberately the conservative side.
function loginKeyOf(session) {
  const id = session?.user?.id;
  if (!id) return null;
  const at = session.user.last_sign_in_at;
  //
  // ⚠️ THE `last_sign_in_at` COMPONENT IS BELT TODAY — measured. Reducing the key
  // to the bare user id passes every scenario, because a same-account re-login
  // can only be reached through a sign-out, and the sign-out already clears
  // everything. It is kept because the case it covers is a re-authentication with
  // NO intervening sign-out (a password change, a `USER_UPDATED`, a programmatic
  // re-sign-in), where the id alone compares equal and the stale state would be
  // retained silently. That is precisely the class of miss that got through three
  // rounds running here — owner, then session, then session-across-tabs — so the
  // stricter key stays even though no test can currently tell the difference.
  return at ? `${id}:${at}` : `${id}:unknown:${Date.now()}:${Math.random()}`;
}
let loginKey = null;
let seenLogin = false;

function announceLogin(key) {
  loginKey = key;
  if (key) seenLogin = true;
  loginEpoch += 1;
  invalidate();
  for (const fn of authListeners) {
    // One listener throwing must not stop the others, or a view's cleanup is
    // skipped by whatever ran before it.
    try { fn(key); } catch (e) { console.warn("auth listener threw —", e && e.message); }
  }
}

// ⚠️ THERE IS EXACTLY ONE `onAuthStateChange` SUBSCRIBER, AND THAT IS THE POINT.
// Round 19 added this keyed one to stop a refocus being read as a login change,
// and LEFT THE ROUND-18 UNCONDITIONAL ONE IN PLACE below it — so every
// `SIGNED_IN`, refocus included, still bumped `loginEpoch` and called
// `invalidate()`, and the fix reported as made was inert. It survived this
// session's own mutation test because the duplicate bumped the epoch WITHOUT
// notifying `authListeners`: no `route()` re-dispatch, so no scenario saw a
// second render, while a held Help answer was still discarded on tab refocus.
// Found by Codex, round 20; duplicate deleted. If a second subscriber is ever
// added here, this invariant is what breaks first.
//
// ⚠️ CROSS-TAB. The explicit calls in `signIn`/`signOut` only run in the tab that
// called them; the client broadcasts auth changes to the others over a
// BroadcastChannel. Without this, signing out and back into the shared account in
// a second tab left the first tab holding a stale epoch AND still displaying the
// previous person's answer. `TOKEN_REFRESHED` and `INITIAL_SESSION` are excluded
// outright; everything else is compared, so a refocus announcing the same login
// is a no-op.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED") return;
  const next = loginKeyOf(session);
  if (next === loginKey) return;

  // ⚠️ GAINING A LOGIN FROM NONE IS NOT A CHANGE TO ANNOUNCE, and the invariant
  // is what makes that safe rather than convenient: the clear fires on LOSING or
  // SWITCHING a login, so by the time this tab has no key, anything cached under
  // the previous one has already been dropped. Gaining one therefore cannot
  // expose a previous person's data — there is no previous person in this tab.
  //
  // It is also the only way to be correct on load. `INITIAL_SESSION` arrives with
  // a NULL session, before the client has recovered storage — measured, after a
  // first attempt that tried to baseline from it and did not work — and the
  // `SIGNED_IN` that follows carries the real one. Treating that pair as a change
  // bumped the epoch on every load and re-dispatched the route, which S18 caught
  // as a SECOND corpus fetch on a first Help visit: the very stale-render race
  // that scenario exists for, caused by the fix for a different one.
  // The distinction is "has this tab EVER had a login", not "does it have one
  // now". A first gain is the load baseline and stays silent; a gain AFTER a loss
  // is a real switch, and announcing it lets this tab follow the new session
  // rather than sitting on a stale card — safe, because the loss already cleared
  // everything held under the old one.
  if (loginKey === null && !seenLogin) { loginKey = next; seenLogin = true; return; }

  announceLogin(next);
});

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizeLogin(email), password });
  if (error) return { ok: false, error: error.message };
  // Announced here rather than left to the event, so `authEpoch()` is already
  // correct when this returns. The event then finds the same key and is a no-op.
  announceLogin(loginKeyOf(data.session));
  return { ok: true, session: data.session };
}

export async function signOut() {
  // scope: 'local' — sign out THIS browser only. supabase-js v2 defaults to
  // 'global', which revokes every refresh token for the identity, so signing
  // out on one device silently ended the session on all the others. It also
  // made the demo account untestable: an automated sign-out would have logged
  // out real visitors and any concurrently running test worker.
  // A dedicated test identity is the proper end state; this removes the hazard.
  await supabase.auth.signOut({ scope: "local" });
  announceLogin(null);
}

// ── Keep data: load once, assemble the nested shape the views expect ─────────
let cache = null;
export function invalidate() { cache = null; }

// Optionally pass the already-known signed-in user (the route guard has it) to
// skip a redundant getUser() round-trip.
export async function ensureData(user) {
  if (cache) return cache;
  const epoch = loginEpoch;
  const tree = await loadTree(user);
  // ⚠️ A FILL THAT OUTLIVED ITS LOGIN IS NEVER CACHED. `invalidate()` runs on
  // every login change, but it can only clear what is ALREADY there — a load
  // still in flight lands AFTER it and used to assign straight over the top. So:
  // sign out while a cold Keep navigation is fetching, and this wrote the
  // signed-out client's whole tree into the cache a moment later; the next person
  // to sign in found a non-null cache and every sync accessor below served them
  // the previous client's entities, assets and policies. The router's dispatch
  // generation stops the stale RENDER (js/main.js); this stops the stale FILL,
  // which outlives it. Found by Codex, round 20 — the finding named cache fills
  // explicitly and the first fix only covered the render.
  //
  // The tree is still RETURNED, because the only caller awaiting this call is the
  // dispatch that started it, and that dispatch checks its own generation before
  // mounting anything. Nothing else can be holding this promise: each call runs
  // its own `loadTree`.
  if (loginEpoch !== epoch) return tree;
  cache = tree;
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
  const allAssets = assetRows.map((a) => adaptAsset(a, polByAsset[a.id] || []));
  const assetsByEntity = groupBy(allAssets, (a) => a._entityId);
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
    assets: allAssets,
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
    // Type label shown on the pill — the specific entity type (e.g. "LLC",
    // "S Corporation", "Revocable Trust", "Estate"). Coloured by `kind`.
    label: row.label,
    subtype: row.subtype || undefined,
    industry: row.industry || undefined,
    meta: row.meta || undefined,
    icon: row.kind === "business" ? "briefcase" : (row.kind === "trust" ? "doc" : undefined),
    initials: row.kind === "personal" ? "ME" : initialsOf(row.name),
    assets,
    _hasAssets: assets.length > 0,
    // Every entity the client creates — including family members (People) — is
    // theirs to manage: listed in My Entities, clickable on the map, and
    // selectable as an owner.
    _managed: true,
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

function adaptPolicy(row) {
  // Card icon + tile colour come from the single policy-line source (keep/
  // policies.js), the same map the Policies table + type label read from.
  const pres = policyPresentation(row.line);
  return {
    id: row.id,
    _assetId: row.asset_id,
    line: row.line,
    form: row.form,
    icon: pres.card,
    cic: pres.color,
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
    premiumAmount: row.premium_amount != null ? Number(row.premium_amount) : null,
    premiumPeriod: row.premium_period || null,
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

// Every asset across all entities, each paired with its owning entity (null when
// the asset points at an entity that didn't load — a true orphan asset).
export function getAllAssets() {
  if (!cache) return [];
  return cache.assets.map((a) => ({ asset: a, entity: cache.entityById.get(a._entityId) || null }));
}

export function findAsset(assetId) {
  if (!cache) return null;
  // Resolve against the authoritative asset list (same source the Assets table
  // is built from), then attach the entity — which may be null for an orphan
  // asset whose entity didn't load. Searching only nested entity.assets would
  // miss those and bounce a valid click away from its detail page.
  const asset = cache.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  return { asset, entity: cache.entityById.get(asset._entityId) || null };
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
  // The graph shows every individual — "You" (personal) plus all the people you've
  // added (spouse, partners…), even those with no relationship yet, so no one is
  // missing from the flowchart — plus any entity that appears in a relationship
  // edge. Unlinked people simply sit in the top band with no connectors.
  cache.entities.forEach((e) => { if (e._managed && (e.kind === "personal" || e.kind === "person")) ids.add(e.id); });
  cache.relationships.forEach((r) => { ids.add(r.from); ids.add(r.to); });
  const nodes = [...ids].map((id) => {
    const e = cache.entityById.get(id);
    if (!e) return null;
    return {
      id: e.id,
      kind: e.kind,
      subtype: e.subtype || e.label || "",
      name: e.name,
      // Raw record fields only — the view derives the display sub-label via the
      // single entity-display source (getMapData stays a thin data adapter).
      sub: e.subtype || e.label || "",
      // Personal shows real initials on the map (e.g. "JM"), consistent with the
      // other individual nodes — not the "ME" marker used in the entity views.
      initials: e.kind === "personal" ? initialsOf(e.name) : e.initials,
      assetNames: (e.assets || []).map((a) => a.name),
      assetIcons: (e.assets || []).map((a) => (ASSET_META[a.type] || {}).icon || "shield"),
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
      role: r.role, stake: r.stake || "",
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
export async function addEntity({ kind, name, typeLabel }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  // Don't store a free-text identity ("You · personal", "Company") — all labels
  // derive from `kind` + `subtype` via entity-display. `subtype` is the one
  // specific-type column; `label` is left null (display-only, always derived).
  const { data, error } = await supabase.from("entities")
    .insert({ owner: user.id, kind, name, label: null, subtype: typeLabel || null })
    .select().single();
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true, id: data.id };
}

// Create a directed ownership/relationship edge: `fromEntity` (owner) holds
// `toEntity`, with a role and optional stake ("60%"). RLS keys owner=auth.uid().
export async function addRelationship({ fromEntity, toEntity, role, stake }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const { error } = await supabase.from("entity_relationships")
    .insert({ owner: user.id, from_entity: fromEntity, to_entity: toEntity, role: role || "Owner", stake: stake || null });
  if (error) return { ok: false, error: error.message };
  invalidate();
  return { ok: true };
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

// ── Help desk (feature 003) ─────────────────────────────────────────────────
// Asks the help-ask Edge Function. Sends ONLY the question: the function reads
// this client's records server-side, scoped to the owner id it resolves from the
// JWT, because a request body is client-controlled and grounding an answer on
// body-supplied records is the IDOR feature 002's review found.
//
// Returns the RAW payload; js/keep/logic/help.js → answerShape() normalises it.
// Every failure returns that same shape rather than throwing, so the view has
// one path (FR-17) and a null answer can never render as text.
export async function askHelp(question, { signal } = {}) {
  try {
    const { data, error } = await supabase.functions.invoke("help-ask", {
      body: { question },
      ...(signal ? { signal } : {}),
    });
    // An aborted request is the user navigating away or asking again — not a
    // failure to report, and not an answer either.
    if (signal?.aborted) return { answer: null, reason: "aborted" };
    if (error) {
    // A network failure, a 5xx and a 404 are the same thing to a client: all are
    // "not available", and the caller does not need to know which (FR-17). (This
    // said "410 is the retired stub still being deployed" — that was about
    // `desk-ask`, which nothing calls; this endpoint is `help-ask`.)
      console.warn("askHelp failed —", error.message);
      return { answer: null, reason: "unavailable" };
    }
    return data || { answer: null, reason: "malformed" };
  } catch (e) {
    if (signal?.aborted) return { answer: null, reason: "aborted" };
    console.warn("askHelp threw —", e && e.message);
    return { answer: null, reason: "unavailable" };
  }
}

// The help corpus. Fetched once and cached: it seeds the suggestion chips and
// the credited-source titles, and it is the SAME file the Edge Function reads,
// so chips, prompt and credits cannot drift from one another.
let helpGuideCache = null;
export async function loadHelpGuide() {
  if (helpGuideCache) return helpGuideCache;
  try {
    const res = await fetch("content/help-guide.json");
    if (!res.ok) return { topics: [] };
    const data = await res.json();
    helpGuideCache = data && Array.isArray(data.topics) ? data : { topics: [] };
    return helpGuideCache;
  } catch {
    // The page must still render without chips rather than white-screening.
    return { topics: [] };
  }
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

// Final approval. The status flip is a DIRECT RLS-guarded update; the Edge
// Function only sends the email, best-effort.
//
// ⚠️ So RLS — not the function — is the enforcement point for the lifecycle, and
// today's policies gate on ROLE ALONE (no `with check`, no status predicate), so
// any broker or underwriter can set any request to any status from any status:
// approve one still at "requested", or flip a declined one back to approved.
// CLAUDE.md assigns underwriting -> approved to the underwriter. The fix is a
// migration, written and waiting for owner approval in
// supabase/proposed/20261005_enhancement_request_stage_guard.sql. Hardening the
// function alone does NOT close this path.
export async function approveEnhancement(requestId) {
  const res = await advanceRequest(requestId, "approved");
  notifyEnhancement(requestId, "approved"); // best-effort email; don't block the UI on it
  return res;
}

// Broker/underwriter stage change (broker_review, underwriting, approved,
// declined). RLS enforces the role; sets approved_at when approving.
export async function advanceRequest(requestId, status) {
  const patch = { status };
  if (status === "approved") patch.approved_at = new Date().toISOString();
  const { error } = await supabase.from("enhancement_requests").update(patch).eq("id", requestId);
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
