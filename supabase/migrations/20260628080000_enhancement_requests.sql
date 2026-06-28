-- Policy enhancement requests: a client asks their broker to add/increase
-- coverage; the broker gives final approval. Emails fire (to broker + client)
-- at both the request and the approval steps via the notify-enhancement Edge
-- Function. Clients create + read their own; only brokers (or service-role)
-- can approve.
create table if not exists public.enhancement_requests (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  policy_id uuid references public.policies(id) on delete set null,
  asset_id uuid references public.assets(id) on delete set null,
  entity_id uuid references public.entities(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 4000),
  context text check (context is null or char_length(context) <= 300),
  status text not null default 'requested' check (status in ('requested','approved','declined')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  requested_notified_at timestamptz,
  approved_notified_at timestamptz
);

alter table public.enhancement_requests enable row level security;

-- Clients: read and create their own; new rows must be their own and 'requested'
-- (clients can never self-approve — there is no client UPDATE policy).
create policy "er_select_own" on public.enhancement_requests
  for select using (owner = auth.uid());
create policy "er_insert_own" on public.enhancement_requests
  for insert with check (owner = auth.uid() and status = 'requested');

-- Brokers: read and approve across all clients.
create policy "er_broker_select" on public.enhancement_requests
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'broker'));
create policy "er_broker_update" on public.enhancement_requests
  for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'broker'));

create index if not exists er_owner_idx on public.enhancement_requests (owner);
create index if not exists er_status_idx on public.enhancement_requests (status);
