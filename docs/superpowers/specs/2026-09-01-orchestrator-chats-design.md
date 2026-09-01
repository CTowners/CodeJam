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
- **The model decides on its own when to draft**, not a manual "Draft the
  plan" button. Its instructions say: converse in plain text until you
  understand the task well enough to plan it (or the user explicitly asks
  you to), then emit ONLY the JSON in the exact contract shape. The
  candidate Agent list is baked into a chat's instructions once, as a
  snapshot, when the chat is created — not fetched live per-turn, since
  there's no longer a dedicated request to hang that fetch off of. The
  chat header shows a phase indicator (Tell me about the task / Discussing
  the task / Thinking… / Plan ready — review below), derived from the same
  classification the transcript itself uses, so it can never disagree with
  what's rendered below it.
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
[+ Chat]             <- primary action, instant creation, no form
                        default name "Chat <n>", n = existing-chat count + 1

CHATS                <- newest first, click the title to rename
  <chat name>

AGENTS                <- individual specialists a chat can assign work to
  [+ Create Agent]    <- smaller, secondary, lives in this section now
  <agent name>
```

## API surface

- `POST /api/agents` gains an optional `kind: "orchestrator"` — when present,
  the server ignores any client-supplied instructions/description and
  builds the canonical instructions itself, with the current Agent roster
  (excluding other chats) baked in as the candidate list (never trust the
  client to send the right text for a system-behavior Agent).
- `PATCH /api/agents/:id` accepts `{ name }` alone for a chat (its
  description/instructions stay 403'd) — the only way to rename one, since
  Settings is hidden for chats.
- `POST /api/jobs/approve` — `{ name, task, draft }`, revalidates `draft`
  against the same zod schema the model's own replies go through, then
  calls the existing `Orchestrator.approve` → materialize → persist →
  `startRun` path.
- No dedicated "draft" route: drafting is just an ordinary turn through
  `POST /api/agents/:id/messages`, same as any other chat message.

## Known limitations, going in

- The client-side check for "does this reply look like a plan" is a
  lightweight structural heuristic (parses as JSON, has the right
  top-level shape) — not the full Zod schema validation the server runs.
  That's fine: it only gates *rendering* (card vs. text), never
  correctness. The server re-validates for real when Approve is clicked.
- A chat's candidate Agent list is a snapshot taken at chat-creation time,
  not a live query. An Agent created after the chat started won't be
  offered as a cast candidate for it — start a new chat to pick it up.
