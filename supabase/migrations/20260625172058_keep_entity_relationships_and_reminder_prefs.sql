-- The Keep: model relationships between a client's entities, and store each
-- client's renewal-reminder preferences. Mirrors the relationship map and the
-- reminder UI in js/views/keep.js.

-- Extend entity kinds to model related parties shown in the relationship map:
-- individuals (e.g. a spouse) and trusts, alongside the existing personal/business.
alter table public.entities drop constraint if exists entities_kind_check;
alter table public.entities
  add constraint entities_kind_check
  check (kind = any (array['personal','business','trust','person']));

-- Per-client renewal-reminder preferences (mirrors the Keep's reminder UI).
-- Schedule is the set of "days before renewal" to notify on.
alter table public.profiles
  add column if not exists reminder_email boolean not null default true,
  add column if not exists reminder_schedule integer[] not null default '{60,30,14,7,1}';

-- Directed relationships between a client's entities (ownership, trusteeship, etc.).
-- from_entity holds/controls to_entity; role + optional stake describe the link.
create table if not exists public.entity_relationships (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  from_entity uuid not null references public.entities(id) on delete cascade,
  to_entity   uuid not null references public.entities(id) on delete cascade,
  role        text not null,
  stake       text,
  created_at  timestamptz not null default now(),
  constraint entity_relationships_distinct check (from_entity <> to_entity)
);

create index if not exists entity_relationships_owner_idx on public.entity_relationships(owner);
create index if not exists entity_relationships_from_idx  on public.entity_relationships(from_entity);
create index if not exists entity_relationships_to_idx    on public.entity_relationships(to_entity);

-- RLS: default-deny; a client has full CRUD only over their own relationships.
alter table public.entity_relationships enable row level security;

create policy "entity_relationships select own" on public.entity_relationships
  for select using (owner = auth.uid());
create policy "entity_relationships insert own" on public.entity_relationships
  for insert with check (owner = auth.uid());
create policy "entity_relationships update own" on public.entity_relationships
  for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "entity_relationships delete own" on public.entity_relationships
  for delete using (owner = auth.uid());
