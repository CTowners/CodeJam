# Demo runbook

A concrete, rehearsable script for the 3-minute live demo, built around what's
actually implemented — not an aspiration. See
[AGENTS.md §5](../AGENTS.md#5-architecture--orchestrator-and-coordinator) and
[ARCHITECTURE.md](ARCHITECTURE.md#coordination-middleware) for the design this
demo is proving.

## Before you go on

- `npm run poc` running, `/api/system` shows `arkConfigured: true` and
  `codexAvailable: true`.
- At least two Agents already created, each with a distinct, unambiguous
  specialty in its `instructions` (so `capabilitySummary` matching is
  predictable) — e.g. a backend-flavored Agent and a test-flavored Agent.
- **Rehearse both Jobs below at least once** before presenting. Plan drafting
  is a real model call — confirm it reliably drafts a sensible 1–2 step plan
  and casts the Agent you expect. If it doesn't, tighten the task wording or
  the Agents' `instructions` until it does; don't discover this live.
- Only one Job runs at a time by design — don't try to overlap the two Jobs
  below, run them one after another.

## Script

**0:00–0:25 — The baseline (fast, sets context)**

Point at the sidebar: "Here's our team of Agents, each with its own
specialty." Click one, show its lifecycle state and — in Settings —
its `capabilitySummary`, and mention it's auto-derived from `instructions`,
not hand-typed.

**0:25–1:15 — Submit and run a Job (the normal case)**

Switch to the **Jobs** tab. Type a task that clearly needs more than one
specialty, e.g. *"Build a `/todos` API endpoint and write a test for it."*
Show the drafted plan before approving: the steps, and which Agent got cast
to each — call out that this is real matching against `capabilitySummary`,
not a fixed role list. Approve it. Let it run: narrate the transcript filling
in with per-Agent attribution and the event log ticking through
`turn_started` → `files_copied_out` → `turn_completed` → `job_completed`.
Say plainly: *"that's a real file, written by one Agent, moving into
another's workspace — not a description of one."*

**1:15–2:15 — The failure case**

Go to the Agent whose specialty the *next* task will need, and **stop it**
from the Playground, on camera — a plain, ordinary action, not a contrived
one ("say this Agent needs maintenance"). Go back to Jobs, submit a task
that clearly calls for that Agent's specialty again. Show the drafted plan —
it still casts the same Agent, because matching is based on capability, not
live status. Approve it.

Watch it fail **immediately**, not after a wasted retry: point at the Job's
`haltedReason` and the matching event — *"This Agent is stopped"*, classified
as an unrecoverable cause and halted at once, rather than burning retries on
something that will never fix itself. Contrast this out loud with what a
different kind of failure does instead: a wrong-output problem gets a bounded
retry on the same Agent; a network blip gets a retry with backoff. This one
needs a human, so it doesn't pretend otherwise.

**2:15–2:45 — Still controllable afterward**

Back to the sidebar: the stopped Agent is still there, inspectable, nothing
corrupted. Back to the Job list: the completed Job and the halted Job are
both listed, both fully auditable via their own event logs — *"every
decision the Coordinator made, including the failure, is recorded, not just
the happy path."*

**2:45–3:00 — Close**

One line: *"This turns coordinating multiple Agents from something a human
babysits by hand into something the platform plans, runs, and explains when
it goes wrong."*

## If something goes sideways live

- **Drafting is slow or the model misbehaves:** have a second browser tab
  already sitting on a completed Job from rehearsal as backup evidence to
  narrate over while the live one catches up.
- **The Orchestrator casts a different Agent than expected:** it's matching
  on `capabilitySummary` text, not intent — during rehearsal, make the
  intended Agent's `instructions` the unambiguous best fit for your exact
  task wording, or reduce the candidate pool for that demo run.
- **Don't try to demo the plan-revision chat or the cast-reassignment
  picker** — both are named in the design but not wired up in this build,
  disclosed in `AGENTS.md` and in the draft screen's own copy. If asked,
  say so plainly rather than improvising around it.

## Known limitations, if asked directly

- Chat-based plan revision and per-step cast reassignment are designed but
  not implemented.
- A repeatedly-failing step halts the Job rather than being reassigned to a
  different Agent of the same specialty — the cast is fixed once a Job is
  approved.
- One Job runs at a time, globally, by design.
