-- Normalize policies.premium (free text like "$2,260 / yr") into structured
-- numeric fields: premium_amount (numeric) + premium_period ('yr'|'mo').
-- annualPremium reads these; formatPremium renders the display string. The
-- legacy text column is dropped later (policies_drop_premium_text).
-- revert:
--   alter table public.policies
--     drop column if exists premium_amount,
--     drop column if exists premium_period;
alter table public.policies
  add column if not exists premium_amount numeric,
  add column if not exists premium_period text
    check (premium_period is null or premium_period in ('yr','mo'));

update public.policies
set premium_amount = nullif(regexp_replace(premium, '[^0-9.]', '', 'g'), '')::numeric,
    premium_period = case when premium ~* '/\s*mo|month' then 'mo' else 'yr' end
where premium is not null and premium_amount is null;
