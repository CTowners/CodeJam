import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentService } from "./agent-service.js";
import { Coordinator } from "./coordinator/coordinator.js";
import { FileCourier } from "./coordinator/file-courier.js";
import { validatePlan } from "./coordinator/plan-validation.js";
import type { AppConfig } from "./config.js";
import type { CoordinationEvent, DraftedPlan, Job, JobMessage } from "./contracts.js";
import { COORDINATION_LIMITS } from "./contracts.js";
import { HttpError } from "./errors.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import type { JsonStore } from "./store.js";
import type { Database } from "./types.js";

const now = () => new Date().toISOString();

const logFailure = (context: string, error: unknown): void => {
  console.error(`[JobService] ${context}:`, error);
};

/**
 * Owns the Job lifecycle: approve (materialize + persist) -> run (Coordinator)
 * -> cancel. Drafting itself now happens as an ordinary chat turn against an
 * orchestrator-kind Agent — the model decides on its own when to emit the
 * JSON plan — this service only takes over once a plan already exists and
 * the user has approved it.
 */
export class JobService {
  /** jobId -> cancel handle, populated once a Job's Job row (and id) exists. */
  private readonly cancelHandles = new Map<string, () => void>();
  /**
   * The one-Job-at-a-time gate. Reserved synchronously in approvePlan, before
   * any await — the same atomic check-and-flip AgentService.runTurn uses for its
   * own busy check, so two approvals fired close together can't both pass the
   * check before either reserves its slot.
   */
  private runningCount = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly agents: AgentService,
  ) {}

  /** Reconciles Jobs left "pending"/"running" by a server crash — mirrors AgentService.initialize(). */
  async initialize(): Promise<void> {
    await this.store.mutate((database) => {
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

  /**
   * Takes an already-drafted (client-parsed, server-revalidated-via-approve)
   * plan directly, rather than looking one up by id — the plan came from a
   * chat turn, not a stored server-side draft.
   */
  async approvePlan(name: string, task: string, draft: DraftedPlan): Promise<Job> {
    const planErrors = validatePlan(draft.plan);
    if (planErrors.length > 0) {
      throw new HttpError(400, `Invalid plan: ${planErrors.join("; ")}`);
    }
    if (this.runningCount >= COORDINATION_LIMITS.maxConcurrentJobs) {
      throw new HttpError(409, "A Job is already running — only one runs at a time");
    }
    // Reserve the slot now, synchronously, before any await below — this is the
    // whole fix: nothing here can interleave with another approvePlan() call
    // until we actually yield, so the check-then-reserve above is atomic.
    this.runningCount += 1;
    try {
      const job = await Orchestrator.approve(name, task, draft, this.agents);

      await this.store.mutate((database) => {
        database.jobs.push(job);
      });
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
        workspacePathForAgent: (agentId) => this.agents.getAgent(agentId).workspacePath,
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
}
