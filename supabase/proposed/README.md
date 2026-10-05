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
