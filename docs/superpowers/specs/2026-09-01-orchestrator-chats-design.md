# Orchestrator chats — design

## Problem

The Orchestrator is a single, shared, lazily-created Agent used for every Job's
plan drafting. Two real problems fall out of that:

1. **No isolation.** Every unrelated task ever submitted shares the same Codex
   thread — task 5's drafting call can still "see" tasks 1–4 in its history.
2. **Two doors, one broken.** Because it's an ordinary Agent, it's also
   selectable in Playground and messaged directly — but its instructions force
   JSON-only output on every turn, so a normal chat message gets a raw JSON
   blob back, unreadable and useless to a human.

## Decided

- **A "chat" is a real Agent**, distinguished by a new `Agent.kind?: "orchestrator"`
  field (not name-matching, since chats are user-renamable). Creating a chat
  reuses the existing Agent creation, thread-resume, and rename machinery —
  no new persistence layer.
- **One chat, one Job.** A chat is scoped to planning a single task: discuss,
  get feedback, ask questions, then draft and approve into exactly one Job.
- **Conversation reuses the existing Playground pipeline as-is** — send
  message, poll the Run, render the transcript. No new backend machinery for
  the conversational part.
- **"Draft the plan" is an explicit action**, not inferred from message
  content. It sends one specially-marked message through the same pipeline;
  the Orchestrator's instructions only emit strict JSON when that marker is
  present, plain text otherwise.
- **Raw JSON is never rendered as a message, in any code path.** A reply that
  parses as a valid plan renders as a plan card. A reply that doesn't parse as
  JSON at all is a normal conversational reply (e.g. a clarifying question) —
  shown as plain text, not treated as a failure. A reply that parses as JSON
  but fails plan validation shows a clean, human-readable translation of what
  is wrong — never the JSON, never the model's raw broken output.
- **Scope cut:** the old one-shot flow's automatic 2-attempt guided-retry on
  an invalid draft is dropped. An invalid draft's errors are surfaced in the
  chat as plain text; the user asks for a fix conversationally instead of an
  automatic silent retry.
- **No orchestrator-spawned Agents** (unchanged, established earlier): the
  candidate list for a plan excludes every `kind: "orchestrator"` Agent, and
  `"new"` cast proposals still only materialize on explicit Job approval.

## Sidebar layout

```
[+ New Chat]        <- primary action, instant creation, no form

CHATS                <- newest first
  <chat name>

AGENTS                <- individual specialists a chat can assign work to
  [+ Create Agent]    <- smaller, secondary, lives in this section now
  <agent name>
```

## API surface

- `POST /api/agents` gains an optional `kind: "orchestrator"` — when present,
  the server ignores any client-supplied instructions and sets them to the
  canonical Orchestrator instructions itself (never trust the client to send
  the right text for a system-behavior Agent).
- `POST /api/agents/:id/draft-plan` (new) — builds the marked trigger message
  server-side (current live candidate list, not client-supplied) and sends it
  through the existing `sendMessage` pipeline. Returns the same
  `{ run, message }` shape a normal message send does.
- `POST /api/jobs/approve` (new) — `{ name, task, draft }`, calls the existing
  `Orchestrator.approve` → materialize → persist → `startRun` path, unchanged
  from today's `approveDraft` minus the by-id draft lookup.
- Removed: `POST /api/jobs/draft`, `GET /api/jobs/drafts/:draftId`,
  `POST /api/jobs/drafts/:draftId/approve` — nothing in the new UI calls them.

## Known limitation, going in

The client-side check for "does this reply look like a plan" is a lightweight
structural heuristic (parses as JSON, has the right top-level shape) — not the
full Zod schema validation the server runs. That's fine: it only gates
*rendering* (card vs. text), never correctness. The server re-validates for
real when Approve is actually clicked.
