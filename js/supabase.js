// supabase.js — thin data client.
//
// Front-end-first mode: until a Supabase project is provisioned (task D1), this
// runs in STUB mode — it serves seed rule thresholds from content/rule-defaults.json
// and resolves lead submission locally without a network call. When config is filled
// in (js/config.js), it switches to real REST calls against Supabase using only the
// anon (publishable) key. The service-role key is NEVER used here — broker email is
// sent by the notify-lead Edge Function, server-side.

import { SUPABASE } from "./config.js";

// Only these columns are ever sent to the database; matches the leads table shape
// and the anon INSERT policy in supabase/migrations/0001_init.sql.
const LEAD_COLUMNS = [
  "domain",
  "industry",
  "answers",
  "needs",
  "contact_name",
  "contact_email",
  "contact_phone",
  "is_partial",
];

export function isLive() {
  return Boolean(SUPABASE.url && SUPABASE.anonKey);
}

// Fetch broker-editable rule thresholds. Falls back to seeded defaults.
export async function fetchRules() {
  if (isLive()) {
    const res = await fetch(`${SUPABASE.url}/rest/v1/rule_settings?id=eq.1&select=settings`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`fetchRules failed: ${res.status}`);
    const rows = await res.json();
    if (rows[0] && rows[0].settings) return rows[0].settings;
  }
  const res = await fetch("content/rule-defaults.json");
  return res.json();
}

// Persist a completed (or partial) lead. Returns { ok: true } (or { skipped: true }
// when a bot trips the honeypot). A successful insert into `leads` fires a DB webhook
// -> notify-lead -> broker email.
export async function submitLead(lead, options = {}) {
  // Honeypot: a hidden field no human fills. If it has a value, silently no-op so the
  // bot believes it succeeded. Escalate to a CAPTCHA if abuse continues.
  if (options.honeypot) {
    return { ok: true, skipped: true };
  }

  const row = pick(lead, LEAD_COLUMNS);

  if (isLive()) {
    const res = await fetch(`${SUPABASE.url}/rest/v1/leads`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`submitLead failed: ${res.status}`);
    return { ok: true };
  }

  // Stub mode: simulate a successful, persisted lead.
  console.info("[stub] lead captured (Supabase not yet provisioned):", row);
  return { ok: true, stub: true };
}

function authHeaders() {
  return { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
