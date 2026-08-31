/**
 * Shared vocabulary for multi-Agent coordination.
 *
 * Types only, no logic — everyone can import this without importing behaviour.
 *
 * The model in one paragraph: a standing team of Agents already exists. A Job hands
 * that team one task, described by the Orchestrator as an ordered Plan of Steps,
 * each cast to the Agent whose capabilitySummary best matches — not a fixed role
 * vocabulary. The Coordinator (plain code) executes the Plan, giving one Step at a
 * time to its cast Agent, checking each reply before it becomes state. Agents never
 * see each other's folders — the Coordinator couriers declared files in before a
 * turn and out afterwards.
 */

/**
 * A short label the Orchestrator invents per Job (e.g. "implementer", "reviewer")
 * to describe what a Step needs — not a fixed enum. Maps to an Agent via
 * Job.castByRole. Casting matches this against every Agent's capabilitySummary.
 */
export type AgentRole = string;

export type JobStatus =
  | "pending"    // created, not started
  | "running"
  | "completed"  // every step succeeded
  | "halted"     // gave up: retries exhausted, limit hit, cancelled, or server restart
  ;

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "rejected"   // reply failed its check
  | "timeout"
  | "skipped"
  ;

/**
 * One unit of work for one Agent.
 *
 * `needs` and `produces` are workspace-relative file paths. They are what makes
 * isolation and parallelism safe:
 *   - before the turn, the Coordinator copies exactly `needs` into the Agent's folder
 *   - after the turn, it copies exactly `produces` back out; anything else is ignored
 *   - two steps may run at the same time only if their `produces` do not overlap
 *     and all their `needs` are already satisfied
 *   - two steps declaring the same `produces` is a conflict, detected before running
 */
export interface PlanStep {
  id: string;
  role: AgentRole;
  /** Instruction text sent to the Agent. The Coordinator may prepend shared context. */
  instruction: string;
  needs: string[];
  produces: string[];
  /**
   * How the reply is checked. Plain code only — never a judgement about quality.
   * All files in `produces` must exist and be non-empty; additionally, if
   * `replyPattern` is set, the final non-empty line of the reply must match it.
   * Examples: "^\\d+$" for a countdown turn, "^(PASS|FAIL:.*)$" for a test run.
   */
  replyPattern?: string;
}

/**
 * Whether the Agent is shown what happened on earlier turns.
 *   "none"       — only its own instruction (relay steps: the files carry the context)
 *   "transcript" — prior turn messages are prepended (countdown: "Sequence so far: ...")
 */
export type ContextMode = "none" | "transcript";

export interface Plan {
  steps: PlanStep[];
  contextMode: ContextMode;
  /** Where the Plan came from. Handwritten today; a planner Agent could fill this later. */
  source: "builtin" | "generated";
}

/**
 * How the Orchestrator proposes to cast a role, before the user approves anything.
 * "new" is the draft-then-materialize path: nothing is created yet, it's just a
 * proposed name + instructions shown in plan review like any other cast pick.
 * Only on approval does a "new" proposal become a real Agent (see orchestrator/materialize.ts).
 */
export type CastProposal =
  | { kind: "existing"; agentId: string }
  | { kind: "new"; name: string; instructions: string };

/**
 * What the Orchestrator hands back for user review. Not a Job yet — nothing has
 * run, no Agent has been created for any "new" cast proposal. The user reviews,
 * revises, and approves this once, upfront (AGENTS.md §5); approval is what turns
 * it into a real Job via orchestrator/materialize.ts's buildJobFromDraft.
 */
export interface DraftedPlan {
  plan: Plan;
  castByRole: Partial<Record<AgentRole, CastProposal>>;
}

export interface Job {
  id: string;
  name: string;
  /** What the user typed. */
  task: string;
  /** Which Agent plays each role, resolved when the Job is created. */
  castByRole: Partial<Record<AgentRole, string>>;
  plan: Plan;
  status: JobStatus;
  /**
   * How many Steps have reached a terminal state (completed/rejected/skipped/
   * timeout) — a simple monotonic progress counter, not an index. Steps can run
   * in parallel, so there's no single "current" one to point at.
   */
  cursor: number;
  /** Set when status is "halted". Human-readable. */
  haltedReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Something an Agent said on a turn. This is the transcript the UI renders. */
export interface JobMessage {
  id: string;
  jobId: string;
  stepId: string;
  agentId: string;
  role: AgentRole;
  turn: number;
  content: string;
  createdAt: string;
}

export type CoordinationEventType =
  | "job_started"
  | "turn_started"
  | "turn_completed"
  | "turn_rejected"   // reply failed its check; detail says why
  | "turn_timeout"
  | "turn_retried"
  | "files_copied_in"
  | "files_copied_out"
  | "job_completed"
  | "job_halted"
  ;

/**
 * The audit trail. Append-only, ordered, and the evidence shown in the demo.
 * Every decision the Coordinator makes lands here, including the ones that fail.
 */
export interface CoordinationEvent {
  id: string;
  jobId: string;
  type: CoordinationEventType;
  /** Null for job-level events. */
  stepId: string | null;
  agentId: string | null;
  turn: number;
  /** Why, in one line. Populated for rejections, timeouts and halts. */
  detail: string | null;
  createdAt: string;
}

/** Result of executing one turn, handed back to the Coordinator by the runner. */
export interface TurnResult {
  ok: boolean;
  reply: string;
  /** Populated when ok is false. */
  error: string | null;
  durationMs: number;
}

/**
 * How the Coordinator reaches an Agent. Injected, so the Coordinator can be unit
 * tested against a fake that returns canned replies — no Ark key, no containers.
 */
export interface TurnRunner {
  runTurn(agentId: string, prompt: string, timeoutMs: number): Promise<TurnResult>;
  /** Clears an Agent's conversation thread so a new Job starts with a clean slate. */
  resetMemory(agentId: string): Promise<void>;
}

/** Limits. One place, so nobody invents their own.  */
export const COORDINATION_LIMITS = {
  /** Hard stop on total turns in a Job, including retries. */
  maxTurns: 20,
  /** Retries per step before the Job halts. */
  maxRetriesPerStep: 2,
  /** Per-turn wall clock. Must stay below CODEX_TIMEOUT_MS. */
  turnTimeoutMs: 120_000,
  /** Only one Job runs at a time: the cast is shared and an Agent can only do one thing at once. */
  maxConcurrentJobs: 1,
} as const;
