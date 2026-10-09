-- AMENDMENT to 20261005120000_enhancement_request_stage_guard.sql, applied the
-- same day (2026-10-09). That migration did NOT do what it said, and this is the
-- statement that makes it true. Kept as its own file rather than folded into the
-- original, because the mistake is worth being able to find.
--
-- ─── THE MISTAKE ──────────────────────────────────────────────────────────────
--
-- 20261005120000 put each staff role's predicate in `using` and the statuses it
-- may write in `with check`:
--
--   er_broker_update       using (role='broker')       with check (status in (broker set))
--   er_underwriter_update  using (role='underwriter')  with check (status in (uw set))
--
-- which reads as "a broker may write the broker statuses, an underwriter the
-- underwriter ones". It does not mean that. **PostgreSQL combines PERMISSIVE
-- policies with OR, and it does so for `using` and `with check` INDEPENDENTLY** —
-- it is not "some one policy must satisfy both". Both of these policies are
-- PERMISSIVE and `to public`, so both are applicable to any authenticated
-- caller. A broker therefore:
--
--   * passes `using` via er_broker_update  (it is a broker), and
--   * passes `with check` via ER_UNDERWRITER_UPDATE, whose check named only
--     statuses and NO role.
--
-- So a broker could still set `approved` — the single transition the whole
-- migration exists to prevent, and the one CLAUDE.md assigns to the underwriter.
--
-- MEASURED, not reasoned about. Reproduced in a throwaway PostgreSQL 16.13 with
-- the same two policy shapes and a stand-in for auth.uid():
--
--   AS WRITTEN:  set role authenticated; probe.uid='broker-id';
--                update er set status='approved';   -> SUCCEEDED, status='approved'
--   AFTER THIS:  same call                          -> ERROR: new row violates
--                                                      row-level security policy
--                broker -> 'underwriting'           -> OK
--                underwriter -> 'approved'          -> OK
--                underwriter -> 'requested'         -> DENIED (in neither set)
--
-- It was flagged by an automated security review of the commit that applied the
-- original, which is the only reason it was caught before the PR merged. The
-- probe in the original file's footer would NOT have caught it: it checked the
-- `with_check` column was no longer NULL, which it was.
--
-- ─── THE FIX ──────────────────────────────────────────────────────────────────
--
-- Repeat the role predicate inside each `with check`, so a policy's check can
-- only ever admit a row for the role that policy is about. The duplication is
-- load-bearing, not redundancy: deleting it from either clause reopens the hole.
--
-- The alternative — making the policies RESTRICTIVE — was not taken: restrictive
-- policies AND together, so `er_broker_update` and `er_underwriter_update` as
-- restrictive would require a caller to be BOTH roles at once and no staff
-- account could update anything.
--
-- ⚠️ ALTER POLICY, not DROP + CREATE: the Supabase MCP hangs 60s on any
-- statement containing a DROP (see the DROP note in CLAUDE.md's owner-gate
-- section).

alter policy "er_broker_update" on public.enhancement_requests
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'broker'))
  with check (status in ('broker_review', 'underwriting', 'declined')
              and exists (select 1 from public.profiles p
                          where p.id = auth.uid() and p.role = 'broker'));

alter policy "er_underwriter_update" on public.enhancement_requests
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'underwriter'))
  with check (status in ('approved', 'declined', 'underwriting')
              and exists (select 1 from public.profiles p
                          where p.id = auth.uid() and p.role = 'underwriter'));

-- STILL OPEN after this, and deliberately not fixed here:
--   * `with check` sees only the NEW row, so "approved only FROM underwriting"
--     is still unexpressed. That needs a BEFORE UPDATE trigger on
--     (old.status, new.status). An underwriter can still approve a request
--     sitting at `requested`.
--   * Neither policy constrains `owner`, `subject` or `body`, so a genuine staff
--     account can rewrite those columns, not only the status.
-- Both recorded in CLAUDE.md's security constraints.
--
-- POST-APPLY PROBE — run as a REAL BROKER session (service-role bypasses RLS and
-- reports a false pass). Assert on SQLSTATE 42501 / "new row violates
-- row-level security policy", not on message text:
--   as broker:      update enhancement_requests set status='approved'     -> DENY
--   as broker:      update enhancement_requests set status='underwriting' -> OK
--   as underwriter: update enhancement_requests set status='approved'     -> OK
-- ⚠️ The deny case is the one that must be asserted. A probe that only checks
-- `pg_policies.with_check IS NOT NULL` passes against the broken version.
--
-- INVERSE (reversible-by-design, per data.md) — restores the ineffective form,
-- i.e. the hole:
--   alter policy "er_broker_update" on public.enhancement_requests
--     using (exists (select 1 from public.profiles p
--                    where p.id = auth.uid() and p.role = 'broker'))
--     with check (status in ('broker_review', 'underwriting', 'declined'));
--   alter policy "er_underwriter_update" on public.enhancement_requests
--     using (exists (select 1 from public.profiles p
--                    where p.id = auth.uid() and p.role = 'underwriter'))
--     with check (status in ('approved', 'declined', 'underwriting'));
-- Non-destructive: no row is read, written or deleted.
