-- held: the coverage ids an asset already carries, used by the needs/gap analysis
-- (js/keep/analysis.js) to mark recommended coverages as in-place vs gap. jsonb
-- array of coverage-id strings (e.g. ["dwelling","home-liability","flood"]).
alter table public.assets
  add column if not exists held jsonb not null default '[]'::jsonb;
