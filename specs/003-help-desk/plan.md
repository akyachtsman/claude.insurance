# Feature 003 — Help desk: plan

Spec: `specs/003-help-desk/spec.md`. Stack unchanged — vanilla ES modules, no
build, Supabase + RLS, one Edge Function.

## Key decision 1 — a NEW `help-ask` function, not the retired `desk-ask` stub

**Revised 2026-10-06.** This decision originally read *"`desk-ask` becomes this
feature's endpoint"*: the repo carries a retired `desk-ask` Edge Function —
deployed, ACTIVE, JWT-verified, a 410 responder whose own comment says it "was
deployed by mistake into the wrong project and has been neutralized… Safe to
delete entirely" — and CLAUDE.md records deleting it as a pending owner decision.
Deploying 003 on top of it would have shipped the feature and removed the dead
endpoint in ONE owner action.

That trade was rejected. Overwriting a deployed name silently changes what that
name means, and between merge and deploy the repo would hold a `desk-ask` source
that does not match the `desk-ask` that is live — the exact "a stale record reads
as current" failure this repo has been bitten by three times in recent sessions
(the Playwright ceiling, the `.app-header h1` selector, the `js/format.js` line).
The cost of the clean split is one extra owner action; the cost of the collision
is a permanently ambiguous record.

So: the endpoint is **`help-ask`**, a new slug that also matches what the feature
is called everywhere else after the rename. `desk-ask` stays unambiguously
retired and its deletion stays a separate, closable owner item.

⚠️ **JWT verification stays ON at the gateway, revised twice.** This section
first said it "stays ON ... because this endpoint spends money per call" (right
answer, wrong reason), then said OFF because the flag "adds no protection" and
"can reject the CORS preflight". Both of those were false and both were testable:
`desk-ask` is deployed with `verify_jwt: true`, and probing it 2026-10-07 shows a
no-Authorization preflight reaching the function (so CORS is unaffected) while an
unauthenticated POST is refused by the gateway with no execution id (so the flag
does stop junk traffic becoming a billable invocation). `supabase/config.toml` therefore carries NO block for this function; the MCP deploy tool's default is already the right one.

## Key decision 2 — records are read server-side, never sent by the client

FR-14. The browser already holds the client's records under RLS, so sending them
with the question would be *simpler*. It is also the one shape that cannot be
made safe: the request body is client-controlled, so a crafted body is a request
to ground an answer on records the caller may not own.

Instead the function resolves the caller from their JWT and reads **that owner's
rows with the service-role key**, filtered by the resolved id. The client sends
only its question. This is the same reasoning as feature 002's IDOR finding,
applied before the bug rather than after.

## Key decision 3 — the refusal boundary: one independent layer, two mitigations

**Restated 2026-10-06, because the original claim was overstated** and a QA pass
was right to say so. It read "the refusal boundary lives in three places, not
one" and called them "three independent layers". Only one of the three is
independent, and the honest version is more useful than the flattering one:

1. **In the prompt** — the rules, with worked examples from the spec's table.
   Model-dependent by nature. A mitigation, not an enforcement point.
2. **In the grounding** — records are passed as *values*, never as a coverage
   summary the model is invited to interpret. **Not independent of 1:** it
   changes what the model is *handed*, not what it may *emit*, and the same
   single inference resolves both. It lowers the odds; it cannot catch a
   violation. Worth keeping, worth not overclaiming.
3. **In the UI** — the AI-generated label (FR-10) and the broker channel are
   rendered by the view on every answer, regardless of the payload. **This is
   the independent layer**, and the only one that still holds when the model
   ignores everything above it.

Layer 3 only became true of the broker channel on 2026-10-06. It had been
rendered off `brokerHandoff`, which traced back through `reason: "refused"` and
the trailer to **the model itself** — so the *remedy* for a refusal was
model-controlled end to end. Both error directions were reachable, and one was
worse than having no hand-off at all: a model that answered a coverage question
*and* set the marker put "this one needs your broker" underneath a coverage
determination, which reads as broker-endorsed. Measured. The channel is
unconditional now and the flag is deleted rather than left unread.

A-4 says none of these is sufficient alone. That remains true; what changed is
the count of layers that can actually enforce anything, which is one.

## Key decision 4 — model and cost

Per the `claude-api` skill: `claude-opus-5-5`, effort left at its `medium`
default, `max_tokens: 8192`, no streaming, `stop_reason` checked before reading
`content`, `text` blocks extracted by type. Thinking cannot be disabled on this
model and counts against `max_tokens`.

No prompt caching: the shared prefix is a few hundred tokens and the minimum
cacheable prefix is 512–4096, so a breakpoint would look like an optimisation
and do nothing.

**Throttle, not trust.** The repo is public and CLAUDE.md publishes the demo
credential, so the role of the JWT gate is authentication, never spend control.
A `help_queries` table records one row per answered question; the function
refuses past N per client per hour. This needs state, which is the honest cost
of a paid endpoint on a public app. An Anthropic Console workspace spend limit
is the backstop that holds if the throttle has a bug.

## Data shapes

`content/help-guide.json` — the corpus, one entry per screen/action:

```
{ "topics": [
  { "id": "add-entity", "title": "Add a business or trust",
    "route": "#/keep/add-entity", "nav": "Entities → Add",
    "body": "…what the screen does, in plain language…",
    "ask": "How do I add a business entity?" } ] }
```

`ask` seeds a suggestion chip (FR-2), so chips and corpus cannot drift.

`help_queries` (migration, written NOT applied — owner gate):

```
id uuid pk, owner uuid not null default auth.uid() -> auth.users on delete cascade,
asked_at timestamptz not null default now(), question text not null (btrim, <=500)
```

RLS enabled with **no policies and no client grants at all** (revised 2026-10-06 — this
line said `select own, insert own ... column-level grants`, which two review rounds removed:
the insert grant made the aggregate cap a global DoS, and the select policy fenced
nothing on a shared demo account). Service-role only;
index on `(owner, asked_at)` for the throttle window. No update, no delete.

## Tasks

`[P]` = parallel-safe once `depends:` are met.

**T1 — `content/help-guide.json`** [P] · depends: none
One topic per Keep screen, derived from `KEEP_LABELS` and the router's cases.

**T2 — `js/keep/logic/help.test.mjs`** [P] · depends: none
Written first. Validation bounds, chip derivation from the corpus, the
answer-shaping helpers, and that a corpus entry missing a field is rejected.

**T3 — `js/keep/logic/help.js`** · depends: T2
Pure: `validateQuestion`, `suggestionChips(guide)`, `answerShape(payload)`.
No DOM, no network.

**T4 — migration** [P] · depends: none
`supabase/proposed/20261006_help_queries.sql`, with inverse + client-session
probe, matching the two files already there.

**T5 — `supabase/functions/help-ask/index.ts`** · depends: T1
CORS, JWT caller resolution, throttle check, owner-scoped
record read, prompt build, Claude call, `{answer, usedTopics, usedRecords}`.
Every failure returns a shaped `{answer:null, reason}` — FR-17.

**T6 — `supabase/functions/help-ask/prompt.ts` + test** · depends: T1
Pure `buildPrompt(question, guide, records)`. The spec's refusal table goes in
verbatim as worked examples. Client text inside `<question>` delimiters.

**T7 — `askHelp()` in `js/supabase.js`** · depends: T3
`AbortController`, in-flight disable, every non-2xx mapped to the same
unavailable path.

**T8 — `js/keep/views/help-view.js`** · depends: T3, T7
Heading, chips, ask box, answer region, the FR-10 label rendered unconditionally.

**T9 — route + labels + menu** · depends: T8
`#/keep/help` in `dispatchKeep`, `KEEP_LABELS` entry, account-menu link.

**T10 — styles** · depends: T8 — `css/keep.css`, tokens only.

**T11 — manifest + docs** · depends: T9
`index.html` MODULES; CLAUDE.md architecture, routes, a `help-ask` entry beside
the `desk-ask` one (which stays, still retired), and Security Constraints: Anthropic as a new
sub-processor, the `ANTHROPIC_API_KEY` secret, the throttled endpoint.

**T12 — S10 scenario** · depends: T9 — a row in CLAUDE.md's scenario table.

**T13 — owner gate** · depends: T11 · **owner approval**
Apply T4's migration → set `ANTHROPIC_API_KEY` → deploy `help-ask` → merge →
verify. Merging first ships a help page against a table that does not exist.

**T14 — gates** · depends: T2, T10, T12 — all 11 Required Commands.

## Failure modes

| failure | behaviour |
|---|---|
| no `ANTHROPIC_API_KEY` | `{answer:null, reason:"unavailable"}`, page shows a quiet notice |
| Claude 4xx/5xx/timeout | same shape; explicit SDK `timeout` and `maxRetries`, since the defaults outlive the Edge wall clock |
| `stop_reason` not `end_turn` | no answer — covers `refusal` **and** `max_tokens` |
| throttle exceeded | `{answer:null, reason:"rate_limited"}` with the retry time |
| client has no records | answers from the guide; says "nothing on file yet" for record questions |
| question is a coverage determination | refused in-answer, with the broker hand-off (FR-8) |
| injection in the question | answered as quoted text; prompt rules unchanged (FR-13) |
| `help_queries` missing | function fails closed with `unavailable` — the feature needs T13 |
| query error vs empty | distinguished; an error renders an error state, not "nothing on file" |

## Known gap

The answer path cannot be exercised locally: it needs the deployed function and
a provider key. Substitutes are the unit tests (T2, T6), the structural grounds
(T4), and an owner-reviewed deployed screen after T13. The page's empty, chip
and unavailable states CAN be rendered locally and are covered by S10.
