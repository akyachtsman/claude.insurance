-- Help-desk query log: one row per answered question, and the state the
-- desk-ask throttle counts.
--
-- Feature 003 (specs/003-help-desk/), task T4. Satisfies FR-16 ("the endpoint
-- is throttled per client") and carries the "Throttle, not trust" half of the
-- plan's Key decision 4.
--
-- WHY THE THROTTLE NEEDS STATE AT ALL. desk-ask is a paid endpoint: every
-- answered question spends provider tokens. This repo is public and CLAUDE.md
-- publishes the demo credential — the login screen prefills it — so the JWT
-- gate in front of the function establishes WHO is calling and nothing more. It
-- is authentication, never spend control. Counting calls per client per hour is
-- what bounds spend, and counting needs somewhere to count; that is this table,
-- and it is the honest cost of a paid endpoint on a public app. An Anthropic
-- Console workspace spend limit is the backstop that holds if the throttle
-- itself has a bug.
--
-- WHY THERE IS NO UPDATE AND NO DELETE — NEITHER GRANT NOR POLICY. The throttle
-- asks "how many rows does this owner have inside the last hour". A client that
-- could DELETE its own rows would reset its own quota at will; a client that
-- could UPDATE asked_at would move its rows out of the window. Either one turns
-- the throttle into a formality while leaving it looking enforced, which is
-- worse than not having it. So the client's write surface is append-only by
-- construction: no UPDATE/DELETE grant, and no UPDATE/DELETE policy either.
-- Both layers on purpose — a later migration that restates the grant
-- table-wide must not by itself make history erasable. Only the service-role
-- key, which bypasses RLS, can prune this table.
--
-- WHY COLUMN-LEVEL GRANTS. Supabase's auto-expose is off in this project, so a
-- table with flawless RLS and no GRANT returns 42501 on every call: RLS narrows
-- privileges, it never confers them. (Precedent for the column form:
-- 20260624171640_public_leads_and_rule_settings.sql grants anon INSERT on a
-- column list for exactly this reason; 20260628083000_enhancement_requests_grants.sql
-- is the table-level form.) Scoping the INSERT grant to (question) alone is what
-- keeps `owner` and `asked_at` on their defaults: a column the client holds no
-- INSERT privilege on cannot be named in the statement at all, so the browser
-- can neither forge the row's owner nor backdate it out of the throttle window.
-- The `with check (owner = auth.uid())` policy below independently blocks a
-- forged owner — two layers, same reason as above.
--
-- NOTE FOR T5 (supabase/functions/desk-ask). `default auth.uid()` evaluates to
-- NULL under the service-role key and `owner` is NOT NULL, so a service-role
-- insert MUST pass `owner` explicitly — the caller id resolved from the JWT, per
-- FR-14, never a value from the request body. Only a client-session insert gets
-- the owner for free from the default.
--
-- NOT APPLIED. CLAUDE.md requires explicit owner approval for migrations; this
-- file is the plan's T13 gate. Move it to supabase/migrations/ in the same
-- change that applies it, run the probe in this footer as a CLIENT session, and
-- drop its row from the README beside this file.

create table if not exists public.help_queries (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asked_at timestamptz not null default now(),
  question text not null,
  -- btrim, not char_length alone: '   ' is present and non-null but is not a
  -- question, and NOT NULL does not catch it. The non-blank test is on the
  -- TRIMMED text; the 500 cap is on the RAW text, so padding cannot be used to
  -- store more than 500 characters.
  constraint help_queries_question_shape
    check (char_length(btrim(question)) >= 1 and char_length(question) <= 500)
);

alter table public.help_queries enable row level security;

-- SELECT is granted on an explicit column list rather than table-wide. The
-- trade-off is deliberate and fails closed: a column added here later is not
-- readable until this grant names it (PostgREST's select=* would return 42501),
-- which is the safe direction for a table the client can read back.
grant select (id, owner, asked_at, question) on public.help_queries to authenticated;

-- INSERT is scoped to `question` and nothing else. `owner` and `asked_at` are
-- absent from this list by design — see the header. There is deliberately NO
-- update and NO delete grant: the throttle is only sound if a client cannot
-- delete or backdate its own history.
grant insert (question) on public.help_queries to authenticated;

-- RLS is enabled above, so the table is default-deny; these are the only two
-- paths out of it. Both are scoped `to authenticated` — an unscoped policy
-- applies to every role, `anon` included, and the help desk sits behind the
-- Keep's auth gate (FR-1). There is deliberately no UPDATE and no DELETE
-- policy, which is the second of the two append-only layers.
create policy "help_queries select own" on public.help_queries
  for select to authenticated using (owner = auth.uid());
create policy "help_queries insert own" on public.help_queries
  for insert to authenticated with check (owner = auth.uid());
-- The SELECT policy is load-bearing for writes too, not just reads: PostgREST
-- returns the inserted row by default, and `insert ... returning` under RLS
-- needs a SELECT policy that admits the new row. Dropping "help_queries select
-- own" as "the client never reads its history" would make every insert appear
-- to fail. The new row's owner is auth.uid(), so the policy admits it.

-- The throttle counts one owner's rows inside a time window, so (owner,
-- asked_at) is the access path and this index is not optional at the scale a
-- rate limiter runs at — it is read on every answered question. DESC matches
-- the most-recent-first direction the window scan reads in; for the window
-- predicate itself either direction serves.
create index if not exists help_queries_owner_asked_at_idx
  on public.help_queries (owner, asked_at desc);

-- INVERSE (reversible-by-design, per data.md):
--   drop table if exists public.help_queries cascade;
-- The two policies, the index and both grants are dependent objects and go with
-- it. Nothing pre-existing needs restoring, because this file creates a table
-- rather than altering one — which is why the inverse is a drop and not a
-- counter-grant.
-- DESTRUCTIVE: that also discards every recorded question, which is the
-- throttle's entire memory, so every client starts the following hour with a
-- fresh quota. It does NOT leave the feature half-working: per the plan's
-- failure-mode table, a missing help_queries makes desk-ask fail closed with
-- {answer:null, reason:"unavailable"} and the help page renders its quiet
-- notice (FR-17). The inverse disables the help desk; it does not unmeter it.

-- POST-APPLY PROBE (run as a CLIENT session, not service-role — service-role
--   bypasses RLS *and* ignores column privileges, so every check below would
--   report a false pass. Steps 3 and 5 are destructive under service-role:
--   there they SUCCEED and wipe or rewrite the log. Assert on SQLSTATE, not on
--   message text.)
--
--   1. Client inserts its own row — expect SUCCESS, 1 row:
--        insert into public.help_queries (question)
--          values ('How do I add a business entity?');
--      then confirm the defaults filled in the caller, not the client:
--        select owner = auth.uid() as owner_is_me, asked_at is not null
--          from public.help_queries order by asked_at desc limit 1;   -- t, t
--
--   2. Client forges the owner — expect FAILURE, SQLSTATE 42501
--      insufficient_privilege (the INSERT grant does not cover `owner`):
--        insert into public.help_queries (owner, question)
--          values ('00000000-0000-0000-0000-000000000000', 'forged');
--      Via PostgREST the equivalent call is
--        supabase.from("help_queries").insert({ owner: "<other uuid>", question: "forged" })
--      Both the column grant and "help_queries insert own" reject it; the grant
--      is what rejects it first.
--
--   3. Client deletes — expect FAILURE, 42501 (no DELETE grant):
--        delete from public.help_queries;
--      THEN assert the step-1 row is still present:
--        select count(*) from public.help_queries;   -- unchanged
--      That second assertion is the one that matters. If the DELETE grant were
--      ever restored, the absent DELETE policy would turn this into a 0-row
--      no-op that returns SUCCESS rather than an error — a probe checking only
--      "the call failed" would pass while the throttle history became erasable.
--
--   4. Client backdates — expect FAILURE, 42501 (no UPDATE grant):
--        update public.help_queries set asked_at = now() - interval '2 hours';
--      Same caveat as step 3: with a grant and no policy this becomes a silent
--      0-row no-op, so assert asked_at is unchanged, not merely that the call
--      errored.
--
--   5. Cross-owner read (needs a SECOND client session) — expect the step-1 row
--      to be invisible:
--        select count(*) from public.help_queries;   -- 0, or that session's own
--      rows only; never the row inserted in step 1.
