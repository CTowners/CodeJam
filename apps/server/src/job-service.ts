import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentService } from "./agent-service.js";
import { Coordinator } from "./coordinator/coordinator.js";
import { FileCourier } from "./coordinator/file-courier.js";
import type { AppConfig } from "./config.js";
import type { CoordinationEvent, DraftedPlan, Job, JobMessage } from "./contracts.js";
import { COORDINATION_LIMITS } from "./contracts.js";
import { HttpError } from "./errors.js";
import { buildJobFromDraft, materializeCast } from "./orchestrator/materialize.js";
import { ModelPlanDrafter } from "./orchestrator/model-plan-drafter.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import type { JsonStore } from "./store.js";

const ORCHESTRATOR_AGENT_NAME = "Orchestrator";
const ORCHESTRATOR_INSTRUCTIONS = [
  "You draft Plans for the Coordinator to execute — you never touch files or run",
  "code yourself. Given a task and a list of candidate Agents (each with an id,",
  "name, and capabilitySummary), respond with a Plan and a proposed cast, in the",
  "exact JSON shape you're given in each prompt. Nothing else.",
].join(" ");

export interface JobDraft {
  draftId: string;
  name: string;
  task: string;
  draft: DraftedPlan;
  createdAt: string;
}

const now = () => new Date().toISOString();

/**
 * Owns the Job lifecycle: draft (Orchestrator) -> approve (materialize + persist)
 * -> run (Coordinator) -> cancel. Drafts are in-memory only — nothing is committed
 * until approval, so a server restart before that just means re-drafting; the Job
 * itself, once approved, is what's persisted (AGENTS.md §5/§6).
 */
export class JobService {
  private readonly drafts = new Map<string, JobDraft>();
  private readonly runningJobs = new Map<string, { requestCancel: () => void }>();
  private orchestratorAgentId: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly agents: AgentService,
  ) {}

  listJobs(): Job[] {
    return this.store.snapshot().jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  getJob(id: string): Job {
    const job = this.store.snapshot().jobs.find((item) => item.id === id);
    if (!job) {
      throw new HttpError(404, "Job not found");
    }
    return job;
  }

  getJobMessages(jobId: string): JobMessage[] {
    this.getJob(jobId);
    return this.store
      .snapshot()
      .jobMessages.filter((message) => message.jobId === jobId)
      .sort((left, right) => left.turn - right.turn);
  }

  getJobEvents(jobId: string): CoordinationEvent[] {
    this.getJob(jobId);
    return this.store
      .snapshot()
      .events.filter((event) => event.jobId === jobId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getDraft(draftId: string): JobDraft {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new HttpError(404, "Draft not found");
    }
    return draft;
  }

  async draftJob(name: string, task: string): Promise<JobDraft> {
    const orchestratorAgentId = await this.getOrchestratorAgentId();
    const orchestrator = new Orchestrator(new ModelPlanDrafter(this.agents, orchestratorAgentId));
    const candidates = this.agents
      .listAgents()
      .filter((agent) => agent.id !== orchestratorAgentId)
      .map((agent) => ({ id: agent.id, name: agent.name, capabilitySummary: agent.capabilitySummary }));

    const draft = await orchestrator.draftPlan(task, candidates);
    const jobDraft: JobDraft = { draftId: randomUUID(), name, task, draft, createdAt: now() };
    this.drafts.set(jobDraft.draftId, jobDraft);
    return jobDraft;
  }

  async approveDraft(draftId: string): Promise<Job> {
    if (this.runningJobs.size >= COORDINATION_LIMITS.maxConcurrentJobs) {
      throw new HttpError(409, "A Job is already running — only one runs at a time");
    }
    const pending = this.getDraft(draftId);
    const castByRole = await materializeCast(pending.draft, this.agents);
    const job = buildJobFromDraft(pending.name, pending.task, pending.draft, castByRole);

    await this.store.mutate((database) => {
      database.jobs.push(job);
    });
    this.drafts.delete(draftId);
    this.startRun(job);
    return job;
  }

  /**
   * Best-effort: flips the flag Coordinator checks between turns/batches, so
   * cancellation takes effect at the next natural boundary rather than
   * interrupting a turn already in flight (AgentService's own runTurn watchdog is
   * what can actually cut an in-flight turn short, on its own timeout).
   */
  async cancelJob(jobId: string): Promise<Job> {
    const running = this.runningJobs.get(jobId);
    if (running) {
      running.requestCancel();
    }
    return this.getJob(jobId);
  }

  private startRun(job: Job): void {
    const stagingDir = path.join(this.config.dataDirectory, "jobs", job.id, "staging");
    const courier = new FileCourier(stagingDir);
    let cancelRequested = false;
    this.runningJobs.set(job.id, { requestCancel: () => (cancelRequested = true) });

    const coordinator = new Coordinator(
      {
        runner: this.agents,
        courier,
        workspacePathForAgent: (agentId) => this.agents.getAgent(agentId).workspacePath,
      },
      {
        shouldCancel: () => cancelRequested,
        onEvent: (event) => void this.store.mutate((database) => database.events.push(event)),
        onMessage: (message) => void this.store.mutate((database) => database.jobMessages.push(message)),
        onJobUpdate: (updated) =>
          void this.store.mutate((database) => {
            const index = database.jobs.findIndex((item) => item.id === updated.id);
            if (index >= 0) database.jobs[index] = structuredClone(updated);
          }),
      },
    );

    void coordinator.run(job).finally(() => {
      this.runningJobs.delete(job.id);
    });
  }

  private async getOrchestratorAgentId(): Promise<string> {
    if (this.orchestratorAgentId) {
      return this.orchestratorAgentId;
    }
    const existing = this.agents.listAgents().find((agent) => agent.name === ORCHESTRATOR_AGENT_NAME);
    if (existing) {
      this.orchestratorAgentId = existing.id;
      return existing.id;
    }
    const created = await this.agents.createAgent({
      name: ORCHESTRATOR_AGENT_NAME,
      description: "System Agent that drafts Plans for Jobs. Created automatically — do not delete.",
      instructions: ORCHESTRATOR_INSTRUCTIONS,
    });
    this.orchestratorAgentId = created.id;
    return created.id;
  }
}
