-- Expand the request lifecycle into stages the client can track:
-- requested (submitted) → broker_review → underwriting → approved, plus declined.
alter table public.enhancement_requests drop constraint if exists enhancement_requests_status_check;
alter table public.enhancement_requests add constraint enhancement_requests_status_check
  check (status in ('requested','broker_review','underwriting','approved','declined'));
