import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { JobService } from "./job-service.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

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

async function makeServices(runner: AgentRunner): Promise<{ agents: AgentService; jobs: JobService }> {
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
  return { agents, jobs };
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
});
