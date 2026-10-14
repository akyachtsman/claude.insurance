-- help_settings — the Help desk's model tier as an ADMIN-CONTROLLED ROW, so a
-- broker can change it from the product instead of the Supabase dashboard.
--
-- WHY THIS EXISTS, given the secret already works. `HELP_MODEL` (handler.ts's
-- allow-list header) lets the tier move with no redeploy and no PR, and that is
-- the right escape hatch for the OWNER. It is the wrong control for a BROKER: it
-- needs project credentials, it is invisible from the Keep, and nothing in the
-- product can show what it is currently set to. The owner asked for the switch to
-- live where they work — "controlled by admin".
--
-- SHAPE: one row, forever. `id boolean primary key default true check (id)` is
-- the singleton idiom — a second row can only be inserted as `id = false`, which
-- the CHECK refuses — so "there is exactly one setting" is a schema fact rather
-- than a convention. Nothing holds INSERT at all (below), so the row seeded here
-- is the only row that will ever exist; the CHECK is belt for a future grant.
--
-- ⚠️ THE VALUE IS CONSTRAINED IN THE DATABASE, NOT ONLY IN THE FUNCTION, and
-- both layers are deliberate. `resolveModel` must keep allow-listing because a
-- function cannot assume a column constraint it does not own; the CHECK here
-- means a broker writing through PostgREST by hand cannot store a value the UI
-- never offered. The reason for two layers is FR-17: an unknown model id reaches
-- Anthropic, comes back 400, and the client sees the same quiet "not available"
-- notice as an outage, a missing key and an undeployed function. A setting that
-- can break the desk in a way indistinguishable from everything else is this
-- repo's most repeated defect, not a hypothetical.
--
-- ⚠️ THE ALLOWED VALUES EXIST IN THREE PLACES — this CHECK, `HELP_MODELS` in
-- `supabase/functions/help-ask/handler.ts`, and `HELP_MODEL_CHOICES` in
-- `js/keep/logic/help-model.js`. That is exactly the drift this repo has been
-- bitten by, so `js/keep/logic/help-model.test.mjs` parses all three sources and
-- asserts SET EQUALITY. Adding a tier means editing three files and the test
-- tells you which one you forgot.

create table if not exists public.help_settings (
  -- Singleton key. `check (id)` is what makes a second row impossible.
  id          boolean primary key default true check (id),
  model       text not null default 'claude-opus-5-5'
                check (model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')),
  -- Stamped by the trigger below, never by the writer — see the grant.
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- ── WHO MAY DO WHAT ───────────────────────────────────────────────────────────
--
-- ⚠️ REVOKE FIRST, THEN GRANT EXACTLY WHAT IS NEEDED. Measured in this project
-- (CLAUDE.md, the `_mcp_write_probe` note): a new public table picks up the
-- standard Supabase role grants, and reasoning about what those are instead of
-- stating the end state is how a table ends up readable by `anon` because nobody
-- checked. The end state is written here so it can be read off the file.
--
-- ⚠️ `service_role` IS IN THIS REVOKE, and it was not in the first version. The
-- line below used to say "SELECT only. Nothing server-side writes this row" —
-- and when the end state was MEASURED after apply, `service_role` still held
-- REFERENCES, TRIGGER and TRUNCATE from the project default. Nothing uses them,
-- but TRUNCATE on the settings row is a write: emptying this table makes the
-- function fall back to the secret, silently moving where the tier comes from.
-- Revoked so the sentence below is true rather than nearly true, which is the
-- comment-overclaims-code defect CLAUDE.md records half a dozen times.
revoke all on public.help_settings from anon, authenticated, service_role;

-- A broker reads the current tier to render the control, and writes `model`.
-- NOTHING ELSE IS GRANTED, and the enumeration is the point:
--   * UPDATE is COLUMN-SCOPED to `model`. CLAUDE.md's rule — "a column is only
--     as protected as its weakest write path" — cost this repo a finding on
--     2026-10-13 when `enhancement_requests` had UPDATE narrowed and INSERT left
--     table-wide. So: `updated_at` and `updated_by` are unwritable by any
--     browser caller, which is the only thing that makes them worth stamping.
--   * NO INSERT. The seeded row below is the only row, and a client cannot
--     pre-create one. This is the INSERT half of that same lesson, closed in the
--     same statement rather than a day later.
--   * NO DELETE. Removing the row would make the function fall back to the
--     secret, silently changing where the tier comes from.
grant select on public.help_settings to authenticated;
grant update (model) on public.help_settings to authenticated;

-- ⚠️ SERVICE_ROLE IS GRANTED EXPLICITLY, AND THAT IS LOAD-BEARING. CLAUDE.md
-- records, measured: `service_role` holds NO table privileges in this project —
-- `BYPASSRLS` skips POLICIES, not PRIVILEGES — so a service-role read of a table
-- it was not granted returns 42501. `help_queries` is the precedent and its own
-- grant is load-bearing for the same reason. `help-ask` reads this row through
-- its existing `admin` client, so without this line the function would read the
-- tier as a denial and silently fall back to the secret — FR-17 again: the
-- broker's switch would appear to work and do nothing.
--
-- SELECT only, and MEASURED to be only that after apply: `anon` holds nothing,
-- `service_role` holds SELECT, `authenticated` holds SELECT plus UPDATE on
-- `model` alone. Nothing server-side writes this row; the broker's UI does.
-- Re-granted after the revoke above.
grant select on public.help_settings to service_role;

alter table public.help_settings enable row level security;

-- ── POLICIES ──────────────────────────────────────────────────────────────────
--
-- Read AND write are broker-only. The tier is a spend decision, so a client has
-- no business reading which one they are getting, and the UNDERWRITER is
-- deliberately excluded too: that role owns the underwriting -> approved/declined
-- decision and nothing about the help desk's cost.
--
-- ⚠️ THE ROLE PREDICATE IS REPEATED IN BOTH `using` AND `with check`, and
-- deleting it from either reopens a hole. CLAUDE.md records this as a HIGH
-- finding from 2026-10-09: PERMISSIVE policies OR their `using` and their
-- `with check` INDEPENDENTLY, so a caller can pass `using` via one policy and
-- `with check` via another. There is only one UPDATE policy on this table today,
-- which makes the duplication look redundant — it is not: the moment a second
-- UPDATE policy is added, a `with check` naming no role is satisfiable by
-- whoever that other policy admits.
create policy "hs_broker_select" on public.help_settings
  for select using (exists (select 1 from public.profiles p
                            where p.id = auth.uid() and p.role = 'broker'));
create policy "hs_broker_update" on public.help_settings
  for update using (exists (select 1 from public.profiles p
                            where p.id = auth.uid() and p.role = 'broker'))
         with check (exists (select 1 from public.profiles p
                             where p.id = auth.uid() and p.role = 'broker'));

-- ── THE STAMPS ────────────────────────────────────────────────────────────────
--
-- Set here rather than by the writer, because the writer is not trusted with
-- them: `grant update (model)` is what makes "who changed the tier, and when"
-- answerable at all. SECURITY INVOKER (the default) on purpose — it needs no
-- privileges the caller lacks, and CLAUDE.md round 27 records that an INVOKER
-- trigger is not an escalation path, which is why the deploy header's definer
-- sweep correctly ignores it.
--
-- `search_path` is pinned empty so every name in the body is schema-qualified and
-- cannot be resolved against a caller-controlled schema.
create or replace function public.stamp_help_settings()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- The singleton key is not writable by any grantee, but a future grant must
  -- not be able to fork the row either.
  new.id := old.id;
  return new;
end;
$fn$;

create trigger help_settings_stamp
  before update on public.help_settings
  for each row execute function public.stamp_help_settings();

-- The one row. `on conflict do nothing` so re-running this file is a no-op
-- rather than an error, and so it never overwrites a tier a broker has set.
insert into public.help_settings (id) values (true) on conflict (id) do nothing;

comment on table public.help_settings is
  'Singleton: the Help desk model tier, broker-readable and broker-writable. '
  'Read server-side by help-ask through service_role, which holds select by '
  'explicit grant (service_role has no table privileges by default in this '
  'project). authenticated holds select and update(model) only — no insert, no '
  'delete, and the stamps are set by a trigger.';

-- ── POST-APPLY PROBE — RUN, AND THE RESULTS RECORDED ─────────────────────────
--
-- ⚠️ IT ASSERTS THE DENIALS, NOT THE PRESENCE OF A CLAUSE. CLAUDE.md records a
-- probe on an earlier migration that checked `pg_policies.with_check IS NOT
-- NULL` and therefore passed against the broken version it was written to prove.
--
-- HTTPS egress to the project is blocked from a session, so there is no real
-- PostgREST request to be had. The substitute is `set local role authenticated`
-- + `request.jwt.claims`, which CLAUDE.md records as MEASURED to enforce RLS and
-- column privileges, and every write probe is wrapped in `begin; … rollback;`,
-- also measured as honoured. Nothing below was committed.
--
-- ⚠️ THE UIDS WERE CHECKED AGAINST THEIR EMAILS FIRST, not assumed. CLAUDE.md
-- records a probe that read a correct RLS result as a bypass because it called
-- the seeded BROKER's id "a foreign uid". Measured here:
--   client 11111111-1111-4111-8111-111111111111  user@example.com
--   broker 22222222-2222-4222-8222-222222222222  broker@example.com
--   undrwr 33333333-3333-4333-8333-333333333333  underwriter@example.com
--
-- Run 2026-10-14, all seven as stated:
--
--   | # | as          | statement                                   | EXPECT   | GOT      |
--   |---|-------------|---------------------------------------------|----------|----------|
--   | 1 | client      | select count(*)                             | 0 rows   | 0        |
--   | 2 | broker      | select count(*)                             | 1 row    | 1        |
--   | 3 | underwriter | select count(*)                             | 0 rows   | 0        |
--   | 4 | broker      | update … set model = 'claude-haiku-5-5'     | allowed  | allowed, updated_by = broker uid, updated_at moved |
--   | 5 | broker      | update … set updated_by = null              | 42501    | 42501    |
--   | 6 | broker      | update … set model = 'claude-3-opus'        | 23514    | 23514    |
--   | 7 | broker      | insert … (id, model) values (false, …)      | 42501    | 42501    |
--   | 8 | client      | update … set model = 'claude-haiku-5-5'     | 0 rows   | 0        |
--
-- Probe 3 is the one that proves the exclusion is deliberate rather than
-- incidental: an underwriter is a signed-in staff account with a `profiles` row
-- and sees nothing here.
--
-- ⚠️ PROBE 8 IS 0 ROWS, NOT AN ERROR, and a reader must not take a 204 from
-- PostgREST as a write. RLS makes an UPDATE whose `using` matches no row a
-- silent no-op. Read the row count.
--
-- ⚠️ AND A PROBE-HARNESS FINDING WORTH MORE THAN THE PROBES: a TOP-LEVEL
-- `UPDATE` WITH NO `WHERE` CLAUSE HANGS THE SUPABASE MCP for 60s and applies
-- nothing — the same signature CLAUDE.md records for `DROP` and for `DELETE`.
-- Measured as a pair, one trial each, on the identical statement:
--     update public.help_settings set updated_by = null;          -> 60s timeout
--     update public.help_settings set updated_by = null where id; -> instant 42501
-- So add a `where` to every probe UPDATE. Probe 4 ran as a CTE
-- (`with upd as (update … returning …)`) and also returned instantly, which is
-- the other way past it. A timed-out probe is indistinguishable from a probe
-- whose denial never fired, which is why this is here and not in a scratch note.
--
-- The exact statements, for re-running:
--   begin; set local role authenticated;
--   set local "request.jwt.claims" = '{"sub":"<uid>","role":"authenticated"}';
--   <the statement above>;
--   rollback;
