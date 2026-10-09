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

update auth.users set
  confirmation_token     = coalesce(confirmation_token, ''),
  recovery_token         = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change           = coalesce(email_change, '')
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change is null;

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
