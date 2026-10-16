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
| **sent** | the `**Status:**` line names the upstream issue or PR |
| **landed** | the file is **deleted**, in the same change that records the adoption in CLAUDE.md |

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

## Not a substitute for sending it

Committing a note is storage, not delivery. Each one is still owed to
`claude.directives`, and this repository's sessions cannot open an issue there —
`global.md` → *Repository Scope* makes READ unrestricted for a public repo and
ACT hard-limited to this one. So the send is the owner's, or a session running
in that repository's own scope.
