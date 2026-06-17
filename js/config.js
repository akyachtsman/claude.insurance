// config.js — public, client-safe configuration.
//
// Fill these in at provisioning time (task D1). Both values are the Supabase project
// URL and the *anon / publishable* key, which are safe to ship to the browser — RLS
// restricts what anon can do (INSERT-only on leads, SELECT-only on rule_settings).
// The service-role key is NEVER placed here; it lives only in the notify-lead function.
//
// While these are empty, the data client runs in STUB mode (no network calls).
export const SUPABASE = {
  url: "",
  anonKey: "",
};
