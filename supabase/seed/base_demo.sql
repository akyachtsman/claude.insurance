-- Base demo seed (NOT a migration): the foundational rows the rest of the demo
-- depends on — the sample client Jordan Mercer's profile and his two base
-- entities (himself + Coastal Cafe LLC). Run this BEFORE
-- entity_relationships_demo.sql, which references entities 2222… and 2333….
--
-- PREREQUISITE: the demo auth user must exist first. profiles.id and
-- entities.owner both FK to auth.users(id), so create the Supabase Auth user
-- with id 11111111-1111-4111-8111-111111111111 (broker invite + password) before
-- running this. Asset/policy demo rows are seeded separately (see js/keep/data.js
-- for the sample shapes); this file covers only the profile + base entities.

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111','Jordan Mercer','client')
on conflict (id) do nothing;

insert into public.entities (id, owner, kind, name, label, subtype) values
  ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','personal','Jordan Mercer','You · personal',null),
  ('23333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','business','Coastal Cafe LLC','Business',null)
on conflict (id) do nothing;
