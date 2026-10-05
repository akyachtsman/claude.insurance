# Spec — Ask the desk (feature 002)

**Phase 1 of `/sdd-loop`. WHAT and WHY only** — no stack, no architecture, no
data shapes. Those belong in `plan.md`. Every requirement below is written to be
verifiable.

**Status:** clarifications resolved (see the end). Ready for `/sdd-loop plan`.

---

## Why

A Keep client can **request a change** but cannot **ask a question**.

Verified against the code, not assumed:

- Enhancement requests are a complete client→broker channel for *changing*
  coverage: a form, a four-stage lifecycle, a "My requests" list, and email at
  each step.
- There is **no question channel at all**, and **no help, FAQ or glossary
  anywhere in the Keep**. `js/components/glossary.js` exists but serves the
  public questionnaire only — nothing under `js/keep/` imports it.
- The portal already tells the client to ask: *"No policies on file — ask your
  broker to add one."* That string is a dead end with no action behind it.

So the question a client most naturally has — *"does my flood policy cover the
detached garage?"* — has nowhere to go. It is not an enhancement request: the
client is not asking for a change, they are asking what is already true. Today
their only route is out-of-band email, which leaves no record in the portal that
is supposed to be their system of record.

Secondary benefit: the `desk-ask` Edge Function slug is already deployed and
dormant (a neutralised stub, no source in the repo). This feature gives it a
real purpose, which retires an untracked deployed artifact by using it rather
than by deleting it.

## Who

| Actor | Needs |
|---|---|
| **Client** | Ask a plain-language question about their own cover and get a trustworthy answer, without leaving the portal or composing an email. |
| **Broker** | See incoming questions beside the requests they already triage, and answer quickly without re-deriving the client's situation from scratch. |

Out of scope as an actor for v1: the **underwriter**. Questions are a
client↔broker matter; the underwriting stage has no part in them.

## User stories

1. **As a client**, from a policy, asset or entity page, I ask a question and it
   arrives already carrying that context, so I don't have to describe which
   policy I mean.
2. **As a client**, from the Add/command menu anywhere in the portal, I ask a
   free-standing question when it isn't about one specific record.
3. **As a client**, I see my questions and their answers in one place, and I can
   tell at a glance which are still waiting.
4. **As a client**, I am emailed when my question is answered, so I don't have to
   poll the portal.
5. **As a broker**, incoming questions appear in the view where I already handle
   client requests, distinguishable from change requests.
6. **As a broker**, I am offered a **suggested draft answer** grounded in that
   client's actual cover, which I edit or discard before anything is sent.
7. **As a broker**, nothing I have not explicitly sent is ever visible to the
   client.
8. **As a client who has no policies yet**, the "ask your broker" message is a
   working link, not dead copy.

## Functional requirements

Asking

- **FR-1** A client can submit a question consisting of a short subject and a
  longer body, with the same length limits the existing request form enforces.
- **FR-2** A question may optionally be bound to exactly one policy, asset or
  entity the client owns. Binding is captured automatically when the client asks
  from that record's page.
- **FR-3** A question submitted from the command menu with no record context is
  valid and free-standing.
- **FR-4** Submitting requires a non-empty subject and body; the form is not
  left until both are valid, and the failure is shown inline.
- **FR-5** A client can only ever create a question owned by themselves, and can
  only read their own.

Answering

- **FR-6** A question has exactly two client-visible states: **asked** and
  **answered**. There is no intermediate state shown to the client.
- **FR-7** Only a broker (or the trusted server role) can record an answer. A
  client can never answer, including their own question.
- **FR-8** An answer is a single body of text. One question yields one answer;
  a follow-up is a new question.
- **FR-9** The client is notified by email when, and only when, an answer is
  actually sent — never when one is merely drafted.
- **FR-10** An answered question shows the answer, who answered, and when.

Draft assistance (broker-side)

- **FR-11** When viewing an unanswered question, the broker may request a
  **suggested answer** generated from the client's own cover and the question
  text.
- **FR-12** A suggested answer is **never** visible to the client and is
  **never** sent automatically. It becomes an answer only when a broker
  affirmatively sends it, after any edits.
- **FR-13** The suggestion is labelled to the broker as a machine-generated
  draft, so it is never mistaken for a colleague's words.
- **FR-14** Generating a suggestion is optional and failure-tolerant: if it is
  unavailable for any reason, the broker can still answer normally and the
  feature degrades to manual answering with a visible, non-blocking notice.
- **FR-15** Requesting a suggestion is an explicit broker action, not automatic
  on page load.

Surfacing

- **FR-16** Clients reach their questions from a single place in the portal, and
  it is discoverable from the existing command menu.
- **FR-17** The existing *"ask your broker to add one"* empty-state copy becomes
  an action that opens the ask form.
- **FR-18** For the broker, questions appear in the view that already lists
  client requests, visibly distinguished from change requests, and filterable to
  questions only.

Framing and data handling

- **FR-19** Every client-visible answer carries framing consistent with the rest
  of the product: it is the broker's guidance on their cover, and does not
  replace the policy documents, which remain authoritative.
- **FR-20** Generating a suggestion must not expose any credential to the
  browser, and must send no more of the client's record than the question
  requires.
- **FR-21** A question and its answer are durable records visible in the portal,
  not transient messages.

## Success criteria

- **SC-1** A client can ask a question from a policy page and from the command
  menu, and both appear in their questions list.
- **SC-2** A broker can answer, and the client sees that answer and is emailed
  once.
- **SC-3** No action a broker takes short of sending makes a draft visible to the
  client — demonstrable by inspecting what a client can read while a draft
  exists.
- **SC-4** With draft generation disabled or failing, every manual path still
  works end to end.
- **SC-5** A client cannot answer any question, including their own, by any
  route available to the browser.
- **SC-6** A client cannot read another client's question or answer.
- **SC-7** The empty-state copy that says to ask the broker actually opens the
  ask form.
- **SC-8** Asking and answering are covered by automated tests that run without
  production credentials.

## Non-goals

Explicit, so the plan does not quietly grow them:

- **No AI answer reaching a client unreviewed.** In an insurance context an
  automated statement about what is covered is advice, and this product is
  deliberately framed "not a quote" on its public side. A human sends every
  answer. This is a product rule, not a technical limitation.
- **No threaded conversation.** One question, one answer; follow-ups are new
  questions.
- **No underwriter involvement.**
- **No client-facing chatbot, live chat, or presence/typing indicators.**
- **No knowledge base, FAQ or glossary for the Keep.** A real gap, but a
  separate feature — this one is about reaching a human.
- **No change to the enhancement-request lifecycle.** Questions sit beside it.
- **No file attachments** on questions or answers in v1.
- **No SLA, response-time commitment or escalation.**

## Dependencies and constraints

- **A migration is unavoidable.** There is today no field anywhere to store an
  answer. CLAUDE.md requires **explicit owner approval** for migrations, so the
  plan must treat the schema change as a reviewable, unapplied artifact — it may
  not assume it has been applied.
- **A deploy is unavoidable.** The `desk-ask` function currently returns `410`
  and has **no source in the repo**. Any replacement source must be committed
  under `supabase/functions/desk-ask/`, and deploys likewise need explicit owner
  approval.
- **Reuse before rewrite** (`global.md`). The existing request lifecycle,
  status-pill presentation, stepper, list patterns, email shell and command menu
  all cover adjacent ground; the plan must justify any new mechanism against
  extending them.
- **PR #251 is open and unrelated.** This feature must not be mixed into it.
- Clients have full CRUD on their own records; policies are broker-written and
  the broker is the system of record. This feature must not weaken that.

## Clarifications

Resolved with the owner before planning, as this phase requires.

| # | Question | Answer |
|---|---|---|
| 1 | Broker-answers-only, or also the broker-side AI draft, for v1? | **Both** — the AI-drafted suggested answer is in v1, broker-side only. Raises FR-11..FR-15 and FR-20. |
| 2 | Can a question attach to a specific policy/asset/entity? | **Yes, optional.** Captured automatically when asked from that record; free-standing is also valid. FR-2, FR-3. |
| 3 | Single question + answer, or threaded? | **Single.** Asked → answered; a follow-up is a new question. FR-6, FR-8, and a non-goal. |
| 4 | Where does the broker answer? | **In the existing requests view**, distinguished by kind and filterable. FR-18. |

Assumptions recorded rather than left implicit, each safe to revisit at `plan`:

- **A-1** A question is owned by one client; there is no shared or household
  visibility, consistent with every other record in the Keep.
- **A-2** The broker identity shown on an answer is the single broker the portal
  already names; no multi-broker routing.
- **A-3** Email notification on answer follows the existing notification
  pattern, including degrading quietly when no mail provider is configured.
- **A-4** No answer is editable after sending in v1; a correction is a new
  question. Flagged because it is a plausible thing to want, and cheap to add
  later.

## Open for `plan`, deliberately

Not spec questions — recording them so the next phase does not have to
rediscover them:

- Whether questions extend the existing requests table with a kind discriminator
  or get their own table, and what that costs in RLS complexity.
- Which generation provider and model back the draft, and where the prompt
  lives. **`plan` must load the `claude-api` skill before choosing** rather than
  answering from memory.
- How much of the client's cover is sent as grounding for a draft, which is the
  concrete form of FR-20.
- Whether the existing `status` check constraint can carry question states or
  needs widening.
