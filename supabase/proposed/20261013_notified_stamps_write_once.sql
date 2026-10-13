-- Make enhancement_requests' two notification stamps WRITE-ONCE.
--
-- ⚠️ THIS BLOCKS THE notify-enhancement DEPLOY. Codex round 3 on PR #256 raised
-- it as a P1 with "before deployment" in the finding itself, and it is right:
-- the rework on that PR is what turns notify-enhancement from a dead endpoint
-- (every call 42501 → 404) into a working one, so the abuse it enables becomes
-- reachable at the same moment the feature does. Written, not applied —
-- CLAUDE.md requires explicit owner approval for migrations.
--
-- THE HOLE, measured 2026-10-13 rather than inferred.
-- `information_schema.column_privileges` shows `authenticated` holds UPDATE on
-- EVERY column of `public.enhancement_requests`, both notification stamps
-- included. `er_broker_update` and `er_underwriter_update` constrain only
-- `status` in their `with check`. So:
--
--   underwriter: update enhancement_requests set approved_notified_at = null
--                where id = <row>;          -- status unchanged, check passes
--   then POST notify-enhancement {event:"approved"} again -> both emails resend
--
-- and a broker or underwriter can do the same to `requested_notified_at` on ANY
-- client's row. Repeat without bound: client inbox, broker inbox, and provider
-- spend. The owner/client cannot — there is no owner UPDATE policy at all —
-- so this is a staff capability, not a client one.
--
-- WHY THE HANDLER CANNOT FIX IT. notify-enhancement now claims each stamp
-- atomically before sending (`update ... where <stamp> is null`), which makes a
-- retry, a double submit and two concurrent invocations produce one email
-- instead of two. That is a gate against ACCIDENT. It cannot be a gate against
-- INTENT, because the thing it tests is a column the caller may rewrite. No
-- amount of handler code closes that; it is a database capability.
--
-- WHY A TRIGGER AND NOT THE PRIVILEGE NARROWING. The other fix on offer, and
-- the one the automated security review suggested first, is:
--
--   revoke update on public.enhancement_requests from authenticated;
--   grant  update (status, approved_at) on public.enhancement_requests to authenticated;
--
-- That is sound — `(status, approved_at)` is the whole of what any legitimate
-- writer touches: `js/` only ever writes `status` (via `advanceRequest`), the
-- Edge Function writes `approved_at`, and the client needs no UPDATE whatsoever.
-- Two reasons this file takes the trigger instead:
--   1. A REVOKE can break what works; a rejection trigger cannot. Nothing in
--      this project legitimately resets a notification stamp, so the trigger
--      refuses only calls that are already defects. The revoke, by contrast,
--      silently breaks any writer that touches a column nobody remembered —
--      and the staff lifecycle it governs had never been exercised by anybody
--      until 2026-10-09 (see CLAUDE.md's Backend note on the broker and
--      underwriter logins returning HTTP 500 for their whole existence), so
--      "nothing else writes these columns" rests on a reading of the code, not
--      on traffic.
--   2. IT IS TESTABLE FROM A SESSION AND THE REVOKE IS NOT. HTTPS egress to
--      this project is blocked from the authoring sandbox, and the in-database
--      substitute does NOT enforce RLS (measured: a foreign uid still saw the
--      row). A trigger fires for every writer regardless of RLS, so its
--      behaviour CAN be proved here; a privilege narrowing cannot be, and
--      shipping an unverified revocation against a lifecycle nobody has
--      exercised is the riskier of the two.
-- The two are not exclusive. Applying both is strictly better, and the revoke
-- is the one to take if the owner would rather narrow capability than refuse
-- misuse. ⚠️ The trigger alone leaves staff able to rewrite `owner`, `subject`
-- and `body` on any client's request — a wider, pre-existing, already-recorded
-- gap that neither fix here addresses.
--
-- WHAT IT ALLOWS AND REFUSES. Write-once, per column, independently:
--   null -> timestamp    allowed   (the claim)
--   t    -> t            allowed   (an idempotent rewrite of the same value;
--                                   permitted so an unrelated UPDATE that
--                                   happens to carry the column is not refused)
--   t    -> null         REFUSED   (the reset that enables the resend)
--   t    -> t'           REFUSED   (walking the timestamp forward)
--
-- It applies to EVERY writer, `postgres` included, which is deliberate: a
-- write-once column with an exemption is not write-once. Legitimate admin
-- surgery disables the trigger explicitly, which is auditable — and note the
-- consequence for this repo's own habits, because it is a real one: the probe
-- in migrations/20261013120000_stamp_requested_notified.sql finishes by
-- restoring the demo row's `requested_notified_at` to null, and that statement
-- will be REFUSED once this is applied. Use the documented disable/enable pair
-- below, or leave the demo row stamped.
create or replace function public.enforce_notified_write_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.requested_notified_at is not null
     and new.requested_notified_at is distinct from old.requested_notified_at then
    raise exception
      'requested_notified_at is write-once (was %, attempted %)',
      old.requested_notified_at, new.requested_notified_at
      using errcode = '42501';
  end if;

  if old.approved_notified_at is not null
     and new.approved_notified_at is distinct from old.approved_notified_at then
    raise exception
      'approved_notified_at is write-once (was %, attempted %)',
      old.approved_notified_at, new.approved_notified_at
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- `is distinct from` rather than `<>`, because `t <> null` is NULL, not true —
-- so a `<>` comparison would let the reset-to-null case through, which is the
-- exact case this exists to refuse.
--
-- Not SECURITY DEFINER: a rejection trigger needs no elevated rights, and
-- making it definer would add a privileged execution path for nothing.
-- `search_path` is pinned anyway (advisor 0011 applies to trigger functions too).
revoke execute on function public.enforce_notified_write_once() from public, anon, authenticated, service_role;

drop trigger if exists enhancement_requests_notified_write_once on public.enhancement_requests;
create trigger enhancement_requests_notified_write_once
  before update on public.enhancement_requests
  for each row execute function public.enforce_notified_write_once();

-- ⚠️ THAT `drop trigger if exists` CANNOT BE RUN THROUGH THE SUPABASE MCP — it
-- hangs 60s and applies nothing (CLAUDE.md records the measurement for DROP
-- POLICY and DROP TABLE; DROP TRIGGER is the same classifier). On a first apply
-- it is a no-op anyway, so run the two statements WITHOUT it, or apply the whole
-- file from the Dashboard SQL editor. It is kept in the file because a re-apply
-- needs it and because `create trigger` has no `or replace`.
--
-- POST-APPLY PROBE. ⚠️ Unlike every other probe in this repo, this one does NOT
-- need a client session: a trigger fires for every writer regardless of role or
-- RLS, which is the property that makes it verifiable from a session at all.
-- Run as `postgres` and expect the refusals anyway — that IS the assertion.
--
--   -- setup: claim the stamp
--   update public.enhancement_requests set requested_notified_at = now()
--    where id = '<row>';                                  -- expect: 1 row
--   -- the reset that enables the resend
--   update public.enhancement_requests set requested_notified_at = null
--    where id = '<row>';                                  -- expect: 42501
--   -- walking it forward
--   update public.enhancement_requests set requested_notified_at = now()
--    where id = '<row>';                                  -- expect: 42501
--   -- an unrelated write must STILL WORK (the half a denial-only probe misses)
--   update public.enhancement_requests set status = 'broker_review'
--    where id = '<row>';                                  -- expect: 1 row
--   -- and the same four for approved_notified_at
--
-- Both directions, because a trigger one notch too strict refuses the staff
-- lifecycle and looks like a working guard — the failure mode CLAUDE.md records
-- against the stage guard's own probe.
--
-- INVERSE (reversible-by-design, per data.md). Disabling is what a session can
-- do; the DROPs need the Dashboard SQL editor:
--   alter table public.enhancement_requests
--     disable trigger enhancement_requests_notified_write_once;
--   -- re-enable with ENABLE TRIGGER; or, to remove entirely:
--   -- drop trigger enhancement_requests_notified_write_once on public.enhancement_requests;
--   -- drop function public.enforce_notified_write_once();
-- Non-destructive: no row is read, written or deleted by the reversal.
--
-- TO APPLY: review, then move to `supabase/migrations/` in the same change that
-- runs it, run the probe above, and drop its row from this directory's README.
