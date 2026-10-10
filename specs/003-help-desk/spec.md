# Feature 003 — Help desk

**Status:** approved 2026-10-06. Supersedes feature 002 (*Ask the desk*) as the
first thing to build; 002 is **parked, not cancelled** — it stays an approved
plan for the broker question channel, to be built after this.

## What it is

A help assistant inside the Keep. The client opens `#/keep/help`, types a
question in plain language, and gets an answer straight away — no broker, no
waiting. Suggestion chips offer common questions so the empty state is not a
blank box.

It answers from two sources, and the difference between them is the whole
design:

1. **The app's help guide** — a written corpus describing the Keep's screens and
   what you can do on each. *"Where do I add a business entity?"*
2. **The signed-in client's own records** — their entities, assets and policies.
   *"When does my auto policy renew?"*

## The boundary that makes source 2 safe

⚠️ **This is the load-bearing requirement, and the reason this spec exists
rather than a two-line ticket.**

Reading the client's records lets the assistant state **facts**. It does not let
it give **advice**. In an insurance app those are not a spectrum, they are two
different products with two different regulators:

| allowed — a FACT in the record | refused — a COVERAGE DETERMINATION |
|---|---|
| "Your auto policy renews on 12 March." | "You're covered if someone else drives it." |
| "You have three policies on the Tesla." | "That limit is enough for your situation." |
| "Your flood policy's dwelling limit is $400,000." | "Your flood policy covers the detached garage." |
| "Two policies have no renewal date on file." | "You should add umbrella cover." |

The left column reads a value back. The right column interprets, applies or
recommends — and a licensed broker owns that. When a question lands on the
right, the assistant says so plainly and offers the broker channel rather than
guessing.

## User stories

- **US-1** As a client, I ask "where do I add a business entity?" and get told
  the screen and how to reach it.
- **US-2** As a client, I ask "when does my auto policy renew?" and get the date
  from my own record.
- **US-3** As a client, I ask "does my flood policy cover the detached garage?"
  and am told this needs my broker, with a way to ask them — not a guess.
- **US-4** As a client with nothing on file yet, I ask about my policies and am
  told there are none rather than given an invented answer.
- **US-5** As a client, I open the page and see suggested questions, so I know
  what it can do without typing.

## Functional requirements

**The page**
- **FR-1** A `#/keep/help` route, behind the Keep's existing auth gate.
- **FR-2** Suggestion chips seeded from the help guide; clicking one asks it.
- **FR-3** A single-line ask box with a submit control, disabled while in flight.
- **FR-4** The answer renders below the question, preserving line breaks.
- **FR-5** Reachable from the account menu, the pattern "My requests" already uses.
- **FR-6** Origin-aware back, per CLAUDE.md's always-rule.

**Answering**
- **FR-7** Answers come from the help guide and the signed-in client's own
  records only. No other source, no general knowledge about insurance.
- **FR-8** The assistant states facts from records but **refuses coverage
  determinations**, per the table above, and offers the broker channel instead.
- **FR-9** When neither source settles the question, it says so — it never fills
  the gap. "Your documents on file don't say" is a correct answer.
- **FR-10** Every answer is labelled AI-generated, with a line telling the client
  to confirm anything that matters with their broker.
- **FR-11** The answer names what it drew on — which help topic, which record —
  so the client can check it.
- **FR-12** A client with no records gets "nothing on file yet", never an
  invented answer.

**Boundaries**
- **FR-13** The client's text is **data, never instruction**. An attempt to
  redirect the assistant is answered as a question about that text, not obeyed.
- **FR-14** Records are read **server-side, scoped to the caller's own owner id**
  resolved from their JWT — never taken from the request body, which the client
  controls.
- **FR-15** No provider key reaches the browser.
- **FR-16** The endpoint is throttled per client. A public repo with published
  demo credentials cannot have an unmetered paid endpoint.
- **FR-17** Failure is quiet and non-blocking: if the assistant is unavailable,
  the page says so and the rest of the Keep is unaffected.

## Success criteria

- **SC-1** A help-guide question returns the right screen and how to reach it.
- **SC-2** A record question returns the value from that client's own record.
- **SC-3** A coverage question is refused with the broker hand-off, in every
  phrasing tried — including ones that assert an answer and ask for agreement.
- **SC-4** A client cannot obtain another client's records through any input.
- **SC-5** An injection attempt in the question does not change the assistant's
  rules.
- **SC-6** With no provider key, the page degrades to an unavailable notice and
  nothing else in the Keep breaks.
- **SC-7** The throttle refuses past its limit, and says so.
- **SC-8** The pure logic is unit-tested without credentials or network.

## Non-goals

- No broker involvement, no lifecycle, no emails — that is feature 002.
- No conversation history or follow-up turns: one question, one answer.
- No editing or acting on records — read-only.
- No public-site help; the Keep only.
- No general insurance advice, even where the model could give it.

## Assumptions

- **A-1** The help guide is written as part of this feature; the repo has none.
- **A-2** One question, one answer — no memory between asks.
- **A-3** English only.
- **A-4** The refusal boundary is enforced in the prompt AND stated in the UI;
  neither alone is treated as sufficient.
