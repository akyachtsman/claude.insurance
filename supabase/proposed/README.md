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
| `20261005_enhancement_request_stage_guard.sql` | Closes a real authorization hole (below). Needs owner approval + `apply_migration`. |
| `20261005_profiles_role_not_self_assignable.sql` | Closes a **live privilege escalation**: any signed-in client can set its own `profiles.role` to `broker`. Needs owner approval + `apply_migration`. |

## 20261005_enhancement_request_stage_guard.sql

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

## 20261005_profiles_role_not_self_assignable.sql

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
