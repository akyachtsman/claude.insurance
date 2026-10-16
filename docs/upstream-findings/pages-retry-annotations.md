# `claude.directives` — `pages-retry.yml`: make the two decision points annotations

**Status:** WRITTEN, NOT SENT. Raised from `claude.insurance` during
`/refresh-repo` to `f680dd3`, 2026-10-15; **re-measured against upstream `main`
2026-10-16** and still open.
**Upstream head the quotations are taken from:** `e78b6dd58796b4aa68056fb99e2416ed8f8d8f88`.
**File:** `templates/workflows/pages-retry.yml`.

## Context

`f680dd3` adopted this repo's obsolescence check into the template, and
`claude.insurance` took the template verbatim — so there is no local divergence
to defend here and the only thing left is this one suggestion.

Upstream's version is better than the local one it replaced in a respect we did
not have: the non-numeric guard

```bash
case "$counting" in ''|*[!0-9]*) return 1 ;; esac
```

where ours relied on `// 0` plus `${newest:-0}` and would have printed a bare
`[: integer expression expected` to the log on a malformed value. Both fail
open, so this was cleanliness rather than behaviour — but upstream's is the
right shape.

⚠️ **The variable is `$counting`, not `$newest`.** An earlier draft of this note
quoted `$newest`, which was the name in the local pre-adoption version; the
template counts across pages and sums with `awk`. Corrected before sending,
because a note quoting a name the file does not use reads as describing a
different file.

## The one thing the local copy had that the template does not

Both decision points emitted **workflow annotations** rather than plain `echo`s:

```bash
echo "::notice::Pages run ${RUN_ID} (commit ${SHA:0:7}) is superseded by a newer run — skipping the re-run so an older commit is not republished over a newer one."
...
echo "::warning::Could not determine whether run ${RUN_ID} is superseded; proceeding with the re-run."
```

Upstream's equivalent for the first is a plain `echo` inside the step's log
(line 170 at `e78b6dd`), and there is no equivalent for the second at all.

**Why it is worth taking.** Both lines are the workflow *declining to do its
job*, deliberately, on a run that then reports **success** — so there is nothing
red to draw anyone's eye. An annotation surfaces in the run summary and in the
Actions list without opening the job log; an `echo` is findable only by someone
who already suspects the retry did not happen.

The second matters more than the first: it is the **fail-open** path, where the
check could not run and the re-run went ahead anyway. A `::warning::` there
means a flaky API shows up as a pattern across runs instead of being invisible.
And that path has grown since the check was adopted — at `e78b6dd` the function
returns 1 on a failed `gh api --paginate`, on a non-numeric sum, **and** on the
`run_attempt < 4` filter coming back unreadable — so there are more ways to not
know than when the plain `echo` was written.

⚠️ **The precedent is in the same file, measured.** Line 183 at `e78b6dd`
already uses `::error::` for the give-up path, with a comment saying exactly why:

> this annotation is what tells a human the automation gave up rather than that
> it was never needed.

That reasoning applies verbatim to a stand-down and to a fail-open proceed. The
file already agrees with this note; it just stops one case short.

Cost is nil — same bash, same exit codes, no new API calls, and annotations do
not affect a run's conclusion.

## Why it is not kept locally

Keeping it would restart a divergence that took seven weeks to end, over log
formatting. `claude.insurance` took the template verbatim and is forwarding this
instead, so every project gets it rather than one.

## Suggested patch

In `templates/workflows/pages-retry.yml`, inside the retry loop:

```bash
            if superseded; then
              echo "::notice::Pages run ${RUN_ID} (commit ${SHA:0:7}) is superseded by a newer run — not re-running, so older content is not republished over newer."
              exit 0
            fi
```

and a `::warning::` on the branch that proceeds **without having been able to
check**.

⚠️ That second one is not a one-line change: `superseded()` returns 1 both for
"could not check" and for "not superseded", so the two are indistinguishable at
the call site. Distinguishing them needs either a separate return code (2, say,
with the call site reading it) or the warning emitted **inside** the function on
each of its `return 1` paths that is a read failure rather than a clean zero
count. The second is smaller and keeps `RUN_ID` in scope, since the function
already closes over it.
