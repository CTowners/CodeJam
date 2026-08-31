 # AGENTS.md — working agreement for the team and our coding agents

TikTok TechJam 2026, "Agent Launchpad". We are building **middleware** on top of the
starter kit. We are not rebuilding the platform.

> **Name collision, read this once.** This file is instructions for *us* and for the
> coding agents we point at this repo. It is unrelated to the `AGENTS.md` that
> `workspace.ts` generates inside each Agent's own workspace at runtime — those are
> platform-generated Codex instructions, they live under the gitignored `workspaces/`
> directory, and nothing here affects them.

---

## 1. Environment — read before you clone

**macOS / Linux:** clone and go. You are on the supported path.

**Windows: you must use WSL2, and the repo must live on the Linux filesystem.**
This is not a preference. All three configurations were tested:

| Setup | `npm run check` |
|---|---|
| Native Windows (PowerShell) | **Fails.** `config.ts` `path.resolve("/tmp/codex-home")` returns `C:\tmp\codex-home`, which gets concatenated into a Docker `--mount type=bind,src=...` spec at `container-codex-runner.ts:79`. Also `npm run poc` cannot run at all — it is a bash script. |
| WSL, repo on `/mnt/c/...` | **Fails.** `app.test.ts` exceeds vitest's 5s default. The 9p mount is ~25x slower (12.7s vs 498ms for the same suite). |
| WSL, repo on ext4 (`~/Projects/...`) | **Passes.** 12/12, full check in ~8s. |

Windows setup, once:

1. Install Docker Desktop, then enable **Settings → Resources → WSL Integration** for
   your Ubuntu distro. Without this, `docker` inside WSL resolves to the Windows `.exe`
   and mount paths break.
2. Install Node 22 *inside* Ubuntu (NodeSource). WSL inherits the Windows PATH, so
   without this you may silently get a broken Windows npm shim.
3. Clone into the Linux filesystem — `~/Projects/CTowners/CodeJam`, **not** `/mnt/c`.
   Reachable from Explorer at `\\wsl$\Ubuntu\<your-home>\Projects\CTowners\CodeJam`.
4. VS Code: install the **WSL** extension, then `code .` from the Ubuntu terminal.

Pick one platform for `npm install` and stay on it. `node_modules` contains
platform-specific native binaries (esbuild), so a Windows install and a WSL install
cannot share one `node_modules` directory.

---

## 2. Commands

```bash
npm run check   # typecheck + server tests + production builds. CI runs exactly this.
npm run poc     # the real thing: builds the runtime image, starts on :3000. Needs Docker + Ark.
npm run dev     # hot reload, host Codex process. No container isolation.
```

`npm run check` must pass before you open a PR. It needs no Docker and no Ark key.

**Ark credentials** (`ARK_API_KEY`, `ARK_MODEL` — an `ep-...` endpoint ID) are only
required to *send a message*; the guard is at `agent-service.ts:157`. Agent CRUD,
lifecycle, workspaces, persistence, and the entire UI work without a key, so most
middleware development is unblocked while we wait on credentials.

Keys go in `.env` (already gitignored). Never in source, a commit, a screenshot, a
log, or a trace.

---

## 3. Repo map

The server is small — about 1,100 lines across 8 files. Read it; it fits in one sitting.

| File | Lines | What it is |
|---|---|---|
| `apps/server/src/types.ts` | 82 | Domain types + the `AgentRunner` interface. The contract file. |
| `apps/server/src/app.ts` | 170 | Fastify routes. Thin — handlers delegate to the service. |
| `apps/server/src/agent-service.ts` | 326 | The brain. CRUD, lifecycle, run orchestration, cancellation. |
| `apps/server/src/store.ts` | 60 | JSON file behind a serialized `mutate()` queue. |
| `apps/server/src/codex-runner.ts` | 267 | Codex as a host process. |
| `apps/server/src/container-codex-runner.ts` | 255 | Codex in a disposable container. |
| `apps/server/src/workspace.ts` | 75 | Per-Agent directories, archive on delete. |
| `apps/server/src/config.ts` | 122 | Env parsing and validation. |
| `apps/web/src/App.tsx` | 670 | The entire UI in one component, 12 `useState` calls. |

---

## 4. The four extension seams

Where middleware attaches. Prefer these over inventing new ones.

**`app.ts:45`** — the `onRequest` hook. Currently one shared bearer token for the whole
process. This is where a human principal attaches to a request.

**`agent-service.ts:235`** — `executeRun`. Every Run passes through here. The natural
point for run-level events and decisions.

**`types.ts:78`** — the `AgentRunner` interface, three methods, constructed at
`runner-factory.ts:6`. **This is the highest-value seam for parallel work.** It is
wrappable as a decorator:

```ts
return new TracingRunner(new PolicyRunner(baseRunner))
```

That lets two people build enforcement and observability as *entirely new files*
instead of both editing `agent-service.ts` and fighting over it.

**`store.ts:23`** — rejects any `version !== 1`. Adding a collection means bumping the
version **and** writing a migration, or every teammate's local `.data/` dies on their
next pull. Whoever touches this, announce it before you merge.

---

## 5. Architecture — Orchestrator and Coordinator

This section is the current source of truth for the coordination design — more
specific than, and where it conflicts, superseding, the sketch in `contracts.ts`.
Section 4 (extension seams), section 6 (file ownership) and `contracts.ts` itself
need to catch up to it; see the gap called out at the end of this section.

Two components, split by when they run and what kind of decision they make.

**Orchestrator — judgment, upstream, runs once per Job.**
- Drafts a Plan: an ordered, dependency-aware set of Steps for the submitted task.
- Casts each Step by matching it against every Agent's `capabilitySummary` — not a
  fixed role vocabulary. `capabilitySummary` is capped from `instructions`,
  regenerated whenever `instructions` changes, visible to the user but never
  directly edited. `description` stays separate — user-authored, sidebar-only,
  never used for matching.
- Default workflow: the user tells the Orchestrator which predefined Agents to use
  for the Job. If no existing Agent's `capabilitySummary` fits a Step, the
  Orchestrator may fall back to drafting a brand-new Agent (name + instructions) as
  part of the Plan — shown in plan review exactly like any other cast pick, editable
  or rejectable before anything runs. **It is only materialized as a real Agent
  (own workspace, generated `capabilitySummary`, visible in the sidebar) once the
  whole Plan is approved** — a rejected plan leaves no orphaned Agent behind. Once
  real, it persists after the Job like any user-made Agent: inspectable, editable,
  reusable in future Jobs, same as one the user created by hand.
- The user reviews the drafted Plan and can revise its structure via chat
  (propose/discuss/revise) or reassign a Step's cast via a picker. The whole Plan
  is approved once, upfront, before anything runs.

**Coordinator — deterministic, downstream, runs after approval.**
- Executes the approved Plan step by step. Plain code, no judgment calls.
- Staging area: a per-Job area that Agent workspaces never see directly. Before a
  Step's turn, its declared `needs` are copied from staging into that Agent's own
  workspace; after the turn, `produces` are verified (files exist and are
  non-empty; if set, `replyPattern` matches the last non-empty line of the reply)
  and only then copied into staging for later Steps.
- **Concurrency / race-condition policy: dependency-gated scheduling, no runtime
  locks.** A Step is only eligible to run once every one of its `needs` already
  exists in staging — i.e. produced by a Step that already reached `completed` and
  had its `produces` copied out — and no currently-running Step's `produces`
  overlaps it. Because a read (copy-in) can only ever happen after the producing
  Step's write (copy-out) has already finished, there is no window where a Step
  reads a file mid-write by another. Two Steps needing the same staged input at the
  same time is fine — it's a plain filesystem copy, not shared mutable state.
  Overlapping `produces` between two Steps is a plan-validation conflict, caught
  before anything runs, never a runtime race.
- Files temporarily copied into an Agent's workspace are cleared at Job completion
  or halt (not after every Step — a later Step in the same Job may still need
  them). The staging area itself persists — it's demo evidence.
- Failure is classified by cause, never by asking a model to judge its own
  failure — classified from the raw error signal (HTTP status, exit code, known
  error shape):
  - transient (network/infra blip) → retry with backoff
  - validation (wrong/missing output) → retry the same Agent, bounded
  - auth (credential/config problem) → halt immediately, no wasted retries
  - cancelled (user stopped it) → marked cleanly, never treated as failure

**Scope for this hackathon:** one Job runs at a time (an Agent does one thing at
once, by construction no scheduling conflicts across Jobs). No orchestrator-spawned
or auto-scaled Agents beyond the draft-then-materialize flow above. No reassigning
a Step to a different Agent mid-Job (needs a schema change not yet committed to).
No real Kafka/Redis — this all runs in-proc.

**Known gap, flag before building on top of it:** `contracts.ts` still has
`AgentRole` as a fixed enum (`architect | implementer | tester | reviewer |
counter`) and `Agent` (`types.ts`) has no `capabilitySummary` field. This section
is the target design — whoever owns `contracts.ts` needs to move `PlanStep.role`
to a free-form string and add `Agent.capabilitySummary` before Orchestrator
matching can be built against real types.

---

## 6. Implementation order

**No more file ownership by person.** That split existed to keep three simultaneous
editors off each other's files; under the one-driver workflow (§8) only one person
touches the repo at a time, so the thing that matters now is build order, not
ownership. Whoever is driving picks up at the earliest unfinished step below and
leaves a one-line note in the handoff on exactly how far they got.

All five steps are done — a full vertical slice from task to running Jobs to a
UI, all under test. See the status line under each step below for what actually
got built and any gaps/limitations worth knowing before extending it.

1. **Store v2 + contracts wiring.** Add `jobs`, job-level `messages`, and `events`
   collections to `Database` (`types.ts`); bump `version` to 2 and write the
   migration, following `store.ts`'s existing ENOENT-vs-version-mismatch split.
   Add `Agent.capabilitySummary` and move `PlanStep.role` off the fixed
   `AgentRole` enum to a free-form `string` — the gap §5 flags. Nothing below can
   be built against real types until this lands.
   **Done.** `Database` v2 + `DatabaseV1` migration in `store.ts`/`types.ts`;
   `Agent.capabilitySummary` derived deterministically (no Ark key needed) in
   `capability-summary.ts`, wired into `agent-service.ts`'s create/update; `AgentRole`
   is `string` in `contracts.ts`, which also gained `CastProposal`/`DraftedPlan` for
   step 3's draft-then-materialize flow.
2. **Coordinator loop** (`coordinator/`, new dir), built against a fake
   `TurnRunner` — `contracts.ts` defines it as an injected interface precisely so
   this is unit-testable with canned replies, no Ark key, no Docker, milliseconds
   per test:
   - turn execution: copy `needs` in, run the turn, verify `produces` +
     `replyPattern`, copy `produces` out, mark the Step complete.
   - dependency-gated scheduling for parallel Steps — §5's race-condition policy,
     no locks: a Step runs once its `needs` are already staged by a *completed*
     Step and no live Step's `produces` overlaps it.
   - failure classification (transient / validation / auth / cancelled) and the
     retry/halt behavior per class.
   - plan validation: overlapping `produces` across Steps is a conflict, rejected
     before anything runs.
   This is where most of the verification score lives — build and harden it before
   step 3.
   **Done.** `coordinator/{coordinator,scheduler,plan-validation,failure-classifier,
   file-courier,reply-check,fake-turn-runner}.ts`, 12 tests incl. a proven-concurrency
   test (deadlocks if two independent Steps ran sequentially instead of in parallel).
   Also hardened: a throwing runner is caught and classified rather than crashing the
   Job, and `CoordinatorOptions` gained `onEvent`/`onMessage`/`onJobUpdate` hooks so a
   caller can persist progress on a Job that's still running, not just at the end.
3. **Orchestrator.** Plan drafting from a submitted task, matched against existing
   Agents' `capabilitySummary`, plus the draft-then-materialize flow for a custom
   Agent when nothing existing fits a Step (§5). The one LLM-in-the-loop piece —
   do it after the deterministic Coordinator is solid and demoable on its own.
   **Done.** `orchestrator/{orchestrator,plan-drafter,model-plan-drafter,prompt,
   response-schema,materialize,fake-plan-drafter}.ts`, 13 tests. `draftPlan()` retries
   once against the Coordinator's own `validatePlan` before giving up
   (`OrchestratorDraftError`); `approve()` materializes any `"new"` cast proposal into
   a real Agent only once the plan is approved.
4. **`job-routes.ts`** (new) — thin Fastify plugin over `AgentService` job methods
   (`createJob`, `getJob`, `listJobs`, `getJobMessages`, `getJobEvents`,
   `cancelJob`), mounted the way `app.ts` mounts everything else.
   **Done**, with one structural change from the original sketch: job methods live
   on a new `JobService` (`job-service.ts`), not on `AgentService` — `agent-service.ts`
   only grew `runTurn`/`resetMemory`, making it implement `TurnRunner` directly so a
   `Coordinator` can drive it with no adapter class. `JobService` owns the draft (in-
   memory, pre-approval) → approve (materialize + persist) → run (background
   `Coordinator`, wired to a lazily-created "Orchestrator" system Agent for plan-
   drafting turns) → cancel lifecycle. Routes: `POST /api/jobs/draft`,
   `GET /api/jobs/drafts/:draftId`, `POST /api/jobs/drafts/:draftId/approve`,
   `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/messages`,
   `GET /api/jobs/:id/events`, `POST /api/jobs/:id/cancel`. 4 integration tests
   covering the full draft→approve→run→complete path, `"new"`-Agent materialization,
   one-Job-at-a-time enforcement, and clean cancellation.
   **Known limitation:** `cancelJob` is best-effort — it flips a flag the Coordinator
   checks between turns/batches, so it can't interrupt a turn already in flight
   (only that turn's own watchdog timeout can). Fine for the demo's abuse-case path;
   revisit if a snappier cancel is needed.
5. **UI** (`apps/web/src/`) — a Job screen: pick the cast, type a task, watch the
   transcript fill in with per-Agent attribution, surface halts/rejections/retries
   from the event log. Build against hand-written fixtures typed from
   `contracts.ts` first (a Job in each status, a mixed-role transcript, an event
   list with at least one rejection and one timeout); swap in real `api.*` calls
   once step 4 exists. Split `App.tsx` into components as part of this — 670 lines
   in one file is already unwieldy for one driver, let alone the next one picking
   up mid-shift.
   **Done** (built directly against the real API — `App.tsx` was already split
   into `components/` by the time this step started, so the fixture step above was
   skipped). New `components/job/{JobScreen,JobComposer,DraftReview,JobTranscript,
   JobStepIndicator,JobEventLog,JobStatusBadge}.tsx`, wired in as a second tab
   ("Playground" / "Jobs") at the top of `App.tsx`'s `<main>`, polling
   `GET /api/jobs/:id{,/messages,/events}` every 2s while a Job is pending/running.
   `DraftReview` is Approve-or-discard-and-redraft only — there's no backend
   endpoint yet for revising a draft by chat or reassigning a Step's cast via a
   picker (§5's "propose/discuss/revise"), so the UI doesn't pretend to offer that;
   it says so in-copy. Verified against a live `npm run dev` (no Ark key locally):
   agent CRUD/Playground regression-checked via `curl`, new Job routes checked the
   same way — no browser/Playwright available in this sandbox to screenshot with,
   so this was `curl`-verified rather than pixel-verified.
   **Bug found and fixed along the way, unrelated to the UI itself:**
   `app.ts`'s `setErrorHandler` was registered *after* an `await app.register(...)`
   call — with `createApp` never calling `app.ready()` itself, Fastify/avvio
   finalizes each awaited `register()`'s error-handler wiring immediately, so a
   `setErrorHandler` placed after one silently didn't apply to any route
   registered before it (i.e. nearly every route). They all fell back to Fastify's
   own default error shape — right status code, but the generic HTTP reason phrase
   instead of the actual message, and no Zod `details`. This affected the whole
   API, predates this session, and had gone uncaught because the existing test
   only asserted status codes, never the response body shape. Fixed by moving
   `setErrorHandler` before any `register()` call; regression test added in
   `app.test.ts`.
   `job-routes.ts`.

**No shared mount is needed.** The courier model (copy `needs`/`produces` through
staging) means Agent workspaces stay sealed and `container-codex-runner.ts` is
untouched. Isolation is a property of the filesystem, not a promise about behavior.

---

## 7. Rules for coding agents

Paste-ready, and the reason this file exists:

- **Do not modify files outside your assigned scope.** If a change is needed in someone
  else's file, stop and propose it — do not make it.
- Do not refactor, rename, or reformat code you were not asked to change.
- Do not add dependencies without asking.
- Scope each agent to its owner's directories. Do not point an agent at the whole repo.
- Preserve the baseline: Agent CRUD, lifecycle, Playground chat, persistence, and model
  execution must keep working. That is an explicit grading criterion.

---

## 8. Git workflow

**One driver at a time.** We're switching off three people running Claude Code
simultaneously. Instead: one person drives until they max out their usage limit,
then hands off to the next driver, iterating in shifts. Push whatever's green
before handing off — including a quick note on what you were mid-way through — so
the next driver starts from a clean `main` instead of reconstructing your state.

```
main (protected)
├── feat/<capability>
└── chore/<thing>
```

- Short-lived branches. Merge several times a day.
- Rebase on `main` before opening the PR, so conflicts are yours to fix.
- **Squash merge**, so `main` reads as one clean commit per capability. Reviewers will
  read our git log.
- **Self-merge once CI is green.** Blocking review kills hackathon pace. A teammate's
  two-minute skim is a bonus, not a gate.
- Commit subjects only, no long bodies. Rationale goes in the PR description.
- `git tag` a known-good state after the baseline passes and before anything risky.
- **Freeze `main` 4-6 hours before the demo.** Bug fixes only, merged deliberately. The
  classic failure is a "quick improvement" merged 30 minutes before demo that breaks the
  happy path — and 15% of the score is demo reproducibility.

CI runs `npm run check` on every push and PR to `main`. It is the gate that makes
self-merge safe.

---

## 9. What we are graded on

| Weight | Category |
|---|---|
| 40% | End-to-end middleware behavior — a real frontend→backend/runtime/data path with functional evidence |
| 25% | Technical design and integration — clear rationale, coherent boundary, extensible contracts |
| 20% | Verification and robustness — automated tests, error handling, cleanup, redaction, bypass resistance |
| 15% | Demo and reproducibility — concise demo, useful README, one-command startup, documented limitations |

Hard requirements: `npm run check` passes, no secret anywhere in source, history, logs,
traces, screenshots, or demo output. The middleware must execute in a backend, runtime,
data, or infrastructure path — a UI-only feature does not count.

We must demonstrate both a normal case **and** an appropriate failure, denial, degraded,
recovery, or abuse case. Design for that from the start; it is not something to bolt on
during Day 3.
