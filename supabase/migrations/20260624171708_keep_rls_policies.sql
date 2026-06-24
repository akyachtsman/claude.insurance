-- RLS for the Keep. Default-deny everywhere; explicit policies per access path.

-- profiles: a user sees/edits only their own row.
alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;
create policy "profiles select own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- entities: client can fully manage their own.
alter table public.entities enable row level security;
grant select, insert, update, delete on public.entities to authenticated;
create policy "entities select own" on public.entities for select to authenticated using (owner = auth.uid());
create policy "entities insert own" on public.entities for insert to authenticated with check (owner = auth.uid());
create policy "entities update own" on public.entities for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "entities delete own" on public.entities for delete to authenticated using (owner = auth.uid());

-- assets: client can manage assets under entities they own.
alter table public.assets enable row level security;
grant select, insert, update, delete on public.assets to authenticated;
create policy "assets select own" on public.assets for select to authenticated
  using (exists (select 1 from public.entities e where e.id = assets.entity_id and e.owner = auth.uid()));
create policy "assets insert own" on public.assets for insert to authenticated
  with check (exists (select 1 from public.entities e where e.id = entity_id and e.owner = auth.uid()));
create policy "assets update own" on public.assets for update to authenticated
  using (exists (select 1 from public.entities e where e.id = assets.entity_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.entities e where e.id = entity_id and e.owner = auth.uid()));
create policy "assets delete own" on public.assets for delete to authenticated
  using (exists (select 1 from public.entities e where e.id = assets.entity_id and e.owner = auth.uid()));

-- policies: client may READ their own; writes are broker-only (service-role bypasses RLS).
alter table public.policies enable row level security;
grant select on public.policies to authenticated;
create policy "policies select own" on public.policies for select to authenticated
  using (exists (
    select 1 from public.assets a
    join public.entities e on e.id = a.entity_id
    where a.id = policies.asset_id and e.owner = auth.uid()
  ));
