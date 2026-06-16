// supabase.js — thin data client.
//
// Front-end-first mode: until a Supabase project is provisioned (task D1), this
// runs in STUB mode — it serves seed rule thresholds from content/rule-defaults.json
// and resolves lead submission locally without a network call. When config is filled
// in, it switches to real REST calls against Supabase using only the anon
// (publishable) key. The service-role key is NEVER used here — broker email is sent
// by the notify-lead Edge Function, server-side.

const CONFIG = {
  // Filled in at task D1. Leave empty to stay in stub mode.
  url: "",
  anonKey: "",
};

export function isLive() {
  return Boolean(CONFIG.url && CONFIG.anonKey);
}

// Fetch broker-editable rule thresholds. Falls back to seeded defaults.
export async function fetchRules() {
  if (isLive()) {
    const res = await fetch(`${CONFIG.url}/rest/v1/rule_settings?id=eq.1&select=settings`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`fetchRules failed: ${res.status}`);
    const rows = await res.json();
    if (rows[0] && rows[0].settings) return rows[0].settings;
  }
  const res = await fetch("content/rule-defaults.json");
  return res.json();
}

// Persist a completed (or partial) lead. Returns { ok: true }.
// A successful insert into `leads` fires a DB webhook -> notify-lead -> broker email.
export async function submitLead(lead) {
  if (isLive()) {
    const res = await fetch(`${CONFIG.url}/rest/v1/leads`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(lead),
    });
    if (!res.ok) throw new Error(`submitLead failed: ${res.status}`);
    return { ok: true };
  }
  // Stub mode: simulate a successful, persisted lead.
  console.info("[stub] lead captured (Supabase not yet provisioned):", lead);
  return { ok: true, stub: true };
}

function authHeaders() {
  return { apikey: CONFIG.anonKey, Authorization: `Bearer ${CONFIG.anonKey}` };
}
