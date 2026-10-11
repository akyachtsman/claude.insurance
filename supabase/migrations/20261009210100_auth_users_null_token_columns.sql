-- Repair the demo staff accounts: broker@example.com and underwriter@example.com
-- COULD NOT SIGN IN AT ALL, and had not been able to since they were created.
--
-- Found 2026-10-09 while trying to probe the enhancement-request RLS fix as a
-- real broker. `POST /auth/v1/token?grant_type=password` returned:
--
--   HTTP 500  {"code":500,"error_code":"unexpected_failure",
--              "msg":"Database error querying schema"}
--
-- for broker@ and underwriter@, while user@example.com signed in normally. The
-- cause is in the rows, not in the request:
--
--   email                    confirmation_token  recovery_token  email_change_token_new  email_change
--   user@example.com         ''                  ''              ''                      ''
--   broker@example.com       NULL                NULL            NULL                    NULL
--   underwriter@example.com  NULL                NULL            NULL                    NULL
--
-- GoTrue scans those columns into non-nullable Go strings, so a NULL fails the
-- scan and surfaces as "Database error querying schema" — a message that names
-- the schema and says nothing about the row, which is why this was never
-- diagnosed from the symptom. It is the well-known consequence of creating auth
-- users with a hand-written INSERT instead of the Admin API or the dashboard;
-- `user@` was created one way and the two staff accounts the other.
--
-- ⚠️ NOT CAUSED BY THE MIGRATIONS APPLIED BESIDE THIS ONE, and that was checked
-- before writing this file rather than assumed: those touch
-- `public.profiles` grants, `public.enhancement_requests` policies and a new
-- `public.help_queries` table, and nothing in the `auth` schema. The NULL-vs-''
-- difference is per-row and can only have been set when each row was inserted.
--
-- WHAT IT MEANT IN PRACTICE. CLAUDE.md advertises `broker` / `keep-demo-2026`
-- and `underwriter` / `keep-demo-2026` as working demo logins — the first in the
-- ui-tester's own UI Test Configuration table, which is agent input. So the
-- broker and underwriter views of the Keep, and the whole
-- requested -> broker_review -> underwriting -> approved lifecycle, have never
-- been exercisable by anyone. No test covered it: S9 signs in as the CLIENT, and
-- the offline S11-S13 harness fakes its own sessions.

-- ⚠️ READ THE "WHAT THIS RE-ENABLES" NOTE BELOW BEFORE RE-RUNNING THIS. Repairing
-- a staff login is not a neutral act on a project whose staff passwords this
-- repo publishes.
--
-- ⚠️ THE `id in (...)` LIST IS DELIBERATE, and it is the one difference between
-- this file and the statement that actually ran on 2026-10-09. The applied
-- statement had the NULL predicate alone. Its EFFECT was identical — measured
-- before it ran, exactly two rows had any of these columns NULL, and both are in
-- the list below — but an unscoped `where ... is null` would silently repair the
-- login of ANY future hand-seeded account, including one created by mistake or by
-- someone else. A migration that re-enables accounts it was never told about is
-- the wrong shape for this. `supabase_migrations.schema_migrations` still records
-- the unscoped statement, because that is what ran; this file is what to re-run.
update auth.users set
  confirmation_token     = coalesce(confirmation_token, ''),
  recovery_token         = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change           = coalesce(email_change, '')
where id in (
        '11111111-1111-4111-8111-111111111111',  -- user@example.com        (client)
        '22222222-2222-4222-8222-222222222222',  -- broker@example.com      (broker)
        '33333333-3333-4333-8333-333333333333'   -- underwriter@example.com (underwriter)
      )
  and (confirmation_token is null
    or recovery_token is null
    or email_change_token_new is null
    or email_change is null);

-- ─── WHAT THIS RE-ENABLES, and why it is a constraint and not just a fix ──────
--
-- Flagged by an automated security review of the commit that applied it, and the
-- finding is correct: this repair made two STAFF logins work whose passwords this
-- public repo publishes (`broker` / `keep-demo-2026`, `underwriter` /
-- `keep-demo-2026`, both in CLAUDE.md's UI Test Configuration table).
--
-- A staff role is not the same exposure as the demo client credential, which is
-- also published and prefilled on the login screen. The client one reaches that
-- client's own rows and nothing else — `entities`, `assets`, `policies` and
-- `entity_relationships` all key on `owner = auth.uid()` with no role escape. The
-- staff ones reach `enhancement_requests` for EVERY client: `er_broker_select` /
-- `er_underwriter_select` grant the read, and the update policies the write
-- (constrained to a status set as of 20261009210000, but still unconstrained on
-- `owner`, `subject` and `body`). CLAUDE.md names that as "a privileged read path
-- in the static app", and this file is what makes it reachable with a password
-- anyone can read.
--
-- ACCEPTED TODAY, on a precondition that is measured and not assumed:
-- `auth.users` holds exactly three rows, all `@example.com` demo accounts, and
-- `enhancement_requests` holds one row owned by the demo client. There is no real
-- client data in this project to expose. The demo is the point of these accounts
-- — the broker and underwriter VIEWS, and the
-- requested -> broker_review -> underwriting -> approved lifecycle, are
-- unexercisable without them, and they had never once been exercised.
--
-- ⚠️ THAT PRECONDITION EXPIRES THE MOMENT A REAL CLIENT IS INVITED. Before the
-- first one, either rotate the broker/underwriter passwords to values kept out of
-- the repo (and move CLAUDE.md's table to a secret, as `readCredentialFromClaude`
-- and `TEST_AUTH_PASSWORD` already allow for), or move the demo accounts to a
-- separate project. This belongs in the invite runbook beside provisioning the
-- `profiles` row, and it is recorded there.
-- NOT done here because it is a credential decision on the owner's own project,
-- and because rotating silently would break the demo logins this repo documents
-- and the ui-tester consumes.

-- Only those four were NULL here. The other token columns GoTrue scans the same
-- way — email_change_token_current, phone_change, phone_change_token,
-- reauthentication_token — were already '' on all three rows, measured before
-- this ran. Add them to the predicate if a future hand-seeded user leaves them
-- NULL; `coalesce` makes the statement idempotent either way.
--
-- POST-APPLY PROBE: sign in as each of the three demo accounts against
-- /auth/v1/token?grant_type=password and assert an `access_token` comes back.
-- Measured after this ran: all three return HTTP 200 with a token.
--
-- PREVENTION, not just repair: `supabase/seed/base_demo.sql`'s prerequisite note
-- now says to create auth users through the dashboard or the Admin API, and why.
--
-- INVERSE (reversible-by-design, per data.md): there is no useful one, and that
-- is deliberate. Restoring the NULLs would restore a broken login. The change is
-- '' for NULL on four columns whose empty value is what GoTrue writes itself.
-- DESTRUCTIVE only in the sense that the previous (invalid) values are not
-- recoverable; they carried no information.
