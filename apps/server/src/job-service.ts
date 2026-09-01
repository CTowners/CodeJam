import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentService } from "./agent-service.js";
import { Coordinator } from "./coordinator/coordinator.js";
import { FileCourier } from "./coordinator/file-courier.js";
import type { AppConfig } from "./config.js";
import type { CoordinationEvent, DraftedPlan, Job, JobMessage } from "./contracts.js";
import { COORDINATION_LIMITS } from "./contracts.js";
import { HttpError } from "./errors.js";
import { ModelPlanDrafter } from "./orchestrator/model-plan-drafter.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { buildRevisionGuidance } from "./orchestrator/prompt.js";
import type { JsonStore } from "./store.js";
import { CHAT_AGENT_NAME, CHAT_INSTRUCTIONS } from "./agent-kinds.js";
import type { Database } from "./types.js";

export interface JobDraft {
  draftId: string;
  /** The chat that asked. Carried through approval so the Job and its workers nest under it. */
  chatId: string;
  name: string;
  task: string;
  /**
   * Which of Your Agents the user allowed for this Job, or null for "all of
   * them". Kept on the draft so a revision re-casts from the same pool instead of
   * quietly re-admitting an Agent the user deselected.
   */
  agentIds: string[] | null;
  /** 0 for the first draft, incremented per revision — the UI's proof a re-draft landed. */
  revision: number;
  draft: DraftedPlan;
  createdAt: string;
}

const now = () => new Date().toISOString();

const logFailure = (context: string, error: unknown): void => {
  console.error(`[JobService] ${context}:`, error);
};

/**
 * Owns the Job lifecycle: draft (Orchestrator) -> approve (materialize + persist)
 * -> run (Coordinator) -> cancel. Drafts are in-memory only — nothing is committed
 * until approval, so a server restart before that just means re-drafting; the Job
 * itself, once approved, is what's persisted (AGENTS.md §5/§6).
 */
export class JobService {
  private readonly drafts = new Map<string, JobDraft>();
  /** jobId -> cancel handle, populated once a Job's Job row (and id) exists. */
  private readonly cancelHandles = new Map<string, () => void>();
  /**
   * The one-Job-at-a-time gate. Reserved synchronously in approveDraft, before
   * any await — the same atomic check-and-flip AgentService.runTurn uses for its
   * own busy check, so two approvals fired close together can't both pass the
   * check before either reserves its slot.
   */
  private runningCount = 0;
  /**
   * Memoized in-flight promise, not just the resolved id: two concurrent
   * draftJob() calls before the Orchestrator Agent exists yet must share the
   * same creation attempt, or both can independently decide it's missing and
   * each create their own.
   */
  private orchestratorAgentIdPromise: Promise<string> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly agents: AgentService,
  ) {}

  /** Reconciles Jobs left "pending"/"running" by a server crash — mirrors AgentService.initialize(). */
  async initialize(): Promise<void> {
    await this.store.mutate((database) => {
      // Jobs migrated from a schema without chatId, at a time when no chat agent
      // existed, carry an empty chatId that no Agent will ever match. Adopt them
      // into a chat once one exists, so they still nest instead of vanishing.
      const chat = database.agents.find((agent) => agent.kind === "chat");
      if (chat) {
        for (const job of database.jobs) {
          if (!job.chatId) job.chatId = chat.id;
        }
      }
      for (const job of database.jobs) {
        if (job.status === "pending" || job.status === "running") {
          job.status = "halted";
          job.haltedReason = "Server restarted while this Job was active";
          database.events.push({
            id: randomUUID(),
            jobId: job.id,
            type: "job_halted",
            stepId: null,
            agentId: null,
            turn: job.cursor,
            detail: job.haltedReason,
            createdAt: now(),
          });
        }
      }
    });
  }

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

  /**
   * Only templates are castable: they are the reusable role definitions. Chats
   * drive the work rather than doing it, and workers belong to a Job already.
   * `agentIds` narrows that further to the ones the user left selected.
   */
  private castableCandidates(agentIds: string[] | null) {
    const allowed = agentIds ? new Set(agentIds) : null;
    return this.agents
      .listAgents()
      .filter((agent) => agent.kind === "template")
      .filter((agent) => !allowed || allowed.has(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.name, capabilitySummary: agent.capabilitySummary }));
  }

  async draftJob(name: string, task: string, chatId?: string, agentIds?: string[]): Promise<JobDraft> {
    // A specific chat asked, or fall back to the default one. Validating the kind
    // here stops a template or worker id being passed off as a chat.
    const chatAgentId = chatId ? this.requireChat(chatId) : await this.getChatAgentId();
    const orchestrator = new Orchestrator(new ModelPlanDrafter(this.agents, chatAgentId));
    const allowed = agentIds && agentIds.length > 0 ? agentIds : null;

    const draft = await orchestrator.draftPlan(task, this.castableCandidates(allowed));
    const jobDraft: JobDraft = {
      draftId: randomUUID(),
      chatId: chatAgentId,
      name,
      task,
      agentIds: allowed,
      revision: 0,
      draft,
      createdAt: now(),
    };
    this.drafts.set(jobDraft.draftId, jobDraft);
    return jobDraft;
  }

  /**
   * Re-drafts a pending draft with the user's feedback, replacing it in place so
   * the draft id stays stable across as many rounds as the user wants. Still just
   * a draft: nothing is created until approval, so revising is free.
   */
  async reviseDraft(draftId: string, feedback: string): Promise<JobDraft> {
    const pending = this.getDraft(draftId);
    const orchestrator = new Orchestrator(new ModelPlanDrafter(this.agents, pending.chatId));
    const revised = await orchestrator.draftPlan(
      pending.task,
      this.castableCandidates(pending.agentIds),
      buildRevisionGuidance(pending.draft, feedback),
    );
    const next: JobDraft = {
      ...pending,
      draft: revised,
      revision: pending.revision + 1,
      createdAt: now(),
    };
    this.drafts.set(draftId, next);
    return next;
  }

  async approveDraft(draftId: string): Promise<Job> {
    if (this.runningCount >= COORDINATION_LIMITS.maxConcurrentJobs) {
      throw new HttpError(409, "A Job is already running — only one runs at a time");
    }
    // Reserve the slot now, synchronously, before any await below — this is the
    // whole fix: nothing here can interleave with another approveDraft() call
    // until we actually yield, so the check-then-reserve above is atomic.
    this.runningCount += 1;
    try {
      const pending = this.getDraft(draftId);
      const job = await Orchestrator.approve(
        pending.name,
        pending.task,
        pending.draft,
        this.agents,
        pending.chatId,
      );

      await this.store.mutate((database) => {
        database.jobs.push(job);
      });
      this.drafts.delete(draftId);
      this.startRun(job);
      return job;
    } catch (error) {
      this.runningCount -= 1; // never actually started a run — release the slot
      throw error;
    }
  }

  /**
   * Best-effort: flips the flag Coordinator checks between turns/batches, so
   * cancellation takes effect at the next natural boundary rather than
   * interrupting a turn already in flight (AgentService's own runTurn watchdog is
   * what can actually cut an in-flight turn short, on its own timeout).
   */
  async cancelJob(jobId: string): Promise<Job> {
    const cancel = this.cancelHandles.get(jobId);
    if (cancel) {
      cancel();
    }
    return this.getJob(jobId);
  }

  private startRun(job: Job): void {
    const stagingDir = path.join(this.config.dataDirectory, "jobs", job.id, "staging");
    const courier = new FileCourier(stagingDir);
    let cancelRequested = false;
    this.cancelHandles.set(job.id, () => (cancelRequested = true));

    // Every store write here is fire-and-forget from the Coordinator's side (it
    // doesn't await these callbacks) — each one gets its own .catch() so a
    // transient disk error logs instead of becoming an unhandled rejection that
    // takes down the whole process.
    const persist = (mutation: (database: Database) => void): void => {
      this.store.mutate(mutation).catch((error) => logFailure(`failed to persist an update for Job ${job.id}`, error));
    };

    const coordinator = new Coordinator(
      {
        runner: this.agents,
        courier,
        workspacePathForAgent: (agentId) => {
          // Every Agent a Plan casts is a worker, and workers always own a
          // directory — a null here means a template was cast directly, which
          // materializeCast is supposed to have already turned into a worker.
          const { name, workspacePath } = this.agents.getAgent(agentId);
          if (!workspacePath) {
            throw new Error(`Agent "${name}" has no workspace — a template was cast without spawning a worker`);
          }
          return workspacePath;
        },
      },
      {
        shouldCancel: () => cancelRequested,
        onEvent: (event) => persist((database) => void database.events.push(event)),
        onMessage: (message) => persist((database) => void database.jobMessages.push(message)),
        onJobUpdate: (updated) =>
          persist((database) => {
            const index = database.jobs.findIndex((item) => item.id === updated.id);
            if (index >= 0) database.jobs[index] = structuredClone(updated);
          }),
      },
    );

    coordinator
      .run(job)
      .catch((error) => {
        // Coordinator.run() is hardened to classify failures rather than throw,
        // but if something still escapes it (a bug, an OOM, whatever), a Job
        // must never stay stuck "running" forever with no explanation.
        logFailure(`Coordinator crashed for Job ${job.id}`, error);
        const haltedReason = `Coordinator crashed: ${error instanceof Error ? error.message : String(error)}`;
        return this.store
          .mutate((database) => {
            const stored = database.jobs.find((item) => item.id === job.id);
            if (stored && (stored.status === "pending" || stored.status === "running")) {
              stored.status = "halted";
              stored.haltedReason = haltedReason;
              database.events.push({
                id: randomUUID(),
                jobId: job.id,
                type: "job_halted",
                stepId: null,
                agentId: null,
                turn: stored.cursor,
                detail: haltedReason,
                createdAt: now(),
              });
            }
          })
          .catch((persistError) => logFailure(`failed to persist crash-halt for Job ${job.id}`, persistError));
      })
      .finally(() => {
        this.cancelHandles.delete(job.id);
        this.runningCount -= 1;
      });
  }

  /** Rejects an id that is not a chat, so drafting can't be aimed at a template or worker. */
  private requireChat(chatId: string): string {
    const agent = this.agents.getAgent(chatId);
    if (agent.kind !== "chat") {
      throw new HttpError(400, `"${agent.name}" is not a Chat — only a Chat can plan work.`);
    }
    return agent.id;
  }

  private getChatAgentId(): Promise<string> {
    if (!this.orchestratorAgentIdPromise) {
      this.orchestratorAgentIdPromise = (async () => {
        const existing = this.agents.listAgents().find((agent) => agent.kind === "chat");
        if (existing) return existing.id;
        const created = await this.agents.createAgent({
          name: CHAT_AGENT_NAME,
          description: "Where you ask for work. Plans it, and fans it out to Agents.",
          instructions: CHAT_INSTRUCTIONS,
          kind: "chat",
        });
        return created.id;
      })().catch((error: unknown) => {
        // A rejected promise is still a settled promise — left in place, every
        // future draftJob() call would reuse and re-await this same permanent
        // failure. Clear it so a transient creation failure (disk, workspace I/O)
        // gets a fresh attempt next time instead of poisoning the feature until
        // a server restart.
        this.orchestratorAgentIdPromise = null;
        throw error;
      });
    }
    return this.orchestratorAgentIdPromise;
  }
}
