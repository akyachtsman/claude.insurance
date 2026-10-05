-- Stop a signed-in client granting itself the broker or underwriter role.
--
-- VERIFIED LIVE 2026-10-05 against ref bdsegmjcgfmgzuxwiplj, not inferred from
-- these files:
--   information_schema.column_privileges → `authenticated` holds INSERT, UPDATE
--     and SELECT on EVERY column of public.profiles, `role` among them.
--   pg_policies → "profiles update own" is
--     using (id = auth.uid()) with check (id = auth.uid()); "profiles insert own"
--     is with check (id = auth.uid()). Neither mentions `role`.
--   pg_trigger → no trigger on public.profiles or auth.users.
-- So `update profiles set role='broker' where id = auth.uid()` satisfies the
-- grant, the USING clause and the WITH CHECK clause. One PostgREST call from the
-- browser, with a credential CLAUDE.md publishes.
--
-- BLAST RADIUS (also verified, and narrower than it first looks): the only
-- role-keyed policies in the schema are on public.enhancement_requests —
-- er_broker_select, er_broker_update, er_underwriter_select, er_underwriter_update.
-- entities, assets, policies and entity_relationships are all keyed on
-- `owner = auth.uid()` with no role escape, so a self-promoted broker does NOT
-- gain cross-client access to anyone's cover. What it does gain:
--   * SELECT on every client's enhancement requests (free-text subject + body).
--   * UPDATE on them — and er_broker_update has NO `with check`, so the row's
--     owner, subject and body can be rewritten, not just its status.
-- Pre-existing and live today; independent of PR #251 and of feature 002.
--
-- WHY A COLUMN GRANT AND NOT A POLICY: RLS evaluates whole rows. A policy cannot
-- say "this column may not change" because WITH CHECK sees only the NEW row and
-- has no access to the OLD one. Column-level privileges are the only mechanism
-- in Postgres that expresses this without a trigger, which is why the fix is a
-- REVOKE rather than a policy rewrite.
--
-- WHAT THE CLIENT ACTUALLY WRITES (js/supabase.js is the only writer):
--   line 312  update({ reminder_email, reminder_schedule })   ← the only UPDATE
--   line 100  select("full_name, role, reminder_email, reminder_schedule")
-- There is no client-side INSERT anywhere in js/, and no trigger creates the
-- row, so profiles are service-role provisioned (invite-only, as designed).
-- Revoking client INSERT therefore removes an unused capability, not a used one.
--
-- INVERSE (reversible-by-design, per data.md):
--   grant insert, update on public.profiles to authenticated;
--   drop policy "profiles insert own" on public.profiles;
--   create policy "profiles insert own" on public.profiles for insert
--     to authenticated with check (id = auth.uid());
-- Note that restoring the broad grant restores the hole — that is the point.

-- 1. Narrow UPDATE to the two preference columns the account page edits.
--    `full_name` is deliberately NOT included: nothing in js/ writes it, so
--    granting it would widen the surface past what the app uses. Add it here in
--    the same change that ships a name editor.
revoke update on public.profiles from authenticated;
grant update (reminder_email, reminder_schedule) on public.profiles to authenticated;

-- 2. Remove client INSERT. Profiles are provisioned with the service-role key
--    when the broker invites a client.
revoke insert on public.profiles from authenticated;

-- 3. Defence in depth: pin the insert policy to role='client' as well, so that
--    re-granting INSERT later (by hand, or by a migration that restates the
--    table-level grant) cannot silently reopen self-promotion. Belt and braces
--    on purpose — step 2 is the guard, this is what survives step 2 being undone.
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert to authenticated
  with check (id = auth.uid() and role = 'client');

-- POST-APPLY PROBE (run as a CLIENT session, not service-role — service-role
--   bypasses RLS and would report a false pass):
--   update profiles set role='broker' where id = auth.uid();
--     → expect 42501 insufficient_privilege
--   update profiles set reminder_schedule='{30,7}' where id = auth.uid();
--     → expect success (the account page must keep working)
