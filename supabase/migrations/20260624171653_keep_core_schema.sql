-- The Keep: per-user portal data, keyed to Supabase Auth users.
-- Entity (personal "Me" + businesses) -> Asset -> Policy.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'client' check (role in ('client','broker')),
  created_at timestamptz not null default now()
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('personal','business')),
  name text not null,
  label text,
  subtype text,
  meta text,
  created_at timestamptz not null default now()
);
create index entities_owner_idx on public.entities(owner);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  type text not null,
  name text not null,
  meta text,
  value numeric,
  facts jsonb not null default '[]'::jsonb,
  attrs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index assets_entity_idx on public.assets(entity_id);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  line text not null,
  form text,
  carrier text,
  naic text,
  number text,
  status text,
  effective_date date,
  renewal_date date,
  auto_renew boolean not null default false,
  named_insured text,
  agent text,
  agent_contact text,
  premium text,
  payment_plan text,
  billing_status text,
  coverages jsonb not null default '[]'::jsonb,
  endorsements jsonb not null default '[]'::jsonb,
  deductibles jsonb not null default '[]'::jsonb,
  discounts jsonb not null default '[]'::jsonb,
  interests jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  details jsonb not null default '[]'::jsonb,
  claims text,
  created_at timestamptz not null default now()
);
create index policies_asset_idx on public.policies(asset_id);
