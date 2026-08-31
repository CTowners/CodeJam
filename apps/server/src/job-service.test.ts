import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import type { Job } from "./contracts.js";
import { JobService } from "./job-service.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

/** A JsonStore double whose mutate() starts failing after `failAfter` calls. */
class FlakyStore {
  private data: Record<string, unknown> = {
    version: 2,
    agents: [],
    messages: [],
    runs: [],
    jobs: [],
    jobMessages: [],
    events: [],
  };
  private calls = 0;

  constructor(private readonly failAfter: number) {}

  snapshot(): ReturnType<JsonStore["snapshot"]> {
    return structuredClone(this.data) as ReturnType<JsonStore["snapshot"]>;
  }

  async mutate<T>(mutation: (database: never) => T | Promise<T>): Promise<T> {
    this.calls += 1;
    if (this.calls > this.failAfter) {
      throw new Error("ENOENT: simulated disk failure");
    }
    const next = structuredClone(this.data);
    const result = await mutation(next as never);
    this.data = next;
    return result;
  }
}

const DRAFT_MARKER = "Respond with ONLY a single JSON object";

class ScriptedRunner implements AgentRunner {
  constructor(private readonly respond: (request: RunnerRequest) => Promise<RunnerResult> | RunnerResult) {}
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return this.respond(request);
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

// The Coordinator's cleanupWorkspaces() runs after a Job reaches its terminal
// status, so a test that stops polling the instant status flips "completed" can
// still race a background rm against this cleanup's own file removals — retry
// instead of treating that as a real failure.
async function rmWithRetry(directory: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rmWithRetry(directory)));
});

async function makeServices(
  runner: AgentRunner,
): Promise<{ agents: AgentService; jobs: JobService; store: JsonStore; config: AppConfig }> {
  const root = await mkdtemp(path.join(tmpdir(), "job-service-test-"));
  temporaryDirectories.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
  });
  const store = new JsonStore(path.join(root, "data", "db.json"));
  const agents = new AgentService(config, store, new WorkspaceManager(path.join(root, "workspaces")), runner);
  await agents.initialize();
  const jobs = new JobService(config, store, agents);
  return { agents, jobs, store, config };
}

describe("JobService", () => {
  it("drafts a Plan, approves it, runs the Coordinator, and persists messages/events", async () => {
    let implementerId = "";
    const runner = new ScriptedRunner((request) => {
      if (request.prompt.includes(DRAFT_MARKER)) {
        return {
          output: JSON.stringify({
            plan: {
              steps: [{ id: "s1", role: "implementer", instruction: "write it", needs: [], produces: [] }],
              contextMode: "none",
              source: "generated",
            },
            castByRole: { implementer: { kind: "existing", agentId: implementerId } },
          }),
          threadId: "orchestrator-thread",
          usage: null,
        };
      }
      return { output: "done", threadId: "impl-thread", usage: null };
    });

    const { agents, jobs } = await makeServices(runner);
    const implementer = await agents.createAgent({ name: "Implementer", instructions: "write code" });
    implementerId = implementer.id;

    const draft = await jobs.draftJob("Ship it", "add a feature");
    expect(draft.draft.castByRole.implementer).toEqual({ kind: "existing", agentId: implementerId });
    // drafting materializes a real, inspectable Orchestrator Agent
    expect(agents.listAgents().some((agent) => agent.name === "Orchestrator")).toBe(true);

    const job = await jobs.approveDraft(draft.draftId);
    // The background run may have already flipped this to "running" by the time
    // approveDraft returns (Coordinator.run's synchronous prefix, before its
    // first real await, can complete before control comes back here).
    expect(["pending", "running"]).toContain(job.status);
    expect(() => jobs.getDraft(draft.draftId)).toThrow(); // approval consumes the draft

    await expect.poll(() => jobs.getJob(job.id).status).toBe("completed");

    const messages = jobs.getJobMessages(job.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("done");
    expect(jobs.getJobEvents(job.id).map((event) => event.type)).toContain("job_completed");
  });

  it("materializes a \"new\" cast proposal into a real, inspectable Agent on approval", async () => {
    const runner = new ScriptedRunner((request) => {
      if (request.prompt.includes(DRAFT_MARKER)) {
        return {
          output: JSON.stringify({
            plan: {
              steps: [{ id: "s1", role: "implementer", instruction: "write it", needs: [], produces: [] }],
              contextMode: "none",
              source: "generated",
            },
            castByRole: { implementer: { kind: "new", name: "Fresh Implementer", instructions: "be fresh" } },
          }),
          threadId: "orchestrator-thread",
          usage: null,
        };
      }
      return { output: "done", threadId: "impl-thread", usage: null };
    });

    const { agents, jobs } = await makeServices(runner);
    const draft = await jobs.draftJob("Ship it", "add a feature");
    const job = await jobs.approveDraft(draft.draftId);

    const materialized = agents.listAgents().find((agent) => agent.name === "Fresh Implementer");
    expect(materialized).toBeDefined();
    expect(job.castByRole.implementer).toBe(materialized!.id);

    await expect.poll(() => jobs.getJob(job.id).status).toBe("completed");
  });

  it("refuses to approve a second draft while a Job is already running", async () => {
    let implementerId = "";
    let finishStepTurn!: (result: RunnerResult) => void;
    const stepTurnPending = new Promise<RunnerResult>((resolve) => {
      finishStepTurn = resolve;
    });
    const runner = new ScriptedRunner((request) => {
      if (request.prompt.includes(DRAFT_MARKER)) {
        return {
          output: JSON.stringify({
            plan: {
              steps: [{ id: "s1", role: "implementer", instruction: "write it", needs: [], produces: [] }],
              contextMode: "none",
              source: "generated",
            },
            castByRole: { implementer: { kind: "existing", agentId: implementerId } },
          }),
          threadId: "orchestrator-thread",
          usage: null,
        };
      }
      return stepTurnPending;
    });

    const { agents, jobs } = await makeServices(runner);
    implementerId = (await agents.createAgent({ name: "Implementer" })).id;

    const draft1 = await jobs.draftJob("Job 1", "task one");
    await jobs.approveDraft(draft1.draftId);
    await expect.poll(() => agents.getAgent(implementerId).status).toBe("busy");

    const draft2 = await jobs.draftJob("Job 2", "task two");
    await expect(jobs.approveDraft(draft2.draftId)).rejects.toMatchObject({ statusCode: 409 });

    finishStepTurn({ output: "done", threadId: "impl-thread", usage: null });
  });

  it("honors cancelJob, marking the Job halted cleanly instead of as a failure", async () => {
    let sharedAgentId = "";
    const runner = new ScriptedRunner((request) => {
      if (request.prompt.includes(DRAFT_MARKER)) {
        return {
          output: JSON.stringify({
            plan: {
              steps: [
                { id: "s1", role: "implementer", instruction: "write it", needs: [], produces: [] },
                { id: "s2", role: "tester", instruction: "test it", needs: [], produces: [] },
              ],
              contextMode: "none",
              source: "generated",
            },
            castByRole: {
              // Same Agent plays both roles, so the scheduler runs them one at a
              // time (at most one Step per Agent per batch) instead of together —
              // giving cancelJob a real between-Steps boundary to land in.
              implementer: { kind: "existing", agentId: sharedAgentId },
              tester: { kind: "existing", agentId: sharedAgentId },
            },
          }),
          threadId: "orchestrator-thread",
          usage: null,
        };
      }
      return { output: "ok", threadId: "thread", usage: null };
    });

    const { agents, jobs } = await makeServices(runner);
    sharedAgentId = (await agents.createAgent({ name: "Generalist" })).id;

    const draft = await jobs.draftJob("Ship it", "add and test a feature");
    const job = await jobs.approveDraft(draft.draftId);

    await jobs.cancelJob(job.id);

    await expect.poll(() => jobs.getJob(job.id).status).toBe("halted");
    expect(jobs.getJob(job.id).haltedReason).toBe("Cancelled by user");
  });

  it("enforces one-Job-at-a-time atomically, even when two approvals race with no window between them", async () => {
    let implementerId = "";
    let finishStepTurn!: (result: RunnerResult) => void;
    const stepTurnPending = new Promise<RunnerResult>((resolve) => {
      finishStepTurn = resolve;
    });
    const runner = new ScriptedRunner((request) => {
      if (request.prompt.includes(DRAFT_MARKER)) {
        return {
          output: JSON.stringify({
            plan: {
              steps: [{ id: "s1", role: "implementer", instruction: "write it", needs: [], produces: [] }],
              contextMode: "none",
              source: "generated",
            },
            castByRole: { implementer: { kind: "existing", agentId: implementerId } },
          }),
          threadId: "orchestrator-thread",
          usage: null,
        };
      }
      return stepTurnPending;
    });

    const { agents, jobs } = await makeServices(runner);
    implementerId = (await agents.createAgent({ name: "Implementer" })).id;

    const draft1 = await jobs.draftJob("Job 1", "task one");
    const draft2 = await jobs.draftJob("Job 2", "task two");

    // Fired with no await between them — this is exactly the window the old
    // check-then-reserve-later code left open.
    const [result1, result2] = await Promise.allSettled([
      jobs.approveDraft(draft1.draftId),
      jobs.approveDraft(draft2.draftId),
    ]);

    const fulfilled = [result1, result2].filter(
      (result): result is PromiseFulfilledResult<Job> => result.status === "fulfilled",
    );
    const rejected = [result1, result2].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 409 });

    finishStepTurn({ output: "done", threadId: "impl-thread", usage: null });
    await expect.poll(() => jobs.getJob(fulfilled[0]!.value.id).status).toBe("completed");
  });

  it("reconciles a Job left pending/running by a server crash, on initialize()", async () => {
    const { agents, store, config } = await makeServices(new ScriptedRunner(() => ({ output: "unused", threadId: null, usage: null })));
    const implementerId = (await agents.createAgent({ name: "Implementer" })).id;

    const stuckJob: Job = {
      id: "stuck-job",
      name: "Stuck",
      task: "do something",
      castByRole: { implementer: implementerId },
      plan: {
        steps: [{ id: "s1", role: "implementer", instruction: "x", needs: [], produces: [] }],
        contextMode: "none",
        source: "builtin",
      },
      status: "running",
      cursor: 0,
      haltedReason: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    await store.mutate((database) => {
      database.jobs.push(stuckJob);
    });

    // A restart is a new process — a fresh JobService over the same store.
    const jobsAfterRestart = new JobService(config, store, agents);
    await jobsAfterRestart.initialize();

    const reconciled = jobsAfterRestart.getJob("stuck-job");
    expect(reconciled.status).toBe("halted");
    expect(reconciled.haltedReason).toMatch(/restart/i);
    expect(jobsAfterRestart.getJobEvents("stuck-job").map((event) => event.type)).toContain("job_halted");
  });

  it("creates only one Orchestrator Agent even when draftJob is called concurrently before it exists", async () => {
    const runner = new ScriptedRunner(() => ({
      output: JSON.stringify({
        plan: {
          steps: [{ id: "s1", role: "a", instruction: "x", needs: [], produces: [] }],
          contextMode: "none",
          source: "generated",
        },
        castByRole: { a: { kind: "existing", agentId: "agent-1" } },
      }),
      threadId: "t",
      usage: null,
    }));
    const { agents, jobs } = await makeServices(runner);

    // Concurrent drafts against the same real orchestrator Agent will correctly
    // collide at AgentService's own one-turn-per-Agent busy check ("This Agent is
    // already running a turn") — that's a separate, already-fixed guard, not what
    // this test is about. allSettled so that expected collision doesn't hide the
    // one thing being checked here: at most one Orchestrator Agent ever gets created.
    await Promise.allSettled([
      jobs.draftJob("Job 1", "task one"),
      jobs.draftJob("Job 2", "task two"),
      jobs.draftJob("Job 3", "task three"),
    ]);

    const orchestrators = agents.listAgents().filter((agent) => agent.name === "Orchestrator");
    expect(orchestrators).toHaveLength(1);
  });

  it("keeps running instead of crashing when persisting live progress fails", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const root = await mkdtemp(path.join(tmpdir(), "job-service-flaky-"));
      temporaryDirectories.push(root);
      let implementerId = "";
      const runner = new ScriptedRunner((request) => {
        if (request.prompt.includes(DRAFT_MARKER)) {
          return {
            output: JSON.stringify({
              plan: {
                steps: [{ id: "s1", role: "implementer", instruction: "write it", needs: [], produces: [] }],
                contextMode: "none",
                source: "generated",
              },
              castByRole: { implementer: { kind: "existing", agentId: implementerId } },
            }),
            threadId: "orchestrator-thread",
            usage: null,
          };
        }
        return { output: "done", threadId: "impl-thread", usage: null };
      });

      const config = loadConfig({
        NODE_ENV: "test",
        APP_DATA_DIR: path.join(root, "data"),
        AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
        CODEX_HOME: path.join(root, "codex"),
        ARK_API_KEY: "test-key",
        ARK_MODEL: "ep-test",
      });
      const agents = new AgentService(
        config,
        new JsonStore(path.join(root, "data", "db.json")),
        new WorkspaceManager(path.join(root, "workspaces")),
        runner,
      );
      await agents.initialize();
      implementerId = (await agents.createAgent({ name: "Implementer" })).id;

      // Succeeds once (the initial Job row push inside approveDraft), then always
      // fails — reproducing exactly the reported crash: live-progress persistence
      // (onEvent/onMessage/onJobUpdate) hitting a broken disk mid-run.
      const flakyStore = new FlakyStore(1);
      const jobs = new JobService(config, flakyStore as unknown as JsonStore, agents);

      const draft = await jobs.draftJob("Ship it", "add a feature");
      await jobs.approveDraft(draft.draftId);

      // Give the background Coordinator time to run and hit the flaky persistence.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(unhandledRejections).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      consoleErrorSpy.mockRestore();
    }
  });
});
