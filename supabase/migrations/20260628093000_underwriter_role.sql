-- Add the underwriter role and give it read + approve access to enhancement
-- requests (it owns the underwriting → approved/declined step).
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('client','broker','underwriter'));

create policy "er_underwriter_select" on public.enhancement_requests
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'underwriter'));
create policy "er_underwriter_update" on public.enhancement_requests
  for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'underwriter'));
