-- Help-desk query log: one row per answered question, and the state the
-- help-ask throttle counts.
--
-- Feature 003 (specs/003-help-desk/), task T4. Satisfies FR-16 ("the endpoint
-- is throttled per client") and carries the "Throttle, not trust" half of the
-- plan's Key decision 4.
--
-- WHY THE THROTTLE NEEDS STATE AT ALL. help-ask is a paid endpoint: every
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
-- ⚠️ WHY THE CLIENT HAS NO INSERT EITHER — CHANGED 2026-10-06, and the reasoning
-- matters because the first draft of this file granted `insert (question)` to
-- `authenticated` and argued carefully for the column scoping.
--
-- The grant was never needed: NOTHING in js/ writes this table. The only writer
-- is the help-ask Edge Function under the service-role key, which bypasses both
-- RLS and these grants. The grant existed because the table was designed as
-- "client-writable, carefully constrained" rather than "server-only".
--
-- What made it a defect rather than dead privilege is the function's AGGREGATE
-- daily cap, added the same day. The per-owner cap made a direct PostgREST
-- insert bounded self-harm — the rows counted against your own hour, so the
-- attack was to lock yourself out. The aggregate cap counts EVERYONE's rows, so
-- the same insert became a cheap global denial of service: one PostgREST call
-- with 401 rows, no provider cost, and the help desk is off for every client for
-- 24 hours. Two independent security reviews flagged it within a minute of the
-- cap being pushed.
--
-- Filtering the aggregate count on a server-only column would also work. Taking
-- the grant away is better: it removes the write surface instead of counting
-- around it, and leaves nothing for a later migration to re-widen by accident.
--
-- WHY GRANTS AT ALL, for the SELECT that remains. Supabase's auto-expose is off
-- in this project, so a table with flawless RLS and no GRANT returns 42501 on
-- every call: RLS narrows privileges, it never confers them. (Precedent for the
-- column form: 20260624171640_public_leads_and_rule_settings.sql grants anon
-- INSERT on a column list for exactly this reason;
-- 20260628083000_enhancement_requests_grants.sql is the table-level form.)
--
-- NOTE FOR T5 (supabase/functions/help-ask). `default auth.uid()` evaluates to
-- NULL under the service-role key and `owner` is NOT NULL, so the function's
-- insert MUST pass `owner` explicitly — the caller id resolved from the JWT, per
-- FR-14, never a value from the request body. With the client INSERT grant gone
-- this is the ONLY way a row is ever created, so the default is now decorative;
-- it is kept because dropping NOT NULL or the default would weaken the row shape
-- for no gain.
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

-- NO INSERT, NO UPDATE, NO DELETE for `authenticated` — see the header. The
-- client's privilege on this table is read-your-own-rows and nothing else, so
-- the throttle's history is not merely append-only to a client, it is untouchable
-- by one.
--
-- The writer is the service role. Supabase grants it table privileges in the
-- public schema by default (every other table here relies on that, and
-- notify-enhancement writes under the same key), but it is stated explicitly
-- rather than inherited: this is the only path that writes the table, and an
-- inherited privilege is one a platform default change can remove silently.
grant select, insert, delete on public.help_queries to service_role;
-- DELETE is for the function's own release paths — over the cap, or a count that
-- could not run — where nothing has been billed and the reservation must go back.

-- RLS is enabled above, so the table is default-deny; this is the only path out
-- of it for a client. It is scoped `to authenticated` — an unscoped policy
-- applies to every role, `anon` included, and the help desk sits behind the
-- Keep's auth gate (FR-1). There is deliberately no INSERT, UPDATE or DELETE
-- policy: with no matching grant either, that is both layers.
create policy "help_queries select own" on public.help_queries
  for select to authenticated using (owner = auth.uid());
-- NOTE: the SELECT policy is NOT load-bearing for the function's writes, though
-- an earlier version of this comment said it was. `insert ... returning` needs a
-- SELECT policy that admits the new row only when the inserter is subject to
-- RLS; the function inserts under the service-role key, which bypasses RLS for
-- the whole statement, RETURNING included. This policy exists purely so a client
-- can read its own history back.

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
-- failure-mode table, a missing help_queries makes help-ask fail closed with
-- {answer:null, reason:"unavailable"} and the help page renders its quiet
-- notice (FR-17). The inverse disables the help desk; it does not unmeter it.

-- POST-APPLY PROBE (run as a CLIENT session, not service-role — service-role
--   bypasses RLS *and* ignores column privileges, so every check below would
--   report a false pass. Steps 3 and 5 are destructive under service-role:
--   there they SUCCEED and wipe or rewrite the log. Assert on SQLSTATE, not on
--   message text.)
--
--   0. SEED a row to probe against. The client can no longer write this table,
--      so do this ONCE as service-role (or by asking a question through the
--      deployed function) before running steps 1-5 as a client:
--        insert into public.help_queries (owner, question)
--          values ('<the client uuid>', 'probe row');
--      then confirm the function's own shape held:
--        select owner is not null, asked_at is not null
--          from public.help_queries order by asked_at desc limit 1;   -- t, t
--
--   1. Client inserts — expect FAILURE, SQLSTATE 42501 insufficient_privilege
--      (there is no INSERT grant for `authenticated` at all):
--        insert into public.help_queries (question)
--          values ('How do I add a business entity?');
--      Via PostgREST the equivalent call is
--        supabase.from("help_queries").insert({ question: "..." })
--      ⚠️ THIS STEP IS INVERTED FROM THE FIRST DRAFT, where it expected SUCCESS.
--      A client insert that succeeds means the INSERT grant came back, and the
--      function's AGGREGATE daily cap counts every row in the table — so one
--      PostgREST call with DAILY_TOTAL_CAP+1 rows turns the help desk off for
--      every client for 24 hours, at no provider cost. Assert the failure.
--
--   2. Client forges an owner — expect FAILURE, 42501, for the same reason:
--        insert into public.help_queries (owner, question)
--          values ('00000000-0000-0000-0000-000000000000', 'forged');
--      Rejected before any policy is consulted, because the privilege is absent
--      rather than narrowed.
--
--   3. Client deletes — expect FAILURE, 42501 (no DELETE grant):
--        delete from public.help_queries;
--      THEN assert the step-0 row is still present:
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
--   5. Cross-owner read (needs a SECOND client session) — expect the step-0 row
--      to be invisible:
--        select count(*) from public.help_queries;   -- 0, or that session's own
--      rows only; never the row seeded in step 0.

-- ────────────────────────────────────────────────────────────────────────────
-- TWO FOLLOW-UPS this migration deliberately does NOT carry, recorded here so
-- they are decided rather than forgotten.
--
--   A. NO RETENTION. `question` stores the client's own free text indefinitely,
--      and a client may well type a name, an address or a claim detail into a
--      help box. The throttle needs only `owner` + `asked_at`; the text is kept
--      because a help desk that cannot be read back cannot be improved. Nothing
--      here expires it. A TTL needs pg_cron, which is a separate production
--      change; until one exists, treat this table as holding client PII and say
--      so in any processing record. Dropping `question` entirely is the cheaper
--      answer if nobody is actually going to read it.
--
--   B. ~~THE CLIENT INSERT GRANT~~ — RESOLVED, in this file, before it shipped.
--      This note used to say the grant was bounded self-harm and could not
--      simply be revoked. Both halves were wrong: the aggregate daily cap made
--      it a cheap global DoS, and the grant was never needed, because nothing in
--      js/ writes this table and the function writes as service_role. Revoked.
--      Kept here as a record of the reasoning, not as an open item.
