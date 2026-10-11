# supabase/proposed/ — written, NOT applied

`supabase/migrations/` mirrors the schema that is **actually provisioned** (its
versions match `list_migrations`). Anything in this directory is a migration that
has been **written but deliberately not applied**, because CLAUDE.md requires
explicit owner approval for migrations:

> Destructive commands, data resets, migrations, or deploys require explicit approval.

Keeping them here rather than in `migrations/` preserves that invariant — a file
in `migrations/` should always mean "this is live". Move a file across only in the
same change that applies it.

| file | why it is waiting |
|---|---|
| `20261006_profiles_no_client_insert.sql` | **Its security effect is already LIVE** — the `revoke insert` was applied 2026-10-09 as step 2 of `migrations/20261005120100_profiles_role_not_self_assignable.sql`, and verified as a client session (42501). What is left is its `drop policy` line alone: redundant (the policy is now narrower *and* dormant) and unrunnable through the Supabase MCP, which hangs on any DROP. A one-statement tidy-up for the Dashboard SQL editor, not a gate. |

## ~~20261005_enhancement_request_stage_guard.sql~~ — APPLIED 2026-10-09

**Now `migrations/20261005120000_enhancement_request_stage_guard.sql`.** The
background below is kept because it is the only write-up of the hole; what the
file now contains differs from what is described here in one way — it uses
`ALTER POLICY` rather than `DROP` + `CREATE`, because the Supabase MCP hangs on
any DROP. Same end state, verified in `pg_policies`. The BEFORE UPDATE trigger
this section calls the stricter follow-up is still outstanding, and so is the
missing `with check` on `owner`/`subject`/`body`.


Found by `/audit-repo` on 2026-10-05.

**The hole.** The documented request lifecycle is
`requested → broker_review → underwriting → approved` (+ `declined`), and
CLAUDE.md assigns the `underwriting → approved` decision to the **underwriter**.
That ordering is enforced **only in the UI**. The status flip itself is a direct
RLS-guarded `UPDATE` from the browser — `js/supabase.js` → `advanceRequest`,
whose own comment notes it "works regardless of the Edge Function's state", so
the Edge Function is not the authority for it.

Both update policies gate on role alone:

```sql
create policy "er_broker_update" on public.enhancement_requests
  for update using (exists (select 1 from public.profiles p
                            where p.id = auth.uid() and p.role = 'broker'));
-- er_underwriter_update: identical, role = 'underwriter'
```

There is no `with check` and no status predicate. So **any broker or underwriter
can set any request to any status from any status**:

- approve a request still at `requested`, skipping broker review and underwriting
- flip a **declined** request back to `approved` — and because the notify
  function reads the row *before* updating, the client's email still reads
  "final approval" and never mentions the decline
- a broker can make the approval decision CLAUDE.md assigns to the underwriter

**What the migration does.** Adds `with check` transition predicates so each role
may only make the moves it owns. The `using` clause stays as-is (it governs which
rows are visible to update); `with check` governs the resulting row.

**Already fixed in this repo, without a migration:** the Edge Function
(`supabase/functions/notify-enhancement/index.ts`) now rejects `approved` unless
the row is at `underwriting` and the caller is the underwriter or service-role.
That closes the function path. It does **not** close the direct-update path,
which is the one the UI actually uses — only this migration does.

**To apply:** review, then move to `supabase/migrations/` in the same change that
runs it, and drop its row from the table above.

## ~~20261005_profiles_role_not_self_assignable.sql~~ — APPLIED 2026-10-09

**Now `migrations/20261005120100_profiles_role_not_self_assignable.sql`.** The
live privilege escalation described below is CLOSED: `authenticated` now holds
`UPDATE` on `reminder_email, reminder_schedule` only, and no `INSERT` at all.
Verified as a real client session (not service-role): `role='broker'` returns
42501, the Account page's own write still returns 204.


Found while reviewing the feature-002 plan on 2026-10-05, and **verified against
the live database** rather than inferred from these files.

**The hole.** `authenticated` holds table-level `UPDATE` on `public.profiles` —
every column, `role` included — and the only RLS policy on it is
`using (id = auth.uid()) with check (id = auth.uid())`. Neither clause mentions
`role`, and there is no trigger. So this one PostgREST call succeeds:

```js
await supabase.from("profiles").update({ role: "broker" }).eq("id", uid);
```

It is reachable from the browser with the client demo credential, which CLAUDE.md
publishes and the login screen prefills.

**Blast radius — real, and narrower than it first looks.** The only role-keyed
policies in the whole schema are the four on `enhancement_requests`. Every other
table (`entities`, `assets`, `policies`, `entity_relationships`) keys on
`owner = auth.uid()` with no role escape, so a self-promoted broker does **not**
gain access to any other client's cover. What it does gain:

- `SELECT` on every client's enhancement requests — free-text subject and body.
- `UPDATE` on them, and `er_broker_update` has no `with check`, so `owner`,
  `subject` and `body` can be rewritten too, not just `status`.

This is **pre-existing and live today** — independent of PR #251 and of
feature 002. Both would merely be built on top of it.

**Why a column grant, not a policy.** RLS evaluates whole rows: `with check`
sees only the NEW row and cannot compare it against the OLD one, so no policy can
express "this column may not change". Column-level privileges are the only
mechanism that does, short of a trigger. (The same OLD-row blindness is why the
stage guard above needs its own `with check` transition predicates.)

**Scope check.** `js/supabase.js` is the only client writer: one `update` of
`{reminder_email, reminder_schedule}` (line 312) and one `select` (line 100).
There is no client-side `INSERT` in `js/` and no trigger creates the row, so the
revoke removes capability the app never used.

**To apply:** review, then move to `supabase/migrations/` in the same change that
runs it, run the post-apply probe in the file's footer **as a client session**
(service-role bypasses RLS and would report a false pass), and drop its row from
the table above.

## 20261006_profiles_no_client_insert.sql

Revokes `insert` on `public.profiles` from `authenticated` and drops the
`profiles insert own` policy.

**Why.** `help-ask` refuses a caller with no `profiles` row, so that the Help
desk's per-client spend cap is a per-INVITED-client cap — public sign-up is ON
(`disable_signup: false`, measured 2026-10-06), so accounts are freely creatable
and a per-account cap bounds nothing.

⚠️ **That check does not hold until this is applied, and the first version of it
claimed otherwise.** `authenticated` holds INSERT on `profiles` with a
`with check (id = auth.uid())` policy, so `supabase.from("profiles").insert({ id: uid })`
creates the very row the check looks for. Gating on a row the client can write is
not a gate. Found by an automated security review of the commit that added it.

**Why revoking is safe, verified not assumed:** nothing in `js/` inserts a
profile (the only writes are a SELECT in `loadTree()` and `savePrefs()`'s UPDATE
of two preference columns), and `pg_trigger` has no non-internal trigger on
`auth.users` or `profiles` — this project has no `handle_new_user`, so a row
appears only from an explicit insert. With such a trigger, revoking the client
grant would have closed nothing.

Distinct from `20261005_profiles_role_not_self_assignable.sql`: that one is
privilege escalation on an existing row, this one is account creation. Either
can be applied without the other.

## ~~20261006_help_queries.sql~~ — APPLIED 2026-10-09

**Now `migrations/20261006120000_help_queries.sql`** — feature 003 owner-gate
step 1. Applied verbatim; it contains no DROP, so unlike the two above it
needed no rewrite. Client probes 1-5 all return 42501.


Written 2026-10-06 as task **T4** of the approved feature-003 plan
(`specs/003-help-desk/plan.md`). Unlike the two files above, this one closes no
hole — it creates a table a feature needs. It waits here for the same reason
they do: CLAUDE.md requires explicit owner approval for migrations.

**What it is.** One row per answered help-desk question
(`id`, `owner`, `asked_at` — **no `question`**; the text column was dropped before
this was applied because nothing read it), plus the RLS, the service-role grant and the index
around it. It is the state the `help-ask` throttle counts, satisfying **FR-16**
("the endpoint is throttled per client").

**Why the throttle needs state at all** (the plan's Key decision 4). `help-ask`
is a paid endpoint — every answered question spends provider tokens. This repo
is public and CLAUDE.md publishes the demo credential, which the login screen
prefills, so the JWT gate in front of the function establishes *who* is calling
and nothing more: it is authentication, never spend control. Counting calls per
client per hour is the only thing that bounds spend, and counting needs
somewhere to count. An Anthropic Console workspace spend limit is the backstop
if the throttle itself has a bug.

**Why there is no UPDATE and no DELETE — neither grant nor policy.** The
throttle asks "how many rows does this owner have inside the last hour". A
client that could `DELETE` its own rows would reset its own quota at will; a
client that could `UPDATE` `asked_at` would move its rows out of the window.
Either one leaves the throttle looking enforced while being a formality, which
is worse than not having it. So the client's write surface is append-only by
construction — no `UPDATE`/`DELETE` grant *and* no `UPDATE`/`DELETE` policy, so
a later migration restating the grant table-wide does not by itself make the
history erasable. Only the service-role key, which bypasses RLS, can prune it.

**Why there are no client grants.** Supabase's auto-expose is off in this
project, so a table with flawless RLS and no `GRANT` returns 42501 on every
call — RLS narrows privileges, it never confers them. (Column-form precedent:
`20260624171640_public_leads_and_rule_settings.sql` grants `anon` INSERT on a
column list for exactly this reason.) `authenticated` ends up holding
**nothing at all** on this table, and there are no policies either:

```sql
grant select, insert, delete on public.help_queries to service_role;
```

⚠️ **The client INSERT grant was removed on 2026-10-06, before this file ever
shipped.** The first draft granted `insert (question)` to `authenticated` and
argued carefully for the column scoping. The grant was never needed — nothing in
`js/` writes this table, and the only writer is the `help-ask` Edge Function
under the service-role key, which bypasses RLS -- **but not grants.** ⚠️ This
said "RLS and grants alike", which is false: BYPASSRLS skips policies, not
privileges, and this project's `service_role` holds no default table privileges,
which is exactly why the migration's explicit `grant ... to service_role` is
load-bearing rather than tidiness. The same file said both things.

What turned dead privilege into a defect was the function's **aggregate** daily
cap, added the same day. Under the per-owner cap, a direct PostgREST insert was
bounded self-harm: the rows counted against your own hour, so the attack was to
lock yourself out. The aggregate cap counts *everyone's* rows — so the same call
became a cheap global denial of service: one insert of `DAILY_TOTAL_CAP + 1`
rows, no provider cost, and the help desk is off for every client for 24 hours.
Two independent security reviews flagged it within a minute of that cap being
pushed. Filtering the count on a server-only column would also work; removing the
write surface is better than counting around it.

⚠️ **The client SELECT grant went one round later**, and for a reason neither of
the two facts behind it shows alone: this migration's own note says `question`
holds whatever the client typed, "a name, an address or a claim detail"; and
CLAUDE.md publishes ONE demo credential that the login screen prefills. Together,
every visitor using that demo is the SAME `owner`, so `using (owner = auth.uid())`
fenced nothing — each could read every question the others had typed. The policy
looked like row-level isolation and provided none on a shared account. Both facts
were already written down in this repo; nothing had joined them.

So there are **no policies at all**. RLS is on with none defined, which closes the
table to every role that does not bypass RLS — the service role and nothing else.
The absent grants and the absent policies are the two layers.

**One consequence for T5.** `default auth.uid()` evaluates to NULL under the
service-role key and `owner` is `not null`, so the function's insert must pass
`owner` explicitly — the caller id resolved from the JWT per **FR-14**, never a
value from the request body. Only a client-session insert gets the owner for
free from the default.

**To apply:** review, then move to `supabase/migrations/` in the same change
that runs it, run the post-apply probe in the file's footer **as a client
session** (service-role bypasses RLS — though NOT privileges — so every
check would report a false pass — and the probe's delete and update steps are
destructive under service-role, where they succeed), and drop its row from the
table above. This is the migration half of the plan's **T13** owner gate;
merging the feature without it ships a help page against a table that does not
exist.
