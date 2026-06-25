-- Align entity_relationships with the rest of the Keep: grant table privileges
-- to the authenticated role and scope each RLS policy to that role explicitly
-- (matching profiles/entities/assets/policies in keep_rls_policies).
grant select, insert, update, delete on public.entity_relationships to authenticated;

drop policy if exists "entity_relationships select own" on public.entity_relationships;
drop policy if exists "entity_relationships insert own" on public.entity_relationships;
drop policy if exists "entity_relationships update own" on public.entity_relationships;
drop policy if exists "entity_relationships delete own" on public.entity_relationships;

create policy "entity_relationships select own" on public.entity_relationships
  for select to authenticated using (owner = auth.uid());
create policy "entity_relationships insert own" on public.entity_relationships
  for insert to authenticated with check (owner = auth.uid());
create policy "entity_relationships update own" on public.entity_relationships
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "entity_relationships delete own" on public.entity_relationships
  for delete to authenticated using (owner = auth.uid());
