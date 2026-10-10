-- Enforce the enhancement-request lifecycle in the DATABASE, not just the UI.
--
-- Lifecycle: requested -> broker_review -> underwriting -> approved | declined.
-- CLAUDE.md assigns underwriting -> approved/declined to the UNDERWRITER; the
-- broker advances a request only as far as underwriting.
--
-- The previous policies gated on role with no `with check` and no status
-- predicate, so either staff role could set any request to any status from any
-- status — including resurrecting a declined request as approved, where the
-- notify function reads the row BEFORE updating, so the client's email still
-- reads "final approval" and never mentions the decline.
--
-- APPLIED 2026-10-09, version 20261005120000. Verified after the fact:
--   select policyname, with_check from pg_policies
--    where tablename='enhancement_requests' and cmd='UPDATE';
--   er_broker_update       (status = ANY (ARRAY['broker_review','underwriting','declined']))
--   er_underwriter_update  (status = ANY (ARRAY['approved','declined','underwriting']))
-- Both read NULL before this ran.
--
-- ⚠️ ALTER POLICY, NOT DROP + CREATE — and the difference is environmental, not
-- stylistic. Written as `drop policy if exists` + `create policy`, this file
-- could not be applied from a Claude Code web session at all: the Supabase MCP
-- hangs for 60s on any statement containing a DROP and applies nothing, while
-- CREATE and ALTER return instantly. Postgres is not the bottleneck — a `set
-- local lock_timeout` never fires, and `pg_stat_activity` shows nothing waiting
-- on a lock — so the gate is in the MCP layer. `ALTER POLICY` expresses the same
-- end state (it can set `with check` where there was none) without a destructive
-- verb, and it is also the safer statement: there is no window in which the
-- table has no policy for that role. Recorded in CLAUDE.md under the backend
-- section.
--
-- NOTE on the remaining gap: `with check` constrains the NEW row only, so it
-- cannot by itself express "approved is reachable only FROM underwriting" —
-- Postgres row policies do not see the old row for an UPDATE's check. Closing
-- that fully needs a BEFORE UPDATE trigger validating (old.status, new.status)
-- against the allowed transition set. Still outstanding; the trigger is the
-- stricter follow-up, and it is NOT what this file does.
--
-- ALSO STILL OPEN, and deliberately not touched here: neither update policy has
-- a `with check` on `owner`, `subject` or `body`, so a staff account can still
-- rewrite those columns, not just the status. Recorded in CLAUDE.md's security
-- constraints.

-- A broker may move a request forward through review, or decline it, but may
-- never approve: requested -> broker_review -> underwriting, or -> declined.
alter policy "er_broker_update" on public.enhancement_requests
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'broker'))
  with check (status in ('broker_review', 'underwriting', 'declined'));

-- An underwriter owns the final decision, and only from underwriting.
alter policy "er_underwriter_update" on public.enhancement_requests
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'underwriter'))
  with check (status in ('approved', 'declined', 'underwriting'));

-- INVERSE (reversible-by-design, per data.md) — restores the pre-apply state,
-- which is the hole. `with check (true)` is how you say "no constraint on the
-- new row" without a DROP:
--   alter policy "er_broker_update" on public.enhancement_requests
--     using (exists (select 1 from public.profiles p
--                    where p.id = auth.uid() and p.role = 'broker'))
--     with check (true);
--   alter policy "er_underwriter_update" on public.enhancement_requests
--     using (exists (select 1 from public.profiles p
--                    where p.id = auth.uid() and p.role = 'underwriter'))
--     with check (true);
-- ⚠️ NOT identical to the original, which had with_check = NULL rather than
-- `true`. The two behave the same (Postgres falls back to the USING clause when
-- there is no check, and `true` admits every row), but `pg_policies` will read
-- `true` instead of NULL. Dropping and re-creating is the only way back to a
-- literal NULL, and a DROP cannot be issued through the MCP — see above.
-- Non-destructive either way: no row is read, written or deleted.
