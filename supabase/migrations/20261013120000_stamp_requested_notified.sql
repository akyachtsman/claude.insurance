-- stamp_requested_notified(uuid) — lets a request's OWNER record that their
-- "we received your request" email went out, and nothing else.
--
-- WHY THIS EXISTS AT ALL. `notify-enhancement` was rewritten to read and write
-- `enhancement_requests` through the CALLER's own client (anon key + their JWT)
-- instead of the service-role key, so RLS still scopes every row it touches.
-- That works for every operation the function performs except one: on the
-- `requested` event the caller is the client, and
-- `select * from pg_policies where tablename = 'enhancement_requests'` has
-- **no owner UPDATE policy** — only `er_insert_own`, `er_select_own`, and the
-- broker/underwriter UPDATE pair. So the owner cannot write
-- `requested_notified_at` on their own row, and the stamp had nowhere to go.
--
-- ⚠️ WHY NOT A COLUMN GRANT, which is the obvious answer and is wrong here.
-- Column privileges are per ROLE. Client, broker and underwriter are all the
-- same Postgres role — `authenticated` — distinguished only by RLS predicates.
-- Measured 2026-10-13: `has_table_privilege('authenticated',
-- 'public.enhancement_requests', 'UPDATE')` is TRUE and the gate is RLS alone.
-- So `grant update (requested_notified_at)` cannot mean "the owner may write
-- only this column": narrowing the role's columns would narrow them for the
-- broker and underwriter too, breaking the status transitions their policies
-- exist to allow.
--
-- ⚠️ WHY NOT AN OWNER UPDATE POLICY. RLS evaluates whole rows, and
-- `authenticated` holds table-wide UPDATE, so any owner UPDATE policy also lets
-- a client rewrite their own `subject`, `message` and `context` — and `status`
-- up to whatever the `with check` admits. That is a wider client write surface
-- than this feature needs, granted permanently to close one timestamp.
--
-- ⚠️ WHY NOT `grant update ... to service_role`. That was the alternative the
-- owner was offered and declined, and the reason is the one feature 003 already
-- settled: a service-role write is not scoped by RLS, so the narrow thing the
-- function does today becomes the wide thing a later edit can do by accident.
-- `service_role` holds NO table privileges in this project — measured, again, on
-- 2026-10-13: false for SELECT, INSERT and UPDATE on this table — and that is a
-- property worth keeping rather than chipping away at.
--
-- SO: a SECURITY DEFINER function is the only mechanism in Postgres that says
-- "the owner of this row may set exactly this one column on it". It runs as its
-- definer (postgres), so neither the missing policy nor the role's privileges
-- apply; the authorisation is the WHERE clause, and the WHERE clause is the
-- whole of it.
--
-- WHAT IT REFUSES, AND WHY IT CANNOT SAY WHICH. The update matches only when
-- ALL of these hold, and the function returns NULL otherwise:
--   id = p_request            the row exists
--   owner = auth.uid()        the caller owns it  <- the authorisation
--   status = 'requested'      it has not advanced past the stage being announced
--   requested_notified_at
--     is null                 it has not already been stamped
-- A single NULL for every failure is deliberate: a caller cannot use this
-- function to discover whether some other client's request id exists, which a
-- distinguishing error would turn it into.
--
-- `status = 'requested'` is a TIGHTENING over the code it replaces, which
-- stamped unconditionally. `er_insert_own` forces `status = 'requested'` on
-- insert and `js/keep/views/policies-view.js` calls the function immediately
-- afterwards, so the normal path is unaffected.
--
-- ⚠️ AND THIS CLAUSE ONLY STOPS A RE-ANNOUNCEMENT BECAUSE OF *WHERE THE CALLER
-- PUTS THE CALL*. An earlier version of this comment said it "stops
-- re-announcing a request that has since moved to broker_review or beyond",
-- and that was false as integrated: `notify-enhancement` sent both emails and
-- called this afterwards, so the clause returned null having prevented nothing
-- (Codex #256 round 1, P1). The function is now a CLAIM taken BEFORE the sends,
-- which is also what makes it atomic: `update ... where requested_notified_at is
-- null` is evaluated under a row lock, so a second concurrent invocation blocks,
-- re-reads the committed row, matches nothing and gets null — one claim, one
-- refusal, not two emails.
-- So the guarantee belongs to the PAIR, and a future caller that sends first
-- would silently lose it. `privilege.test.mjs` asserts the ordering for exactly
-- that reason.
--
-- `requested_notified_at is null` makes it IDEMPOTENT and keeps the FIRST
-- notification's time. A second call returns NULL and changes nothing, so a
-- client cannot walk the timestamp forward by re-invoking the endpoint.
--
-- `set search_path = ''` is not decoration: without it a SECURITY DEFINER
-- function resolves unqualified names against the caller's search_path, which is
-- the standard privilege-escalation route for this kind of function (and
-- Supabase's advisor flags it as 0011, function_search_path_mutable). Every name
-- below is schema-qualified because of it.
--
-- NOT granted to `anon` (no session, so `auth.uid()` is null and nothing could
-- ever match) and NOT granted to `service_role` (it holds no privileges on this
-- table by design, and the rewritten function never calls this with a
-- service-role client). EXECUTE is revoked from PUBLIC first because Postgres
-- grants it there by default — the same hygiene as
-- 20260624160234_harden_rls_auto_enable_revoke_execute.sql.
create or replace function public.stamp_requested_notified(p_request uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.enhancement_requests
     set requested_notified_at = pg_catalog.now()
   where id = p_request
     and owner = auth.uid()
     and status = 'requested'
     and requested_notified_at is null
  returning requested_notified_at;
$$;

revoke execute on function public.stamp_requested_notified(uuid) from public, anon, service_role;
grant  execute on function public.stamp_requested_notified(uuid) to authenticated;

comment on function public.stamp_requested_notified(uuid) is
  'Owner-only, single-column stamp of enhancement_requests.requested_notified_at. '
  'SECURITY DEFINER because authenticated has no owner UPDATE policy on that table '
  'and column privileges cannot distinguish client from broker (same DB role). '
  'Returns NULL for every refusal so it cannot be used to probe row ids it does not own.';

-- POST-APPLY PROBE — RUN 2026-10-13 against the live project, and read the
-- limitation note before trusting any of it.
--
-- HTTPS egress to the project is blocked from the authoring sandbox (measured:
-- the agent proxy rejects bdsegmjcgfmgzuxwiplj.supabase.co with
-- connect_rejected, organization policy), so a real client session over
-- PostgREST was not available. The session was simulated in-database with
--   set local role authenticated;
--   set local "request.jwt.claims" = '{"sub":"<uuid>","role":"authenticated"}';
--
-- ⚠️ THAT HARNESS DOES NOT ENFORCE RLS, AND IT WAS CHECKED RATHER THAN ASSUMED.
-- Acting as `authenticated` with a FOREIGN uid, `select count(*) from
-- public.enhancement_requests` returned 1 where `er_select_own` should give 0;
-- `session_user` is `postgres` and the MCP evidently executes in a privileged
-- context. So this harness can measure anything that does not depend on RLS,
-- and nothing that does. CLAUDE.md records the same trap for service-role
-- probes against an earlier migration here.
--
-- WHAT IS THEREFORE MEASURED, and it is the part that matters: this function is
-- SECURITY DEFINER, so it bypasses RLS BY DESIGN. Its only gate is its own
-- `owner = auth.uid()` clause, and `auth.uid()` reads the claims the harness
-- does set correctly. Both directions, because a stamp tightened one notch too
-- far refuses the owner and still looks like a working guard:
--
--   owner, status='requested', unstamped   -> timestamp returned, column written
--   owner, same call a second time         -> NULL, first timestamp intact
--   a DIFFERENT client's uuid              -> NULL, column unchanged
--
-- The seeded demo row was then restored to requested_notified_at = null.
--
-- WHAT IS *NOT* MEASURED, stated rather than implied: that a client cannot
-- simply UPDATE requested_notified_at directly. That depends on RLS, which this
-- harness does not apply. It is DERIVED from two readings — `pg_policies` lists
-- no owner UPDATE policy on this table, and
-- `has_table_privilege('authenticated', 'public.enhancement_requests', 'UPDATE')`
-- is true, so RLS is the only thing refusing it. Sound, but not end-to-end.
-- Settle it with a real bearer against PostgREST from somewhere with egress:
--   PATCH /rest/v1/enhancement_requests?id=eq.<row>
--   {"requested_notified_at":"2026-01-01T00:00:00Z"}   expect 403 / 42501
--
-- INVERSE (reversible-by-design, per data.md). Removes the capability and
-- restores the state where the owner cannot stamp at all. The Supabase MCP in
-- this environment will not run a DROP (measured: hangs 60s, applies nothing —
-- see CLAUDE.md), so revoking EXECUTE is the reversal available from a session;
-- the DROP needs the Dashboard SQL editor:
--   revoke execute on function public.stamp_requested_notified(uuid) from authenticated;
--   -- then, in the Dashboard SQL editor:
--   -- drop function public.stamp_requested_notified(uuid);
-- Non-destructive either way: no row is read, written or deleted by the reversal.

-- ⚠️ THIS MIGRATION ADDS AN EXPECTED SECURITY-ADVISOR WARNING. Do not "fix" it.
-- `get_advisors(type: security)` now reports, and reported immediately after
-- this was applied:
--
--   0029 authenticated_security_definer_function_executable (WARN)
--   "Function public.stamp_requested_notified(p_request uuid) can be executed
--    by the `authenticated` role as a SECURITY DEFINER function via
--    /rest/v1/rpc/stamp_requested_notified. Revoke EXECUTE or switch it to
--    SECURITY INVOKER if that is not intentional."
--
-- It IS intentional, and the lint's own two remedies would both break the
-- feature: revoking EXECUTE from `authenticated` leaves the owner unable to
-- stamp (the state this migration exists to fix), and SECURITY INVOKER puts the
-- call back under the missing owner UPDATE policy, so every call would return
-- zero rows. The narrowness lives in the WHERE clause, not in the grant.
-- What WOULD be a real finding on this function: the clause losing
-- `owner = auth.uid()`, or the grant widening to `anon`.
--
-- 0011 function_search_path_mutable did NOT fire, which is the `set search_path
-- = ''` above doing its job; a version without it would appear there.
