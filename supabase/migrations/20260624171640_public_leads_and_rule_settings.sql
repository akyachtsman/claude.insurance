-- Public/anonymous side: anonymous lead capture + broker-editable rule thresholds.

-- leads: anonymous questionnaire submissions. anon INSERT-only, no SELECT.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  domain text not null check (domain in ('residential','commercial')),
  profile jsonb not null default '{}'::jsonb,
  needs jsonb not null default '[]'::jsonb,
  contact_name text not null check (char_length(contact_name) between 1 and 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 200),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  source text not null default 'web',
  constraint leads_contact_method check (contact_email is not null or contact_phone is not null)
);
alter table public.leads enable row level security;

-- Column-level INSERT grant (auto-expose is off): anon cannot set id/created_at.
grant insert (domain, profile, needs, contact_name, contact_email, contact_phone, source)
  on public.leads to anon;

-- anon may only INSERT, with shape checks; no SELECT policy => no lead harvesting.
create policy "anon can submit a lead" on public.leads
  for insert to anon
  with check (
    domain in ('residential','commercial')
    and char_length(contact_name) between 1 and 120
    and (contact_email is not null or contact_phone is not null)
  );

-- rule_settings: single broker-editable JSON row the rules engine reads.
create table public.rule_settings (
  id int primary key default 1,
  settings jsonb not null,
  updated_at timestamptz not null default now(),
  constraint rule_settings_singleton check (id = 1)
);
alter table public.rule_settings enable row level security;

grant select on public.rule_settings to anon, authenticated;

-- Anyone may read thresholds; writes happen via service-role only (no write policy).
create policy "anyone can read rule settings" on public.rule_settings
  for select to anon, authenticated using (true);

insert into public.rule_settings (id, settings) values (
  1,
  '{"residential":{"umbrellaHomeValue":750000,"umbrellaVehicleCount":3},"commercial":{"workersCompMinEmployees":1,"umbrellaRevenue":2000000}}'::jsonb
) on conflict (id) do nothing;
