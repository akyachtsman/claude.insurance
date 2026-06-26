-- Demo seed (NOT a migration): per-asset held coverage lists for the sample
-- client, mirroring js/keep/data.js. Run after the asset rows exist. Matched by
-- asset name (demo data has unique names per the sample set).

update public.assets set held = '["dwelling","home-liability","home-contents","flood"]'::jsonb where name = '123 Marina Way';
update public.assets set held = '["auto-liability","auto-physical"]'::jsonb where name = '2023 Tesla Model Y';
update public.assets set held = '[]'::jsonb where name = 'Sea Breeze 28''';
update public.assets set held = '["valuables-floater"]'::jsonb where name = 'Jewelry & valuables';
update public.assets set held = '["general-liability"]'::jsonb where name = '312 Harbor Dr (leased)';
update public.assets set held = '["commercial-auto"]'::jsonb where name = 'Delivery van';

-- Entity display meta line.
update public.entities set meta = 'EIN ••–•••4821 · Food service' where name = 'Coastal Cafe LLC';
