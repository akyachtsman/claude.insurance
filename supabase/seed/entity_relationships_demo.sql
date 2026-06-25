-- Demo seed (NOT a migration): related-party entities and relationships for the
-- sample client Jordan Mercer, mirroring REL_NODES / REL_EDGES in js/views/keep.js.
-- Run manually against the project; fixed UUIDs keep it idempotent.
-- Depends on the base demo rows: profile 1111… (Jordan), entity 2222… (you,
-- personal) and entity 2333… (Coastal Cafe LLC, business).

-- Related-party entities owned by Jordan (1111…).
insert into public.entities (id, owner, kind, name, label, subtype) values
  ('24444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','person','Alex Mercer','Spouse','Individual'),
  ('25555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','trust','Children''s Trust','Irrevocable trust','Trust'),
  ('26666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','trust','Family Trust','Revocable trust','Trust'),
  ('27777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','business','Mercer Holdings','LLC · real estate','LLC')
on conflict (id) do nothing;

-- Relationships: from_entity holds/controls to_entity.
-- me=2222…, cafe=2333…, alex=2444…, childtrust=2555…, famtrust=2666…, holdings=2777…
insert into public.entity_relationships (owner, from_entity, to_entity, role, stake) values
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','23333333-3333-4333-8333-333333333333','Managing member','50%'),
  ('11111111-1111-4111-8111-111111111111','24444444-4444-4444-8444-444444444444','23333333-3333-4333-8333-333333333333','Member','40%'),
  ('11111111-1111-4111-8111-111111111111','25555555-5555-4555-8555-555555555555','23333333-3333-4333-8333-333333333333','Holds','10%'),
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','25555555-5555-4555-8555-555555555555','Trustee',null),
  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','26666666-6666-4666-8666-666666666666','Trustee',null),
  ('11111111-1111-4111-8111-111111111111','26666666-6666-4666-8666-666666666666','27777777-7777-4777-8777-777777777777','Owns','100%');
