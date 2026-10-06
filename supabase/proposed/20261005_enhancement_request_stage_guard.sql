-- Enforce the enhancement-request lifecycle in the DATABASE, not just the UI.
--
-- Lifecycle: requested -> broker_review -> underwriting -> approved | declined.
-- CLAUDE.md assigns underwriting -> approved/declined to the UNDERWRITER; the
-- broker advances a request only as far as underwriting.
--
-- The existing policies gate on role with no `with check` and no status
-- predicate, so either staff role could set any request to any status from any
-- status — including resurrecting a declined request as approved. See the
-- README beside this file.
--
-- NOT APPLIED. Needs owner approval (CLAUDE.md: migrations require explicit
-- approval). Move to supabase/migrations/ in the same change that applies it.

-- A broker may move a request forward through review, or decline it, but may
-- never approve: requested -> broker_review -> underwriting, or -> declined.
drop policy if exists "er_broker_update" on public.enhancement_requests;
create policy "er_broker_update" on public.enhancement_requests
  for update
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'broker'))
  with check (
    status in ('broker_review', 'underwriting', 'declined')
  );

-- An underwriter owns the final decision, and only from underwriting.
drop policy if exists "er_underwriter_update" on public.enhancement_requests;
create policy "er_underwriter_update" on public.enhancement_requests
  for update
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'underwriter'))
  with check (
    status in ('approved', 'declined', 'underwriting')
  );

-- NOTE on the remaining gap: `with check` constrains the NEW row only, so it
-- cannot by itself express "approved is reachable only FROM underwriting" —
-- Postgres row policies do not see the old row for an UPDATE's check. Closing
-- that fully needs a BEFORE UPDATE trigger validating (old.status, new.status)
-- against the allowed transition set. Written separately so this policy change
-- can land on its own; the trigger is the stricter follow-up.
