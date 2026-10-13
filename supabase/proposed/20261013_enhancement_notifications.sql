-- enhancement_notifications — the notification dedup claim, moved OFF the client
-- row and into a table the caller cannot touch.
--
-- ⚠️ WRITTEN, NOT APPLIED. Applying it is an owner decision (it creates a table
-- and grants on it). The code in supabase/functions/notify-enhancement/index.ts
-- calls it, so until this is applied that function FAILS CLOSED: the claim
-- errors, the branch returns `claim_failed`, and nothing is sent. No regression,
-- because the deployed function 404s on every call today. `privilege.test.mjs`
-- enforces the coupling: this file must stay listed in proposed/README.md as
-- blocking the deploy for as long as it is unapplied.
--
-- ── WHY THIS EXISTS: FOUR ROUNDS ON ONE MECHANISM ───────────────────────────
-- The notification claim lived in two columns on `enhancement_requests`
-- (`requested_notified_at`, `approved_notified_at`), written by two SECURITY
-- DEFINER functions. Codex found a bypass in four consecutive rounds on PR #256:
--
--   round 3  staff reset the stamp to null              -> unbounded resend
--   round 4  write-once trigger leaves the FIRST write open -> forged pre-claim
--   round 5  the INSERT path — create the row pre-stamped
--   round 6  the grantee calls the RPC DIRECTLY — no function, no email
--
-- Each fix was right for its round and the mechanism kept failing, which per
-- global.md -> *Review Rounds Have to Terminate* is a redesign, not a fifth
-- guard. Every one of those four bypasses has the same root: the claim lived on
-- a row the client can write, so each fix could only narrow HOW they write it.
--
-- This removes the root. `authenticated` holds NOTHING here — no select, no
-- insert, no update, no delete — and there are no policies, so the table is
-- closed to every role that does not bypass RLS. The client has no write path at
-- all, so there is no round 7 of that mechanism to find.
--
-- It is the `help_queries` model, which this repo already chose when the same
-- question was asked about help-ask's spend. See
-- migrations/20261006120000_help_queries.sql.
create table if not exists public.enhancement_notifications (
  request_id uuid        not null references public.enhancement_requests(id) on delete cascade,
  event      text        not null check (event in ('requested', 'approved')),
  claimed_at timestamptz not null default now(),

  -- ⚠️ THE PRIMARY KEY IS THE WHOLE CONCURRENCY DESIGN, not bookkeeping.
  -- `insert ... on conflict do nothing returning claimed_at` is atomic: a second
  -- simultaneous invocation blocks on this unique index, then returns ZERO rows.
  -- One claim, one refusal, never two emails — the same guarantee the old
  -- `update ... where <stamp> is null` gave under a row lock, with no predicate
  -- to get wrong.
  primary key (request_id, event)
);

-- NOTHING IS STORED BEYOND THE CLAIM. No owner, no subject, no message, no
-- recipient address. The join key is a request id that never leaves the
-- function, and the whole row is "this (request, event) pair has been claimed,
-- at this time". A dedup log should not become a second copy of the client's
-- request text — the help_queries file records what it cost to learn that.

alter table public.enhancement_notifications enable row level security;

-- ⚠️ `authenticated` AND `anon` HOLD NOTHING, AND THAT IS THE POINT OF THE FILE.
-- Postgres grants nothing to them by default here, but this REVOKE is explicit
-- so a later migration restating grants schema-wide cannot quietly reopen it —
-- the same two-layer reasoning (absent grants AND absent policies) that
-- 20261006120000_help_queries.sql uses, and the same hazard
-- 20261013013743 ran into on enhancement_requests.
revoke all on public.enhancement_notifications from anon, authenticated;

-- ⚠️ LOAD-BEARING, NOT TIDINESS. `service_role` HAS NO TABLE PRIVILEGES IN THIS
-- PROJECT — measured 2026-10-06 and again 2026-10-09: has_table_privilege is
-- false for SELECT/INSERT/UPDATE on every table in the schema, the sole
-- exception being help_queries, and only because its migration granted them
-- explicitly. BYPASSRLS skips POLICIES, not PRIVILEGES. Without the line below
-- the function's first claim returns 42501 and notify-enhancement refuses every
-- caller, permanently — which is precisely how that function spent its entire
-- deployed life before PR #256.
--
-- SELECT and INSERT only. No DELETE, deliberately: the design keeps a claim once
-- taken, including when the provider is configured but erroring. Releasing on
-- failure needs an un-claim, and an un-claim is exactly the unbounded re-send
-- this table exists to prevent. The residual (claimed, nothing delivered) is
-- logged by the handler as `where: "requested_send"` / `"approved_send"`; a real
-- retry mechanism is the product answer, not a weaker claim.
grant select, insert on public.enhancement_notifications to service_role;

-- NO POLICIES AT ALL. RLS is enabled above, so with none defined the table is
-- closed to every role that does not bypass RLS — the service role and nothing
-- else.

comment on table public.enhancement_notifications is
  'Server-only notification dedup for notify-enhancement. One row per (request_id, event) claimed before any email is sent. authenticated/anon hold nothing; service_role holds select+insert by explicit grant. Replaces the requested_notified_at/approved_notified_at claim, which lived on a client-writable row and was bypassed in four consecutive review rounds (PR #256).';

-- ── THE OLD CLAIM PATH IS CLOSED IN THE SAME CHANGE ─────────────────────────
-- Nothing calls these two functions once the handler moves to the table above,
-- and leaving them executable by `authenticated` would leave round 6's bypass
-- open for no reason: the grantee can call them directly, populate a stamp with
-- no email sent, and a reader who still trusts those columns is misled.
--
-- REVOKE rather than DROP, for a measured reason: the Supabase MCP hangs 60s on
-- any DROP from this environment and applies nothing (CLAUDE.md records it), so
-- a DROP here could only be run by hand in the dashboard. REVOKE reaches the
-- same end state for the thing that matters — nobody but the table owner can
-- execute them — and leaves the definitions readable as history.
revoke execute on function public.stamp_requested_notified(uuid) from authenticated;
revoke execute on function public.stamp_approved_notified(uuid)  from authenticated;

-- ⚠️ THE TWO STAMP COLUMNS STAY, AND STOP MEANING ANYTHING.
-- `requested_notified_at` and `approved_notified_at` keep their write-once
-- trigger and their narrowed column grants from 20261013013743/20261013014854,
-- so nothing regresses — but after this change NOTHING WRITES THEM. They are
-- vestigial. They are deliberately not dropped here: dropping a column is a
-- bigger migration (the trigger references both), it is irreversible, and it is
-- not needed to close the finding. Whether to drop them is a separate owner
-- decision, recorded in CLAUDE.md rather than smuggled into this file.

-- ── POST-APPLY PROBE — RUN THESE AFTER APPLYING ─────────────────────────────
-- ⚠️ As a REAL CLIENT SESSION, not as postgres, and not by calling the thing
-- under test the way this repo's last probe did. (The probe in
-- migrations/20261013005250 called the stamp function as the owner and was read
-- as proof the fix worked — it was in fact the exploit.)
--
-- 1. The client cannot touch the table at all. Expect 42501 on each:
--      select * from public.enhancement_notifications;
--      insert into public.enhancement_notifications (request_id, event)
--        values ('<their own request id>', 'requested');
--
-- 2. The old bypass is closed. Expect 42501:
--      select public.stamp_requested_notified('<their own request id>');
--
-- 3. service_role CAN claim (run as the function does, with the service key):
--      insert into public.enhancement_notifications (request_id, event)
--        values ('<a request id>', 'requested')
--        on conflict do nothing returning claimed_at;    -- 1 row
--      -- the same statement again                        -- 0 rows
--
-- ⚠️ Wrap any probe that WRITES in `begin; ... rollback;`. The Supabase MCP
-- hangs 60s on a DELETE and applies nothing, so an insert-then-delete probe
-- leaves a row nobody can remove from a session — measured twice on 2026-10-13,
-- and it cost the owner two manual statements in the dashboard.
--
-- ── INVERSE (reversible-by-design, per data.md) ─────────────────────────────
--   grant execute on function public.stamp_requested_notified(uuid) to authenticated;
--   grant execute on function public.stamp_approved_notified(uuid)  to authenticated;
--   drop table public.enhancement_notifications;
-- Restores the previous claim path, i.e. reopens round 6's bypass. The DROP
-- must be run in the dashboard: it will hang through the MCP.
