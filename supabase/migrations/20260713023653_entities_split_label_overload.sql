-- entities.label was overloaded — it carried a different meaning per kind
-- (business = industry, person = relationship role, trust = specific type). Split
-- each into a proper column so `subtype` consistently means "the specific type"
-- and businesses carry `industry` separately. Output-neutral: the app already
-- read the specific type from `subtype`. `label` is retired (null everywhere).
-- revert: no automatic inverse — label was a lossy overload of three distinct
-- meanings; once split into industry/subtype it cannot be re-merged unambiguously.
alter table public.entities add column if not exists industry text;

-- business: label held the industry ("Media", "Real estate") — skip generic
-- labels. Some legacy labels are composite "<legal type> · <industry>"
-- (e.g. "LLC · real estate"); when the leading token repeats the row's subtype
-- we keep only the industry part, so the header doesn't render "LLC · LLC · …".
update public.entities
set industry = btrim(
  case
    when position('·' in label) > 0
      and lower(btrim(split_part(label, '·', 1))) = lower(btrim(coalesce(subtype, '')))
    then substr(label, position('·' in label) + 1)
    else label
  end)
where kind = 'business'
  and label is not null
  and lower(btrim(label)) not in ('business', 'company', 'llc', '');

-- person: label held the relationship role ("Spouse", "Child") — promote to
-- subtype only where subtype was the generic placeholder.
update public.entities
set subtype = label
where kind = 'person'
  and label is not null
  and (subtype is null or lower(btrim(subtype)) in ('individual', ''));

-- trust: label held the specific trust type ("Revocable trust") — promote to
-- subtype only where subtype was the generic placeholder.
update public.entities
set subtype = label
where kind = 'trust'
  and label is not null
  and (subtype is null or lower(btrim(subtype)) in ('trust', ''));

-- retire label entirely.
update public.entities set label = null where label is not null;
