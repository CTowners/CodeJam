import { randomUUID } from "node:crypto";
import type {
  CoordinationEvent,
  CoordinationEventType,
  Job,
  JobMessage,
  PlanStep,
  StepStatus,
  TurnRunner,
} from "../contracts.js";
import { COORDINATION_LIMITS } from "../contracts.js";
import { classifyFailure, isTimeout } from "./failure-classifier.js";
import type { FileCourier } from "./file-courier.js";
import { sameAgentConflicts, validatePlan } from "./plan-validation.js";
import { matchesReplyPattern } from "./reply-check.js";
import { readySteps } from "./scheduler.js";

export interface CoordinatorDeps {
  runner: TurnRunner;
  courier: FileCourier;
  workspacePathForAgent: (agentId: string) => string;
}

export interface CoordinatorOptions {
  now?: () => string;
  /** Backoff before a transient-cause retry. Tests should pass () => 0. */
  backoffMs?: (attempt: number) => number;
  /** Checked before each turn starts; lets an external cancel request take effect mid-Job. */
  shouldCancel?: () => boolean;
  /**
   * Fired as each event/message is produced and whenever the Job's own status
   * changes, in addition to being collected into the arrays `run()` returns at
   * the end — this is what lets a caller persist/stream progress for a Job that's
   * still running, instead of waiting for the whole thing to finish. Fire-and-forget:
   * not awaited, so a crash between a callback firing and its write landing can
   * drop the very latest one — acceptable here since staging files and the Job's
   * own state (not this audit trail) are what a restart needs to recover from.
   */
  onEvent?: (event: CoordinationEvent) => void;
  onMessage?: (message: JobMessage) => void;
  onJobUpdate?: (job: Job) => void;
}

export interface CoordinatorResult {
  job: Job;
  messages: JobMessage[];
  events: CoordinationEvent[];
}

const delay = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * Executes an approved Plan step by step. Plain code — every decision below is a
 * lookup or a regex match against a raw signal, never a judgement call. See
 * AGENTS.md §5 for the design this implements.
 */
export class Coordinator {
  private readonly now: () => string;
  private readonly backoffMs: (attempt: number) => number;
  private readonly shouldCancel: () => boolean;
  private readonly onEvent: (event: CoordinationEvent) => void;
  private readonly onMessage: (message: JobMessage) => void;
  private readonly onJobUpdate: (job: Job) => void;

  constructor(
    private readonly deps: CoordinatorDeps,
    options: CoordinatorOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.backoffMs = options.backoffMs ?? ((attempt) => Math.min(1000 * 2 ** (attempt - 1), 5000));
    this.shouldCancel = options.shouldCancel ?? (() => false);
    this.onEvent = options.onEvent ?? (() => undefined);
    this.onMessage = options.onMessage ?? (() => undefined);
    this.onJobUpdate = options.onJobUpdate ?? (() => undefined);
  }

  async run(job: Job): Promise<CoordinatorResult> {
    const plan = job.plan;
    const events: CoordinationEvent[] = [];
    const messages: JobMessage[] = [];
    const stepStatus = new Map<string, StepStatus>(plan.steps.map((step) => [step.id, "pending"]));
    const workspaceCopies = new Map<string, Set<string>>();
    let turn = 0;
    let halted = false;

    const emit = (
      type: CoordinationEventType,
      stepId: string | null,
      agentId: string | null,
      detail: string | null,
    ): void => {
      const event: CoordinationEvent = {
        id: randomUUID(),
        jobId: job.id,
        type,
        stepId,
        agentId,
        turn,
        detail,
        createdAt: this.now(),
      };
      events.push(event);
      this.onEvent(event);
    };

    const halt = (reason: string, stepId: string | null, agentId: string | null): void => {
      if (halted) return;
      halted = true;
      job.status = "halted";
      job.haltedReason = reason;
      this.onJobUpdate(job);
      emit("job_halted", stepId, agentId, reason);
    };

    const validationErrors = validatePlan(plan);
    if (validationErrors.length > 0) {
      halt(`Invalid plan: ${validationErrors.join("; ")}`, null, null);
      return { job, messages, events };
    }

    job.status = "running";
    this.onJobUpdate(job);
    // Not fatal — the batch scheduler already serializes these — but silently
    // losing parallelism a Plan's shape implies is worth a visible note.
    const conflictNotes = sameAgentConflicts(plan, job.castByRole);
    emit("job_started", null, null, conflictNotes.length > 0 ? conflictNotes.join(" ") : null);

    const pushMessage = (step: PlanStep, agentId: string, content: string): void => {
      const message = this.toMessage(job, step, agentId, turn, content);
      messages.push(message);
      this.onMessage(message);
    };

    const trackCopy = (agentId: string, paths: readonly string[]): void => {
      const set = workspaceCopies.get(agentId) ?? new Set<string>();
      for (const path of paths) set.add(path);
      workspaceCopies.set(agentId, set);
    };

    /**
     * A monotonic progress counter — how many Steps have reached a terminal
     * state (completed/rejected/skipped/timeout) — not an index, since Steps
     * can run in parallel and there's no single "current" one.
     */
    const finishStep = (step: PlanStep, status: StepStatus): void => {
      stepStatus.set(step.id, status);
      job.cursor += 1;
      this.onJobUpdate(job);
    };

    const runStep = async (step: PlanStep): Promise<void> => {
      const agentId = job.castByRole[step.role];
      if (!agentId) {
        finishStep(step, "rejected");
        halt(`No Agent cast for role "${step.role}"`, step.id, null);
        return;
      }
      let attempt = 0;

      while (!halted) {
        if (this.shouldCancel()) {
          finishStep(step, "skipped");
          halt("Cancelled by user", step.id, agentId);
          return;
        }
        attempt += 1;
        turn += 1;
        emit("turn_started", step.id, agentId, null);

        // Everything from resolving the Agent's workspace through the runner
        // turn itself is one raw-error surface: a stale/deleted Agent id, a
        // courier copy-in failure, or the runner throwing are all just signals
        // to classify, never a reason to let this Job's promise reject outright
        // (that would crash whatever awaits it instead of halting cleanly).
        let result: { ok: true; reply: string } | { ok: false; error: string };
        try {
          const workspaceDir = this.deps.workspacePathForAgent(agentId);
          if (step.needs.length > 0) {
            await this.deps.courier.copyIn(step.needs, workspaceDir);
            trackCopy(agentId, step.needs);
            emit("files_copied_in", step.id, agentId, step.needs.join(", "));
          }
          const prompt = this.buildPrompt(step, job, messages);
          const turnResult = await this.deps.runner.runTurn(agentId, prompt, COORDINATION_LIMITS.turnTimeoutMs);
          result = turnResult.ok ? { ok: true, reply: turnResult.reply } : { ok: false, error: turnResult.error ?? "Unknown error" };
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }

        if (result.ok) {
          // Verifying produces and copying them out can themselves fail (e.g. a
          // courier I/O error) — fold that into the same "reason" a failed check
          // would produce, rather than letting it escape uncaught.
          let reason: string | null;
          try {
            const workspaceDir = this.deps.workspacePathForAgent(agentId);
            const problem = await this.deps.courier.verifyProduces(step.produces, workspaceDir);
            const replyOk = matchesReplyPattern(result.reply, step.replyPattern);
            reason = problem ?? (replyOk ? null : `reply did not match pattern /${step.replyPattern}/`);
            if (!reason && step.produces.length > 0) {
              await this.deps.courier.copyOut(step.produces, workspaceDir);
              emit("files_copied_out", step.id, agentId, step.produces.join(", "));
            }
          } catch (error) {
            reason = error instanceof Error ? error.message : String(error);
          }

          if (!reason) {
            pushMessage(step, agentId, result.reply);
            emit("turn_completed", step.id, agentId, null);
            finishStep(step, "completed");
            return;
          }
          pushMessage(step, agentId, result.reply);
          emit("turn_rejected", step.id, agentId, reason);
          if (attempt > COORDINATION_LIMITS.maxRetriesPerStep) {
            finishStep(step, "rejected");
            halt(`Step "${step.id}" exhausted retries (validation): ${reason}`, step.id, agentId);
            return;
          }
          emit("turn_retried", step.id, agentId, reason);
          continue;
        }

        const errorMessage = result.error;
        const cause = classifyFailure(errorMessage);
        emit(isTimeout(errorMessage) ? "turn_timeout" : "turn_rejected", step.id, agentId, errorMessage);

        if (cause === "cancelled") {
          finishStep(step, "skipped");
          halt("Cancelled by user", step.id, agentId);
          return;
        }
        if (cause === "auth") {
          finishStep(step, "rejected");
          halt(`Auth error on step "${step.id}": ${errorMessage}`, step.id, agentId);
          return;
        }
        // transient or validation (runner-signalled): bounded retry, backoff only for transient
        if (attempt > COORDINATION_LIMITS.maxRetriesPerStep) {
          finishStep(step, isTimeout(errorMessage) ? "timeout" : "rejected");
          halt(`Step "${step.id}" exhausted retries (${cause}): ${errorMessage}`, step.id, agentId);
          return;
        }
        emit("turn_retried", step.id, agentId, errorMessage);
        if (cause === "transient") {
          await delay(this.backoffMs(attempt));
        }
      }
    };

    while (!halted) {
      const ready = readySteps(plan, stepStatus);
      if (ready.length === 0) break;

      // At most one Step per Agent per batch — two ready Steps sharing an Agent
      // run in separate batches instead of racing the same Agent.
      const claimedAgents = new Set<string>();
      const batch: PlanStep[] = [];
      for (const step of ready) {
        const agentId = job.castByRole[step.role];
        if (agentId && claimedAgents.has(agentId)) continue;
        if (agentId) claimedAgents.add(agentId);
        batch.push(step);
      }
      for (const step of batch) stepStatus.set(step.id, "running");

      await Promise.all(batch.map((step) => runStep(step)));

      if (!halted && turn >= COORDINATION_LIMITS.maxTurns) {
        halt("Reached the maximum number of turns for this Job", null, null);
      }
    }

    if (!halted) {
      const allCompleted = plan.steps.every((step) => stepStatus.get(step.id) === "completed");
      if (allCompleted) {
        job.status = "completed";
        job.completedAt = this.now();
        this.onJobUpdate(job);
        emit("job_completed", null, null, null);
      } else {
        halt("No Step became runnable but the Plan is not complete", null, null);
      }
    }

    await this.cleanupWorkspaces(workspaceCopies);
    return { job, messages, events };
  }

  private toMessage(job: Job, step: PlanStep, agentId: string, turn: number, content: string): JobMessage {
    return {
      id: randomUUID(),
      jobId: job.id,
      stepId: step.id,
      agentId,
      role: step.role,
      turn,
      content,
      createdAt: this.now(),
    };
  }

  private buildPrompt(step: PlanStep, job: Job, messages: readonly JobMessage[]): string {
    if (job.plan.contextMode === "transcript" && messages.length > 0) {
      const transcript = messages.map((message) => `[${message.role}] ${message.content}`).join("\n");
      return `Sequence so far:\n${transcript}\n\n${step.instruction}`;
    }
    return step.instruction;
  }

  /** Best-effort: a cleanup failure (e.g. the Agent was deleted mid-Job) must never crash run() this late. */
  private async cleanupWorkspaces(workspaceCopies: Map<string, Set<string>>): Promise<void> {
    for (const [agentId, paths] of workspaceCopies) {
      try {
        await this.deps.courier.clearWorkspaceCopies(paths, this.deps.workspacePathForAgent(agentId));
      } catch {
        // Nothing more to do — the Job's final status is already decided.
      }
    }
  }
}
