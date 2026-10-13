-- Take the notification stamps on enhancement_requests out of staff's hands
-- entirely: narrow UPDATE to the lifecycle columns, and write both stamps only
-- through SECURITY DEFINER functions that authorize caller, status and event.
--
-- ✅ APPLIED 2026-10-13 as version 20261013013743, on the owner's explicit
-- approval, with the full probe below run and recorded. The `drop trigger if
-- exists` line was OMITTED from the applied statements: the Supabase MCP hangs
-- 60s on it and it is a no-op on a first apply. Everything else applied as
-- written.
--
-- It gated the notify-enhancement deploy, and the code on PR #256 calls the
-- function defined here — they ship as a pair, and this half is now live.
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
-- ⚠️ THIS CLOSED MORE THAN IT SET OUT TO, AND THE EARLIER DRAFT OF THIS COMMENT
-- SAID THE OPPOSITE. It read: "staff can rewrite `owner`, `subject` and `body`
-- on any client's request — wider, pre-existing, and untouched here." That was
-- written before the apply and is now false. Measured after:
--
--   authenticated may UPDATE: approved_at, status          (2 of 13 columns)
--   closed: approved_notified_at, asset_id, context, created_at, entity_id,
--           id, message, owner, policy_id, requested_notified_at, subject
--
-- So the long-standing gap CLAUDE.md recorded as accepted — staff rewriting
-- owner/subject/body on any client's request — is CLOSED by this revoke, as a
-- side effect of narrowing to what staff actually need. The policies' missing
-- `with check` on those columns is now belt rather than the only thing between
-- staff and a client's request text; a `with check` migration would still be
-- worth having if the grant were ever widened again.

-- ── 1. the approved-event stamp, authorized ─────────────────────────────────
-- Mirrors public.stamp_requested_notified (migrations/20261013005250) and
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

-- ── POST-APPLY PROBE — RUN 2026-10-13, both directions ─────────────────────
--
-- ⚠️ FIRST, A CORRECTION THAT CHANGES WHAT THIS PROBE IS WORTH. Every earlier
-- note in this repo — including the draft of this file — said the in-database
-- harness (`set local role authenticated` + `set local "request.jwt.claims"`)
-- "does NOT enforce RLS". THAT WAS WRONG, and the cause is worth recording
-- because it is a measurement error, not a tooling limit: the probe that
-- "proved" it used uid 22222222-2222-4222-8222-222222222222 as a FOREIGN
-- CLIENT. That is the seeded BROKER's uid, and `er_broker_select` legitimately
-- shows a broker every request — so the row it returned was RLS working
-- correctly, read as RLS being bypassed.
-- Re-measured with a uid holding no profiles row at all
-- (99999999-9999-4999-8999-999999999999): enhancement_requests 0 rows,
-- profiles 0, entities 0. RLS IS ENFORCED HERE. So this probe exercises
-- policies AND privileges, and the claims below are measured rather than
-- derived.
--
-- Run on a throwaway row (aaaaaaaa-0000-4000-8000-000000000001) so the seeded
-- demo request was never touched; it was re-read afterwards and is unchanged
-- (status `requested`, both stamps null).
--
-- PRIVILEGE DENIALS — as `authenticated`:
--   update ... set approved_notified_at = now()   -> 42501 permission denied
--   update ... set requested_notified_at = now()  -> 42501 permission denied
--   update ... set subject = 'forged'             -> 42501 permission denied
--
-- LIFECYCLE ALLOWS — policy and privilege together, with the REAL staff uids.
-- ⚠️ The first attempt at this half ran as the CLIENT and matched zero rows; the
-- client has no UPDATE policy at all, so it demonstrated nothing. Identity is
-- part of the probe:
--   broker      -> status = 'underwriting'                  1 row
--   underwriter -> status = 'approved', approved_at = now()  1 row, approved_at set
--
-- THE STAMP FUNCTIONS — one timestamp each, then NULL, and NULL for the wrong
-- caller:
--   owner       stamp_requested_notified(row)  -> 2026-10-13 01:40:05+00
--   owner       again                          -> NULL
--   client      stamp_approved_notified(row)   -> NULL  (not underwriter)
--   broker      stamp_approved_notified(row)   -> NULL  (not underwriter)
--   underwriter stamp_approved_notified(row)   -> 2026-10-13 01:40:22+00
--   underwriter again                          -> NULL
--
-- THE BELT — as `postgres`, which has no exemption, because a write-once column
-- with an exemption is not write-once:
--   set approved_notified_at = null  -> 42501 "approved_notified_at is
--                                       write-once (was ..., attempted <NULL>)"
--   set approved_notified_at = now() -> 42501 "... attempted 2026-10-13 01:40:35"
--
-- ✅ THE LITTER IS GONE — the owner deleted it in the Dashboard SQL editor on
-- 2026-10-13 and the table is back to its one seeded row, verified from a
-- session. The finding that forced that stands: **the Supabase MCP hangs 60s on
-- a DELETE and applies nothing**, exactly as CLAUDE.md records for DROP.
-- Measured twice, the row verified still present after each attempt — which is
-- why it took a human in the dashboard to remove a row this probe created.
-- (This is a NEW constraint on this environment — the recorded DROP finding did
-- not cover DML. Use a transaction-wrapped probe, or no probe row at all, next
-- time.)
--
-- ⚠️ And one consequence for this repo's own habits, now REAL rather than
-- predicted: the probe in migrations/20261013005250_stamp_requested_notified.sql
-- finishes by restoring the demo row's requested_notified_at to null. That
-- statement is now REFUSED by the trigger above — correctly. Use the
-- disable/enable pair below, or leave the row stamped.
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
