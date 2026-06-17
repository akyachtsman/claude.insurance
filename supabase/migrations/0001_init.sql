-- 0001_init.sql — leads + rule_settings, with RLS.
--
-- Applied at provisioning time (see supabase/README.md). Nothing here runs until a
-- real Supabase project exists and this migration is applied — it is prepared, not live.
--
-- Security model (per the data directive + CLAUDE.md):
--   * leads:         anon may INSERT only (shape-checked); NO SELECT for anon (no
--                    lead harvesting). Brokers read via the dashboard / service role.
--   * rule_settings: anon may SELECT only; never writable from the client.
--   * The service-role key is used only server-side (the notify-lead function). It is
--     never shipped to the browser.

-- ── leads ────────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  domain        text not null check (domain in ('residential', 'commercial')),
  industry      text,
  answers       jsonb not null default '{}'::jsonb,
  needs         jsonb not null default '[]'::jsonb,
  contact_name  text not null,
  contact_email text,
  contact_phone text,
  is_partial    boolean not null default false,
  -- A usable lead needs at least one way to reach the person (C8).
  constraint leads_contact_method check (contact_email is not null or contact_phone is not null)
);

alter table public.leads enable row level security;

-- Anon can only INSERT, and only well-shaped rows. No SELECT/UPDATE/DELETE policy
-- exists for anon, so those are denied.
drop policy if exists "anon insert leads" on public.leads;
create policy "anon insert leads"
  on public.leads
  for insert
  to anon
  with check (
    domain in ('residential', 'commercial')
    and char_length(contact_name) between 1 and 200
    and (contact_email is not null or contact_phone is not null)
    and char_length(coalesce(contact_email, '')) <= 320
    and char_length(coalesce(contact_phone, '')) <= 40
  );

-- Table-level privilege (RLS still gates rows). Insert only — no select grant.
grant insert on public.leads to anon;

-- ── rule_settings ────────────────────────────────────────────────────────────
-- Single-row, broker-editable thresholds consumed by the needs/gap engine.
create table if not exists public.rule_settings (
  id         int primary key default 1,
  settings   jsonb not null,
  updated_at timestamptz not null default now(),
  constraint rule_settings_singleton check (id = 1)
);

alter table public.rule_settings enable row level security;

drop policy if exists "anon read rule_settings" on public.rule_settings;
create policy "anon read rule_settings"
  on public.rule_settings
  for select
  to anon
  using (true);

grant select on public.rule_settings to anon;

-- Seed defaults (mirror content/rule-defaults.json). Brokers edit this row later via
-- the Supabase dashboard until a broker UI exists (no broker UI in v1).
insert into public.rule_settings (id, settings)
values (
  1,
  '{
    "residential": { "umbrellaHomeValue": 750000, "umbrellaVehicleCount": 3 },
    "commercial":   { "workersCompMinEmployees": 1, "umbrellaRevenue": 2000000 }
  }'::jsonb
)
on conflict (id) do nothing;
