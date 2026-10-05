# Plan — Ask the desk (feature 002)

**Phase 2 of `/sdd-loop`. HOW.** Reads `spec.md`; introduces no scope the spec
did not ask for. Constitution is the imported directives (`global.md`, `git.md`,
`design.md`, `data.md`, `test.md`) plus this repo's CLAUDE.md.

Line references are against `claude/ask-the-desk` (cut from `main`). They differ
from `claude/ins5-41cvx0`, which carries the audit fixes.

---

## Stack

No change, and no new runtime dependency on the client.

| Layer | Choice | Why |
|---|---|---|
| Client | Plain HTML + vanilla ES modules, no build | `global.md` default; the whole app is this |
| Data | Supabase Postgres + RLS | Existing; `data.md` requires RLS on every table |
| Server | One Supabase Edge Function (Deno) at the existing `desk-ask` slug | Already deployed, `verify_jwt: true`, correct for a client-authenticated endpoint |
| Draft generation | Anthropic Messages API, `claude-opus-5-5` | See *Model choice* |
| Styles | `css/keep.css`, `k-` prefix, tokens from `css/tokens.css` | Existing portal contract |

## Key decision 1 — a new table, not a `kind` column on `enhancement_requests`

The spec requires this be justified against extending (`global.md` → *Reuse
Before Rewrite*). I looked, and **extending is the worse option here.** Four
concrete reasons, not aesthetics:

1. **Two disjoint state machines in one column.** `status` is
   `check (status in ('requested','broker_review','underwriting','approved','declined'))`.
   Questions need `asked`/`answered`. Widening that constraint makes one column
   carry two unrelated lifecycles, and every reader has to know which kind it is
   holding before the value means anything.
2. **It breaks an existing RLS guarantee.** `er_insert_own` is
   `with check (owner = auth.uid() and status = 'requested')` — that literal is
   what stops a client self-approving on insert. A question inserting as
   `asked` forces that predicate to be relaxed, weakening a policy that
   currently protects enhancement requests. Touching it to add an unrelated
   feature is the wrong trade.
3. **Questions need columns enhancements don't.** `answer`, `answered_at`,
   `answered_by`. On a shared table those are nullable-for-half-the-rows, which
   is exactly the shape that makes "is this answered?" ambiguous.
4. **Every existing read silently changes meaning.** `loadEnhancementRequests`
   (`js/supabase.js:398`) selects the table wholesale; without a `kind` filter it
   would start returning questions into the enhancement UI the moment the
   migration lands.

Reuse happens where it is actually cheap and safe — the **presentation and
logic layers**, listed under *Reuse inventory*. A separate table also keeps the
blast radius off a table whose RLS has a known open issue (the unapplied
`supabase/proposed/20261005_enhancement_request_stage_guard.sql`).

**Cost of this choice, stated:** one more table and some structural similarity
to `enhancement_requests`. Accepted.

## Key decision 2 — model, effort, and caching

Loaded the `claude-api` skill before deciding, as the spec required.

- **Model: `claude-opus-5-5`.** The skill is explicit that this is the default
  and that downgrading for cost is the owner's call, not mine. `claude-sonnet-5-5`
  ($2/$10 per MTok) and `claude-haiku-4-5` ($1/$5) are the cheaper options if you
  want one — say so and it is a one-constant change.
- **`output_config: {effort: "low"}`.** Effort is the cost lever on this model,
  and its default is `medium` (not `high`), so it must be set explicitly. A
  short grounded answer is simple work; `low` is the documented fit.
- **Thinking: omitted.** On `claude-opus-5-5` thinking cannot be disabled —
  `{type: "disabled"}` and `budget_tokens` both return 400 at every effort level.
  Omitting the parameter runs adaptive, which is correct.
- **No streaming, `max_tokens: 2048`.** The answer is a paragraph or two. Not
  lowballed to the point of mid-sentence truncation, nowhere near the timeout
  range that forces streaming.
- **Prompt caching: NO.** The minimum cacheable prefix is 512–4096 tokens and
  **shorter prefixes silently do not cache**. Our system prompt is a few hundred
  tokens, so a `cache_control` breakpoint would look like an optimisation and do
  nothing. Revisit only if the grounding payload grows past the floor.
- **`fallbacks: "default"` + beta `server-side-fallback-2026-07-01`.** This model
  can decline with `stop_reason: "refusal"` at HTTP 200. The skill says include
  server-side fallbacks by default on it. Either way **`stop_reason` is checked
  before reading `content`** — a refusal must surface as "no draft available",
  never as an empty answer box.

## Key decision 3 — the draft never touches the client's trust boundary

FR-12 and SC-3 are the sharp requirements here, so the mechanism is structural
rather than procedural:

- The draft is returned **in the Edge Function's HTTP response to the broker**
  and is **never written to the questions table**. Nothing a client can SELECT
  can ever contain a draft, which is what makes SC-3 checkable by inspection
  rather than by trusting UI code.
- The `answer` column is written only by the broker's explicit send.
- Consequence, accepted: a draft is lost if the broker reloads before sending.
  That is the right trade for a guarantee that cannot be misconfigured. If
  persisting drafts is wanted later it needs a broker-only column and its own
  RLS proof.

## Reuse inventory

| Reused | From | How |
|---|---|---|
| Length validation + messages | `js/keep/logic/requests.js` `SUBJECT_MAX`/`MESSAGE_MAX` | `validateQuestion` reuses the constants; own copy wording |
| Status pill presentation | `statusDisplay` pattern in `requests.js` | A 2-entry `QUESTION_STATUS` map of the same shape |
| Form + list layout | `policies-view.js` request form and list | Same markup idiom, `k-` classes |
| Email shell | `supabase/functions/notify-enhancement/index.ts` `shell()`/`esc()`/`sendEmail()` | Copied into `desk-ask`; a shared module across functions is out of scope |
| Command palette | `js/keep/logic/search.js` `KEEP_ACTIONS` | One new entry |
| Origin-aware back | `backLink`/`originHref` in `shell.js` | Required by CLAUDE.md's standard |
| Empty-state copy | `js/keep/views/shell.js:568` | Becomes a link |

**Not reused, deliberately:** `REQUEST_STAGES`, `stageInfo`, `requestStepper`,
`isPending`. They encode a 4-stage enhancement pipeline. A 2-state question has
no stepper; bending them would be reuse in name only.

## Data shapes

```
desk_questions
  id           uuid pk default gen_random_uuid()
  owner        uuid not null default auth.uid() -> auth.users on delete cascade
  policy_id    uuid null -> policies  on delete set null
  asset_id     uuid null -> assets    on delete set null
  entity_id    uuid null -> entities  on delete set null
  context      text null  (<= 300)        -- human label of the bound record
  subject      text not null (1..200)
  body         text not null (1..4000)
  status       text not null default 'asked' check (status in ('asked','answered'))
  answer       text null (1..4000)
  answered_at  timestamptz null
  answered_by  uuid null -> auth.users
  created_at   timestamptz not null default now()
  answered_notified_at timestamptz null
  check (status = 'asked' or answer is not null)   -- answered implies an answer
  check (num_nonnulls(policy_id, asset_id, entity_id) <= 1)  -- at most one binding
```

Two table-level CHECKs carry invariants the UI must not be trusted with: an
`answered` row always has an answer, and a question binds to at most one record
(FR-2 says *exactly one* optional binding).

**RLS, default-deny:**

| Policy | Role | Rule |
|---|---|---|
| `dq_select_own` | client | `select using (owner = auth.uid())` |
| `dq_insert_own` | client | `insert with check (owner = auth.uid() and status = 'asked' and answer is null)` |
| `dq_broker_select` | broker | `select using (profiles.role = 'broker')` |
| `dq_broker_answer` | broker | `update using (role='broker') with check (status = 'answered' and answer is not null)` |

**No client UPDATE policy at all** — that is what makes FR-7 and SC-5 true by
construction rather than by UI discipline. The broker's `with check` means a
broker update can only ever land the row in `answered` with an answer present.

## Data flow

**Asking**
1. Client opens `#/keep/ask` (free-standing) or `#/keep/ask/:kind/:id` (bound).
2. `validateQuestion` runs client-side for the inline error (FR-4).
3. `addQuestion()` inserts via the authenticated Supabase client under
   `dq_insert_own`. `owner` defaults to `auth.uid()` — never sent from the browser.
4. Best-effort `POST desk-ask {event:"asked", questionId}` emails the broker.
   A failure here is logged and does not fail the ask (the row is already saved).

**Drafting (broker only)**
1. Broker clicks *Suggest an answer* — an explicit action, never on load (FR-15).
2. `POST desk-ask {event:"draft", questionId}` with the broker's JWT.
3. Function verifies the caller's `profiles.role = 'broker'`, loads the question
   and a **trimmed** grounding payload via service-role, calls Claude, returns
   `{draft}` in the response body. Nothing is written.
4. The broker edits freely and sends, or discards.

**Answering**
1. `answerQuestion(id, text)` — a direct RLS-guarded UPDATE under
   `dq_broker_answer`, matching how `advanceRequest` already works.
2. Best-effort `POST desk-ask {event:"answered", questionId}` emails the client,
   stamping `answered_notified_at` **only when a send actually succeeded** —
   the lesson from `notify-enhancement`, where an unconditional stamp recorded
   "we tried" and made the column useless.

**Grounding payload (the concrete form of FR-20):** subject, body, the bound
record's type and name if any, and for the client's policies only
`line`, `carrier`, `coverages[].label/limit`, `renewalInDays`. **Never** the
client's name, email, address, document contents, or premium figures. The
service-role key stays in the function; no credential reaches the browser.

## Failure modes

| Failure | Behaviour | Why that is right |
|---|---|---|
| `ANTHROPIC_API_KEY` unset | `{draft:null, reason:"no_provider_key"}`, 200. UI shows a quiet "draft unavailable" note; manual answering unaffected | FR-14. Mirrors `sendEmail`'s existing degradation |
| Claude 4xx/5xx/timeout | Same `{draft:null, reason}` shape, logged server-side | A broken optional assist must not block answering |
| `stop_reason: "refusal"` | Treated as no draft, with its category logged | Reading `content` on a refusal yields an empty draft that looks real |
| Non-broker calls `draft` | 403 before any model call | No token spend on an unauthorised caller |
| Client calls `draft` for their own question | 403 — role check, not ownership | A client must never obtain a draft (FR-12) |
| Email provider down | Question/answer still saved; `*_notified_at` stays null | The record is the product; email is a courtesy |
| Question's policy deleted | `on delete set null`; `context` text survives | The question stays readable |
| Two brokers answer at once | Second update fails the `with check` (already `answered`) | DB arbitrates; no lost-update window |
| Draft requested twice | Two model calls, no state change | Idempotent by being stateless |

## Tasks

Sized ~2–5 min each. `[P]` = parallel-safe once `depends:` are met. Nothing is
applied or deployed; the migration and function source are reviewable artifacts.

**T1 — Write the migration as an unapplied artifact**
`supabase/proposed/20261006_desk_questions.sql`: table, both CHECKs, four RLS
policies, `owner` and `status` indexes. Add its row to `supabase/proposed/README.md`.
depends: none

**T2 — `js/keep/logic/questions.js`** [P]
Pure: `SUBJECT_MAX`/`MESSAGE_MAX` re-exported from `requests.js`,
`validateQuestion({subject, body})`, `QUESTION_STATUS` map, `isAnswered(status)`.
No DOM.
depends: none

**T3 — `js/keep/logic/questions.test.mjs`** [P]
Empty subject, empty body, over-length each, valid, and `QUESTION_STATUS` covers
exactly `asked`/`answered`.
depends: T2

**T4 — Supabase client functions**
In `js/supabase.js`: `adaptQuestion(row)`, `addQuestion({subject, body, policyId, assetId, entityId, context})`,
`loadQuestions()`, `answerQuestion(id, answer)`, `requestDraft(id)`, `notifyQuestion(id, event)`.
Mirror the existing request functions; never send `owner`.
depends: T1, T2

**T5 — Ask form view**
`js/keep/views/questions-view.js`: `renderKeepAsk(kind, id)` — subject + body,
inline `.k-error`, context chip when bound, origin-aware back via `backLink`.
depends: T2, T4

**T6 — My questions list**
In `questions-view.js`: `renderKeepQuestions()` — status pill, answer shown when
answered, empty state. No stepper.
depends: T2, T4

**T7 — Router + command palette**
`js/main.js`: `case "ask"` / `case "questions"` in `dispatchKeep`, exports added
to the `keep.js` barrel import. One `KEEP_ACTIONS` entry
(`id: "ask-desk"`, href `#/keep/ask`) in `js/keep/logic/search.js`.
depends: T5, T6

**T8 — Turn the dead-end copy into a link**
`js/keep/views/shell.js:568`: the "ask your broker" empty state becomes an
anchor to `#/keep/ask`. Satisfies FR-17/SC-7.
depends: T7

**T9 — Entry points from records**
"Ask about this" control on policy detail (`policies-view.js`) and asset detail
(`assets.js`), passing the bound id and a context label.
depends: T7

**T10 — Edge Function source** [P]
`supabase/functions/desk-ask/index.ts`: validate env at module load (not `!`),
CORS, JWT caller resolution, role check, three events (`asked`, `draft`,
`answered`), `shell()`/`esc()`/`sendEmail()` carried over, notified-stamp only
on a real send.
depends: T1

**T11 — The Claude call**
In `desk-ask`: `claude-opus-5-5`, `effort: "low"`, `max_tokens: 2048`, no
streaming, `fallbacks: "default"` with its beta, **`stop_reason` checked before
`content`**, trimmed grounding payload only, every failure returning
`{draft:null, reason}`.
depends: T10

**T12 — Broker answer UI**
In the existing requests view: questions listed beside enhancement requests,
filterable to questions, *Suggest an answer* button (explicit), editable
textarea, Send. Draft labelled machine-generated (FR-13).
depends: T6, T10

**T13 — Styles**
`css/keep.css`: question card, status pill reusing the existing tint pattern,
draft notice. Tokens only, no new hex literals.
depends: T5, T6, T12

**T14 — Framing copy**
The "broker's guidance, not a replacement for your policy documents" line on the
ask form and every answered question (FR-19).
depends: T5, T6

**T15 — Manifest + docs**
`index.html` `MODULES` gains `js/keep/logic/questions.js` and
`js/keep/views/questions-view.js`; CLAUDE.md architecture, routes and the
`desk-ask` entry updated.
depends: T7, T13

**T16 — Gates + review**
All Required Commands green (9 on the audit branch, 7 here until #251 merges),
then `directives-toolkit:qa-pipeline` over the batch.
depends: T15, T14, T11, T12

## Consistency

Every requirement traces to a task, and every task to a requirement.

| Requirement | Task(s) |
|---|---|
| FR-1, FR-4 | T2, T3, T5 |
| FR-2, FR-3 | T1 (binding CHECK), T5, T9 |
| FR-5 | T1 (`dq_select_own`, `dq_insert_own`), T4 |
| FR-6 | T1 (status CHECK), T2 |
| FR-7 | T1 (no client UPDATE policy) |
| FR-8 | T1 (answer CHECK), T12 |
| FR-9 | T4, T10 (stamp only on real send) |
| FR-10 | T6 |
| FR-11, FR-15 | T11, T12 |
| FR-12 | Key decision 3 — T10/T11 never write a draft; T1 gives no column for one |
| FR-13 | T12 |
| FR-14 | T11 (every failure returns `{draft:null}`), T12 |
| FR-16 | T6, T7 |
| FR-17 | T8 |
| FR-18 | T12 |
| FR-19 | T14 |
| FR-20 | T11 (trimmed payload), T10 (key server-side) |
| FR-21 | T1 |
| SC-1..SC-8 | T16 exercises them; SC-3 and SC-5 hold structurally via T1 |

**Contradictions found:** none between spec and plan.

**Deliberate spec deviation:** the spec's reuse hint preferred extending
`enhancement_requests`. The plan rejects it, with reasons, under Key decision 1 —
per `global.md` → *A Knowing Deviation Is an Escalation*, flagged here rather
than taken silently.

**Over-engineering check:** no shared email module (two functions is not yet
duplication worth abstracting); no draft persistence; no threading; no stepper.

**Known gap:** nothing here can be verified in a browser locally — the sandbox is
chromium-only with no browser egress to Supabase, so the Keep scenarios do not
run. The honest substitute is the unit tests (T3), the structural RLS guarantees
(T1), and CI's live suite. The look gate should therefore be a deployed screen
reviewed by the owner, not a local screenshot.
