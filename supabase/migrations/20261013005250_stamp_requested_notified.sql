-- stamp_requested_notified(uuid) — lets a request's OWNER CLAIM the
-- "we received your request" notification on their own row, and nothing else.
--
-- ⚠️ READ "CLAIM" LITERALLY. A populated `requested_notified_at` records that a
-- claim was TAKEN. It does **not** establish that an email was attempted, let
-- alone delivered. `EXECUTE` on this function is granted to `authenticated`, so
-- the owner can call /rest/v1/rpc/stamp_requested_notified directly — no Edge
-- Function, no provider call — and the legitimate notification then answers
-- `already_notified` and stays silent. The first line of this file's own
-- post-apply probe below IS that call.
-- An earlier version of this header said the stamp records that the email "went
-- out", which a reader would reasonably take as delivery evidence. Corrected by
-- Codex, round 7 on PR #256; the same wording is corrected in `index.ts` and in
-- CLAUDE.md, where the two candidate redesigns are written up for the owner.
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
-- ⚠️ WHY NOT A COLUMN GRANT **FOR THIS COLUMN**. Column privileges are per
-- ROLE. Client, broker and underwriter are all the same Postgres role —
-- `authenticated` — distinguished only by RLS predicates. Measured 2026-10-13:
-- `authenticated` holds UPDATE on EVERY column of this table. So
-- `grant update (requested_notified_at)` cannot mean "the owner may write only
-- this column": it would be the only column ANY authenticated caller could
-- write, breaking the status transitions the broker and underwriter policies
-- exist to allow. The owner still needs the SECURITY DEFINER function below,
-- because the owner has no UPDATE POLICY at all — a separate question from
-- which columns the role holds.
--
-- ⚠️ BUT A COLUMN GRANT IS THE RIGHT TOOL FOR A DIFFERENT, STILL-OPEN HALF, and
-- an earlier version of this comment invited the wrong conclusion by stopping
-- at "wrong here". Because `authenticated` holds UPDATE on every column while
-- the staff policies constrain only `status`, a broker or underwriter can set
-- EITHER notified stamp back to null on ANY client's row and make the function
-- re-send. The correct narrowing is not this column but the union of what
-- legitimate writers need — `grant update (status, approved_at)` — since the
-- client needs no UPDATE whatsoever and staff change only those two. Then both
-- notified columns go through SECURITY DEFINER functions and neither is
-- resettable. Raised by an automated security review of the applying commit;
-- ⚠️ **it was then APPROVED AND APPLIED** as
-- `20261013013743_notified_stamps_write_once.sql` (2026-10-13), so this is no
-- longer a still-open half and `authenticated` now holds UPDATE on
-- `(status, approved_at)` only — measured, 2 of 13 columns. The reasoning above
-- is kept because it is why the fix is a column REVOKE rather than a policy;
-- the "recorded rather than applied" line it used to end on was true for one
-- commit and is not now.
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
-- CLAIM's time — not the first notification's, which is what this said and
-- which the header above disclaims in terms: a direct RPC call populates the
-- column with no function and no provider call, and a claim taken before a
-- send that then fails stays populated. So the column answers "when was this
-- first claimed", and nothing stronger. A second call returns NULL and changes
-- nothing, so a client cannot walk the timestamp forward by re-invoking the
-- endpoint. (Codex #256 round 8 — the delivery inference surviving three lines
-- below the paragraph that removes it.)
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

-- POST-APPLY PROBE — RUN 2026-10-13.
--
-- ⚠️ THIS SECTION PREVIOUSLY CONCLUDED THAT THE IN-DATABASE HARNESS "DOES NOT
-- ENFORCE RLS", AND THAT WAS WRONG. It is corrected here rather than left to
-- contradict the re-measurement, because a stale conclusion in a probe footer
-- is worse than no conclusion: it labels a real denial as merely "derived" and
-- sends the next maintainer after a bearer-token probe they do not need.
--
-- What happened: the probe that established it used uid
-- 22222222-2222-4222-8222-222222222222 as "a DIFFERENT client". That is the
-- seeded BROKER's id, and `er_broker_select` legitimately shows a broker every
-- request — so the row it returned was RLS working correctly, read as RLS being
-- bypassed. Re-measured with a uid holding no `profiles` row
-- (99999999-9999-4999-8999-999999999999): enhancement_requests 0 rows,
-- profiles 0, entities 0. **The harness enforces RLS and column privileges.**
-- See 20261013013743's probe footer for the full write-up.
--
-- So, measured as a client session (`set local role authenticated` plus
-- `set local "request.jwt.claims"`), both directions:
--
--   owner, status='requested', unstamped   -> timestamp returned, column written
--   owner, same call a second time         -> NULL, first timestamp intact
--   the BROKER's uid (not the owner)       -> NULL, column unchanged
--   a uid with no profiles row             -> NULL
--   direct `update ... set requested_notified_at = ...` as authenticated
--                                          -> 42501 permission denied
--
-- That last line is now MEASURED, not derived — and it is a privilege denial
-- rather than an RLS one since 20261013013743 narrowed `authenticated`'s UPDATE
-- to `(status, approved_at)`.
--
-- ⚠️ AND ONE THING THIS PROBE DEMONSTRATES WITHOUT HAVING MEANT TO: the first
-- line IS a bypass. Calling this function directly as the owner — which is
-- exactly what the probe does — stamps the row without the Edge Function running
-- and without any email being sent, after which the legitimate notification
-- answers `already_notified`. So these stamps record "a claim was taken", NOT
-- "a notification was attempted". Raised by Codex on PR #256 and recorded in
-- CLAUDE.md as an open design question; the probe above was the proof of it and
-- was read as a passing test.
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
