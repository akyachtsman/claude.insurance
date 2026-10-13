-- Take the notification stamps on enhancement_requests out of staff's hands
-- entirely: narrow UPDATE to the lifecycle columns, and write both stamps only
-- through SECURITY DEFINER functions that authorize caller, status and event.
--
-- ⚠️ THIS BLOCKS THE notify-enhancement DEPLOY, and the code on PR #256 CALLS
-- the function this file defines — they ship as a pair. Written, not applied:
-- CLAUDE.md requires explicit owner approval for migrations.
--
-- ⚠️ THIS FILE REPLACED A TRIGGER-ONLY DESIGN, AND THE REASON IS THE WHOLE
-- POINT. The first version added only a BEFORE UPDATE trigger making both
-- stamps write-once, and argued for it over narrowing privileges. Codex round 4
-- on PR #256 showed that design is not merely weaker but makes one harm WORSE:
--
--   write-once closes BACKWARD writes (t -> null, t -> t') and deliberately
--   leaves the FIRST write (null -> t) open. `authenticated` holds UPDATE on
--   every column and both staff policies span all clients, so a broker or
--   underwriter can PRE-CLAIM a stamp on a request that has not been approved.
--   The legitimate handler then reads a populated stamp, returns
--   `already_notified`, and EMAILS NOBODY — and the trigger makes the forged
--   stamp immutable, so it can never be corrected.
--
-- So the trigger converted "staff can resend without bound" into "staff can
-- permanently suppress a client's approval notice". Both are bad; the second is
-- harder to notice, because nothing happens. Three separate reviews pointed at
-- narrowing privileges before this was accepted — an automated security review,
-- then Codex rounds 3 and 4 — and `global.md` → *Review Rounds Have to
-- Terminate* says a mechanism that keeps failing gets redesigned, not defended.
--
-- WHAT WAS WRONG WITH THE OBJECTION TO NARROWING, measured rather than argued.
-- The stated worry was that a REVOKE can break a writer nobody remembered, on a
-- staff lifecycle that had never been exercised by anybody until 2026-10-09. So
-- the writer set was enumerated instead of assumed. Every touch of this table
-- from `js/`:
--   js/supabase.js:558  .insert({...})            -- INSERT, unaffected by an UPDATE revoke
--   js/supabase.js:622  .select("*")              -- read
--   js/supabase.js:663  .update(patch)            -- advanceRequest
-- and `advanceRequest` builds `patch` as exactly `{ status }`, plus
-- `approved_at` when the status is `approved`. That is precisely the column
-- grant below. The Edge Function writes the same two in its transition. Nothing
-- else writes this table at all. The grant is therefore not a guess.
--
-- AFTER THIS, STAFF CANNOT TOUCH EITHER STAMP IN ANY DIRECTION — no reset, no
-- walk-forward, and no pre-claim, because the privilege is simply gone. That is
-- what makes the class closed rather than bounded.
--
-- ⚠️ WHAT THIS STILL DOES NOT FIX, so it is not mistaken for covered: staff can
-- rewrite `owner`, `subject` and `body` on any client's request. Wider,
-- pre-existing, recorded in CLAUDE.md, and untouched here — `(status,
-- approved_at)` is what staff NEED, and the policies' missing `with check` on
-- those columns is a separate migration.

-- ── 1. the approved-event stamp, authorized ─────────────────────────────────
-- Mirrors public.stamp_requested_notified (migrations/20261013120000) and
-- authorizes the three things the handler must not be trusted to check:
--   the CALLER  — must be the underwriter, read from profiles, not the request
--   the STATUS  — must be `approved`, so the stamp cannot be laid on a declined
--                 or in-review row (the round-3 finding, now enforced in the DB
--                 rather than only in the handler's `.eq("status","approved")`)
--   the EVENT   — one stamp, one column, one direction: null -> now()
-- Returns NULL for every refusal, so it cannot be used to probe row ids or
-- other clients' request states.
create or replace function public.stamp_approved_notified(p_request uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update public.enhancement_requests
     set approved_notified_at = pg_catalog.now()
   where id = p_request
     and status = 'approved'
     and approved_notified_at is null
     and exists (
       select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'underwriter'
     )
  returning approved_notified_at;
$$;

revoke execute on function public.stamp_approved_notified(uuid) from public, anon, service_role;
grant  execute on function public.stamp_approved_notified(uuid) to authenticated;

comment on function public.stamp_approved_notified(uuid) is
  'Underwriter-only, single-column, null-to-value stamp of enhancement_requests.approved_notified_at. '
  'SECURITY DEFINER because authenticated no longer holds UPDATE on that column. '
  'Authorizes caller role, row status and direction; returns NULL for every refusal.';

-- ── 2. narrow what `authenticated` may UPDATE ───────────────────────────────
-- The revoke is the load-bearing statement in this file. Without it the two
-- stamp functions are decorative, because the same caller can write the columns
-- directly. ⚠️ Order matters: revoke first, then re-grant the two columns, or
-- the table-wide privilege survives.
--
-- `anon` and `service_role` are not mentioned because neither holds UPDATE here
-- (measured 2026-10-13: `has_table_privilege('service_role',
-- 'public.enhancement_requests','UPDATE')` is false — this project's
-- service_role has no table privileges at all).
revoke update on public.enhancement_requests from authenticated;
grant  update (status, approved_at) on public.enhancement_requests to authenticated;

-- ── 3. write-once, as BELT and labelled as belt ─────────────────────────────
-- ⚠️ THIS IS NO LONGER THE BOUNDARY. Step 2 is. Kept for one specific, repo-
-- documented reason rather than as general defence: this project has already
-- been bitten by a later migration restating a grant table-wide, which is
-- exactly why migrations/20261006120000_help_queries.sql refuses UPDATE at BOTH
-- the grant and policy layers and says so. A `grant update on
-- public.enhancement_requests to authenticated` in some future file would
-- silently undo step 2; this trigger means the reset and walk-forward stay
-- refused even then. It does NOT stop a pre-claim — only step 2 does — and
-- saying so here is the correction this file exists to make.
create or replace function public.enforce_notified_write_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.requested_notified_at is not null
     and new.requested_notified_at is distinct from old.requested_notified_at then
    raise exception 'requested_notified_at is write-once (was %, attempted %)',
      old.requested_notified_at, new.requested_notified_at using errcode = '42501';
  end if;
  if old.approved_notified_at is not null
     and new.approved_notified_at is distinct from old.approved_notified_at then
    raise exception 'approved_notified_at is write-once (was %, attempted %)',
      old.approved_notified_at, new.approved_notified_at using errcode = '42501';
  end if;
  return new;
end;
$$;

-- `is distinct from`, not `<>`: `t <> null` is NULL rather than true, so a `<>`
-- comparison would let the reset-to-null case through — the exact case this
-- refuses. Not SECURITY DEFINER; a rejection trigger needs no elevated rights.
revoke execute on function public.enforce_notified_write_once() from public, anon, authenticated, service_role;

-- ⚠️ `drop trigger if exists` CANNOT be run through the Supabase MCP (it hangs
-- 60s and applies nothing — CLAUDE.md records the measurement for DROP POLICY
-- and DROP TABLE; the classifier treats DROP TRIGGER the same). On a first apply
-- it is a no-op, so run without it, or apply the whole file from the Dashboard
-- SQL editor. It is in the file because `create trigger` has no `or replace`.
drop trigger if exists enhancement_requests_notified_write_once on public.enhancement_requests;
create trigger enhancement_requests_notified_write_once
  before update on public.enhancement_requests
  for each row execute function public.enforce_notified_write_once();

-- ── POST-APPLY PROBE ────────────────────────────────────────────────────────
-- Two halves, and both are needed: the denials are what this is for, and the
-- allows are what prove it did not break the lifecycle instead. A guard
-- tightened one notch too far refuses the underwriter's own approval and looks
-- like it is working — the failure mode CLAUDE.md records against the stage
-- guard's own probe.
--
-- ⚠️ The PRIVILEGE half needs a real staff session over PostgREST, which cannot
-- be run from the authoring sandbox (HTTPS egress to the project is blocked:
-- connect_rejected). The in-database `set local role` substitute does NOT
-- enforce RLS — measured, a foreign uid still saw the row — but it DOES enforce
-- column privileges, which is what step 2 changes, so the privilege denials are
-- checkable there. The POLICY-dependent parts are not. State which half any
-- recorded run covered.
--
-- privilege denials (checkable in-database as `set local role authenticated`):
--   update ... set approved_notified_at  = now()  -> 42501  (no column privilege)
--   update ... set requested_notified_at = now()  -> 42501  (no column privilege)
--   update ... set subject = 'x'                  -> 42501  (no column privilege)
-- lifecycle allows (needs a real broker/underwriter session for the policy half):
--   update ... set status = 'broker_review'       -> 204    (advanceRequest)
--   update ... set status = 'approved',
--                  approved_at = now()            -> 204    (advanceRequest)
-- the functions:
--   as the underwriter, stamp_approved_notified(<approved row>)   -> timestamp
--   again                                                         -> NULL
--   as a client or broker                                         -> NULL
--   on a row at 'declined' or 'underwriting'                      -> NULL
--   as the owner, stamp_requested_notified(<requested row>)       -> timestamp
-- the belt:
--   as postgres: update ... set approved_notified_at = null       -> 42501 (trigger)
--
-- ⚠️ And one consequence for this repo's own habits: the probe in
-- migrations/20261013120000_stamp_requested_notified.sql finishes by restoring
-- the demo row's requested_notified_at to null. That statement will be REFUSED
-- once this is applied — correctly. Use the disable/enable pair below, or leave
-- the demo row stamped.
--
-- ── INVERSE (reversible-by-design, per data.md) ─────────────────────────────
--   grant update on public.enhancement_requests to authenticated;   -- undoes step 2
--   alter table public.enhancement_requests
--     disable trigger enhancement_requests_notified_write_once;      -- undoes step 3
--   revoke execute on function public.stamp_approved_notified(uuid)
--     from authenticated;                                           -- undoes step 1
--   -- and, in the Dashboard SQL editor, to remove entirely:
--   -- drop trigger enhancement_requests_notified_write_once on public.enhancement_requests;
--   -- drop function public.enforce_notified_write_once();
--   -- drop function public.stamp_approved_notified(uuid);
-- Non-destructive: no row is read, written or deleted by the reversal.
--
-- TO APPLY: review, then move to `supabase/migrations/` in the same change that
-- runs it, run the probe above, record which half it covered, and drop its row
-- from this directory's README.
