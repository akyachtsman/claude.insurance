# Upstream findings — reports owed to `claude.directives`

`global.md` → *Downstream-Finding Loop* requires a finding made here, in a shared
template or mechanism, to be reported upstream rather than fixed only locally.
This directory is where such a report **lives until it is sent**.

## Why it is committed, and not in `.agent-reports/`

`.agent-reports/` is gitignored on purpose — it holds a session's transient
evidence. An upstream report is neither transient nor evidence: it is a
deliverable addressed to another repository's maintainer, and a session that
ends takes a gitignored file and its own scrollback with it. Two notes were
written on 2026-10-15 and had no durable home; the peer session they were
addressed to (`DIR9`) was not running when they were ready to send, and
`ListAgents` has no mailbox for an agent that does not exist.

So they are committed here, where any later session can read them over git or
`raw.githubusercontent.com` (both measured working from a session; general HTTPS
is not — see CLAUDE.md → *HTTPS EGRESS*).

⚠️ **This repository is PUBLIC** (measured 2026-10-15), and branch-source Pages
publishes the whole tree, so anything here is served at the live site as well as
on GitHub. A note must therefore carry no credential, no secret, no internal
hostname — only what a reader of the public upstream repository could already
see. Both current notes were checked against that before being committed.

## The lifecycle

| state | what it looks like |
|---|---|
| **written, not sent** | the file's `**Status:**` line says so, with where and when it was found |
| **sent** | the `**Status:**` line names where it went and what came back |
| **accepted, not shipped** | kept, with the `**Status:**` line saying the gap is still LIVE until the fix lands, and in what form it is expected |
| **landed** | the file is **deleted**, in the same change that records the adoption in CLAUDE.md |
| **declined** | the file is **deleted**, in the same change that records the refusal and its REASON in CLAUDE.md |

⚠️ **The last two states were not in the first version of this table, and first
contact produced both.** On 2026-10-16 one note came back *accepted but batched*
and the other *declined outright*, and the table had a slot for neither — it
assumed every report either waits or lands. A note that is accepted-but-unshipped
is the dangerous one: the gap is still live in every installed copy, so deleting
it on the strength of "they agreed" would lose the only local record of an open
defect.

Deleting on adoption is the point: a note that outlives its fix becomes a
report of a defect that no longer exists, which is the
comment-overclaims-code failure this repo keeps paying for. The upstream
history is the record once it is upstream's.

⚠️ **A note goes stale against the template it describes.** Both current notes
quote `claude.directives` source by blob and by variable name, and the
`pages-retry.yml` one had to be corrected once already when upstream moved from
`f680dd3` to `bde28c9` between the note being written and being published.
**Re-read the template before sending**, and say in the note which upstream head
the quotations were taken from.

## When a note moves, fix the pointers to it

Three places pointed at these notes under `.agent-reports/` and kept doing so
after they moved: `CLAUDE.md` twice and `.claude/directive-sync.json` once (its
`local_tree_note`, where the kit-dir finding is explained). Following any of them
landed on a path that is not in the tree, which defeats the discoverability this
directory exists for. Found by Codex on the very change that created it.

So: `grep -rn '<old path>' --include=*.md --include=*.json .` before calling a
move done, and read what each hit *claims* as well as where it points — two of
those three said the finding **"is reported upstream"**, of a note that had never
left the repository. *A note's existence is not its delivery*, which is the same
mistake as the section below, made by the pointers rather than by the reader.

⚠️ **AND THE SAME RULE APPLIES TO THE STATUS, WHICH THIS SECTION DID NOT SAY —
so it happened again one PR later.** On 2026-10-16 the notes' statuses moved to
SENT and **four** records kept asserting the old one: this file's closing section,
two places in `CLAUDE.md`, and `.claude/directive-sync.json`'s `local_tree_note`.
The paths were all correct; only the statuses were stale, so a path grep came back
clean. Codex #285 (P2) named the consequence: an owner or a later refresh
following any of them **resends an already-accepted report**.

So the check is two greps, not one:

```
grep -rn '<old path>'   --include=*.md --include=*.json .
grep -rniE 'not yet sent|still owed|unsent' --include=*.md --include=*.json .
```

**A status asserted in N places moves in N places.** The canonical note is one of
them, never all of them.

## The channel is a human relay, and that is measured

Reaching the upstream session is **not** a `SendMessage` away, and three attempts
failed before this was understood. Measured 2026-10-16 from `get_session`:

| what | value | consequence |
|---|---|---|
| `DIR9` | a session **title**, not a registered peer name | `SendMessage` resolves registered names; a title never resolves |
| `environment_kind` | `anthropic_cloud` | `ListAgents` reports only **this machine**, so it can never list it |
| `connection_status` | `disconnected` | Remote Control is not connected on this side |
| `send_message` | **absent from both sessions' toolsets** | `create_session`'s description references it; neither side has it |

So the owner pastes the report in and pastes the reply back. Write a relayed
message to survive that: say at the top that it is hand-relayed and that a reply
must come back the same way, or the far side spends a turn trying to answer
through a tool it does not have.

⚠️ **Do not re-diagnose this as a flaky registry.** That was the first conclusion
here, drawn from `ListAgents` naming this session three different things across
one conversation. The unstable self-name was real; it was **not** the cause, and
chasing it cost a turn. The cause is in the table above.

## Not a substitute for sending it

Committing a note is storage, not delivery, and this repository's sessions cannot
open an issue upstream — `global.md` → *Repository Scope* makes READ unrestricted
for a public repo and ACT hard-limited to this one. So the send is the owner's, or
a session running in that repository's own scope.

⚠️ **This section read "each one is still owed" after both had been sent and
answered.** A note's `**Status:**` line is the canonical record; this paragraph,
`CLAUDE.md` and `.claude/directive-sync.json` all also assert a status, and all
three were left behind. **When a status changes, grep for the old status, not only
for the old path** — see the section above, which had only ever been written about
paths.
