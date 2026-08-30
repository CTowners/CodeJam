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

## 5. File ownership

Three people. Direction: **multi-Agent coordination** — a standing team of role-based
Agents, orchestrated by a plain-code Coordinator. See `apps/server/src/contracts.ts`
for the shared vocabulary; everything below is built against those types.

| Person | Owns | Builds |
|---|---|---|
| **Ron** (spine) | `contracts.ts`, `types.ts`, `store.ts`, `agent-service.ts`, `workspace.ts`, `app.ts` | Shared types. Store v2 + migration. `runTurn()` (send-and-wait) and `resetMemory()` on AgentService. The file courier — copy `needs` in before a turn, `produces` out after. Registers others' route plugins. Integration and merges. |
| **_name_** (coordinator) | `coordinator/` *(new dir)* and its tests | The Coordinator loop: turn order, reply checks against `replyPattern`, verifying `produces` files appeared, timeout, retry, halt. Plan validation and conflict detection. Parallel scheduling for independent steps. |
| **_name_** (surface) | `job-routes.ts` *(new)*, all `apps/web/src/`, `README.md`, `.github/` | Routes as a Fastify plugin Ron mounts in one line. Job screen: pick the cast, type a task, watch the transcript fill in with per-Agent attribution. README, architecture diagram, demo script. |

**Build the Coordinator against a fake `TurnRunner`.** `contracts.ts` defines it as an
injected interface precisely so the entire Coordinator can be unit tested with canned
replies — no Ark key, no Docker, milliseconds per test. That work is unblocked the
moment `contracts.ts` lands, and it is where most of the verification score lives.

**No shared mount is needed.** We chose the courier model over a common `/shared`
directory, so Agent workspaces stay sealed and `container-codex-runner.ts` is untouched.
Isolation is a property of the filesystem rather than a promise about behaviour.

We assign **files, not features.** Coding agents do not respect the module boundaries
in our heads — ask one to "add audit logging" and it will happily refactor
`agent-service.ts` and rename a function three people are calling. Two agents editing
overlapping files produce conflicts neither human wrote and neither can resolve
quickly.

Whoever owns `apps/web/` should split `App.tsx` into components before anything else.
At 670 lines in one component, any second person touching the UI collides.

---

## 6. Rules for coding agents

Paste-ready, and the reason this file exists:

- **Do not modify files outside your assigned scope.** If a change is needed in someone
  else's file, stop and propose it — do not make it.
- Do not refactor, rename, or reformat code you were not asked to change.
- Do not add dependencies without asking.
- Scope each agent to its owner's directories. Do not point an agent at the whole repo.
- Preserve the baseline: Agent CRUD, lifecycle, Playground chat, persistence, and model
  execution must keep working. That is an explicit grading criterion.

---

## 7. Git workflow

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

## 8. What we are graded on

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
