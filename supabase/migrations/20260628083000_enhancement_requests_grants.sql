-- Table-level privileges for the authenticated role (RLS still scopes rows:
-- clients insert/select their own; brokers select/update all). Without these
-- grants Postgres rejects access with "permission denied for table".
grant select, insert, update on public.enhancement_requests to authenticated;
