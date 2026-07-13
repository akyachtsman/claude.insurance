-- Convert policies.documents from bare string arrays (["Declarations page", …])
-- to typed records ([{name, kind}, …]) so document rendering derives icon/label
-- from a canonical `kind` instead of re-classifying the display name per view.
-- Read through docName/docKind (js/keep/docfile.js), which accept either shape.
-- Idempotent: only rewrites arrays that still contain string elements.
-- revert: no automatic inverse — the {name,kind} objects cannot be losslessly
-- collapsed back to the original bare strings; docName/docKind read both shapes,
-- so a rollback of the reading code tolerates the typed form.
update public.policies p
set documents = (
  select jsonb_agg(
    case when jsonb_typeof(elem) = 'string' then
      jsonb_build_object(
        'name', elem,
        'kind', case lower(elem #>> '{}')
          when 'declarations page' then 'declarations'
          when 'full policy'       then 'policy'
          when 'id cards'          then 'id_cards'
          when 'endorsements'      then 'endorsement'
          when 'appraisals'        then 'appraisal'
          else 'other'
        end)
    else elem end
    order by ord)
  from jsonb_array_elements(p.documents) with ordinality as t(elem, ord)
)
where jsonb_typeof(p.documents) = 'array'
  and exists (
    select 1 from jsonb_array_elements(p.documents) e
    where jsonb_typeof(e) = 'string'
  );
