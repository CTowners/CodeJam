# Demo runbook

A concrete, rehearsable script for the 3-minute live demo, built around what's
actually implemented — not an aspiration. See
[AGENTS.md §5](../AGENTS.md#5-architecture--orchestrator-and-coordinator) and
[ARCHITECTURE.md](ARCHITECTURE.md#coordination-middleware) for the design this
demo is proving.

## Before you go on

- `npm run poc` running, `/api/system` shows `arkConfigured: true` and
  `codexAvailable: true`.
- At least two entries under **Your Agents**, each with a distinct, unambiguous
  specialty in its `instructions` (so `capabilitySummary` matching is
  predictable).
- **Rehearse both Jobs below at least once** before presenting. Plan drafting
  is a real model call — confirm it reliably fans the first task out across
  several Agents. If it doesn't, tighten the task wording until it does; don't
  discover this live.
- Only one Job runs at a time by design — run the two Jobs one after another.
- Have one **already-completed fan-out Job** and one **already-halted Job** left
  over from rehearsal. Both are narrated below as evidence; do not delete them.
- A fanned-out research Job takes ~2–3 minutes end to end. If your slot is
  tight, start it, talk over it, and cut to the rehearsed one if it lags.

## Script

**0:00–0:25 — The baseline (fast, sets context)**

Point at the sidebar. Two sections: **Chats**, where you ask for things, and
**Your Agents**, the specialists you have defined. Click one of Your Agents,
show its `capabilitySummary` in Settings, and mention it is auto-derived from
`instructions`, not hand-typed — this is what casting matches against.

**0:25–1:30 — Ask a Chat, and watch it fan out (the headline)**

Click a **Chat** and type one request that splits into independent parts, e.g.
*"Research the intersection of cancer, modern lifestyle, and environment. Cover
several distinct angles independently, then synthesize the findings into one
summary."*

Show the drafted plan **before** approving. The thing to point at is the shape:
several steps with **no `needs` between them**, each cast to its own Agent, and
one final step that `needs` all of their outputs. Say plainly: *"nothing has run
and nothing has been created yet — this is the one judgment call, and it is
reviewed before anything executes."*

Approve. Then narrate the event log, because it proves the claim on its own:
the parallel `turn_started` lines share a timestamp, and the synthesis step does
not start until the last `files_copied_out` lands. Expand the Chat in the
sidebar — the subagents it spawned are now nested underneath it, inspectable but
not chattable.

Say plainly: *"those are real files, written by separate Agents that cannot see
each other's folders, carried between them by plain code — not descriptions of
files passed through a prompt."*

**1:30–2:15 — The failure case**

Two halves: one you trigger live, one you point at.

*Live — a human stays in control.* Start a second, shorter Job and **cancel it
mid-run**, on camera. It does not die mid-turn and it does not corrupt anything:
it stops at the next step boundary and the Job is marked `halted` with
`haltedReason: "Cancelled by user"`, recorded in the event log like every other
decision.

*Evidence — failures are classified, not counted.* Open the halted Job left over
from rehearsal and read its `haltedReason` aloud. Point out that the Coordinator
retried it twice first, because the cause was classified as **transient** — and
contrast that with the other buckets: a wrong-output problem gets a bounded retry
on the same Agent, while an auth or config problem halts immediately rather than
burning retries on something that will never fix itself.

The line to say: *"it decides whether to retry from the raw failure signal —
never by asking the model how it thinks it did."*

**2:15–2:45 — Still auditable afterward**

Back to the sidebar: every subagent from the run is still nested under its Chat,
inspectable, nothing corrupted. Back to the Job list: the completed Job and the
halted Job are both there, each with its own full event log — *"every decision
the Coordinator made, including the failures, is recorded, not just the happy
path."*

**2:45–3:00 — Close**

One line: *"This turns coordinating multiple Agents from something a human
babysits by hand into something the platform plans, runs, and explains when
it goes wrong."*

## If something goes sideways live

- **Drafting is slow or the model misbehaves:** have a second browser tab
  already sitting on a completed Job from rehearsal as backup evidence to
  narrate over while the live one catches up.
- **The Chat casts a different Agent than expected:** it's matching on
  `capabilitySummary` text, not intent — during rehearsal, make the intended
  Agent's `instructions` the unambiguous best fit for your exact task wording,
  or reduce the candidate pool for that demo run.
- **The plan comes back as one sequential chain instead of fanning out:** the
  drafting prompt asks for fan-out but cannot force it. Reword the task to name
  the independent parts explicitly ("cover these three angles separately"), or
  fall back to narrating the rehearsed fan-out Job.
- **A Job halts on a rate limit (`429`):** that is the classifier working, not a
  break — say so, and use it as the failure beat instead of cancelling.
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
- Subagents are spawned per Job and are not reused across Jobs; casting one of
  Your Agents clones its instructions into a fresh subagent rather than running
  the definition itself.
- Stopping one of Your Agents does not stop a Job that casts it — the Job runs
  against a freshly-spawned subagent, not the definition.
