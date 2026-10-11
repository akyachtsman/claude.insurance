-- Base demo seed (NOT a migration): the foundational rows the rest of the demo
-- depends on — the sample client Jordan Mercer's profile and his two base
-- entities (himself + Coastal Cafe LLC). Run this BEFORE
-- entity_relationships_demo.sql, which references entities 2222… and 2333….
--
-- PREREQUISITE: the demo auth user must exist first. profiles.id and
-- entities.owner both FK to auth.users(id), so create the Supabase Auth user
-- with id 11111111-1111-4111-8111-111111111111 (broker invite + password) before
-- running this.
--
-- ⚠️ CREATE THAT USER THROUGH THE DASHBOARD OR THE ADMIN API — NEVER WITH A
-- HAND-WRITTEN `insert into auth.users`. GoTrue scans several of that table's
-- token columns (confirmation_token, recovery_token, email_change_token_new,
-- email_change) into non-nullable Go strings, so a row that leaves them NULL
-- cannot sign in: /auth/v1/token returns HTTP 500 "Database error querying
-- schema", a message that names the schema and says nothing about the row.
-- This is not hypothetical here — broker@example.com and underwriter@example.com
-- were created that way and could not sign in AT ALL until 2026-10-09, while
-- CLAUDE.md advertised both as working demo credentials. Repaired by
-- supabase/migrations/20261009210100_auth_users_null_token_columns.sql; the
-- repair is `coalesce(col, '')`, so it is idempotent if it happens again. Asset/policy demo rows are seeded separately (see
-- js/keep/fixtures/sample.mjs
-- for the sample shapes); this file covers only the profile + base entities.

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111','Jordan Mercer','client')
on conflict (id) do nothing;

insert into public.entities (id, owner, kind, name, label, subtype) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','personal','Jordan Mercer','You · personal',null),
  ('23333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','business','Coastal Cafe LLC','Business',null)
on conflict (id) do nothing;
