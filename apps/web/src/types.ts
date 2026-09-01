export type AgentStatus = "ready" | "busy" | "stopped" | "error";

/**
 * Mirrors the server's AgentKind. Decides where an Agent appears in the sidebar
 * and whether it can be talked to: only a "chat" can.
 */
export type AgentKind = "chat" | "template" | "worker";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Agent {
  id: string;
  kind: AgentKind;
  /** Set for workers: the chat they are nested under. */
  parentChatId: string | null;
  name: string;
  description: string;
  instructions: string;
  /** Derived from instructions server-side, regenerated on change. Display only. */
  capabilitySummary: string;
  status: AgentStatus;
  /** Null for templates — a role definition owns no files. */
  workspacePath: string | null;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  createdAt: string;
}

export interface AgentFormValues {
  name: string;
  description: string;
  instructions: string;
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  containerEngine: string | null;
  runtime: string;
}

// --- Job / Coordinator vocabulary, mirrors apps/server/src/contracts.ts ---

/** A short label the Orchestrator invents per Job — not a fixed enum. */
export type AgentRole = string;

export type JobStatus = "pending" | "running" | "completed" | "halted";

export interface PlanStep {
  id: string;
  role: AgentRole;
  instruction: string;
  needs: string[];
  produces: string[];
  replyPattern?: string;
}

export type ContextMode = "none" | "transcript";

export interface Plan {
  steps: PlanStep[];
  contextMode: ContextMode;
  source: "builtin" | "generated";
}

/** How the Orchestrator proposes to cast a role, before anything is created. */
export type CastProposal =
  | { kind: "existing"; agentId: string }
  | { kind: "new"; name: string; instructions: string };

/** Not a Job yet — nothing has run, no "new" cast proposal has become a real Agent. */
export interface DraftedPlan {
  plan: Plan;
  castByRole: Partial<Record<AgentRole, CastProposal>>;
}

export interface JobDraft {
  draftId: string;
  /** 0 for the first draft; higher once the user has had it revised. */
  revision: number;
  name: string;
  task: string;
  draft: DraftedPlan;
  createdAt: string;
}

export interface Job {
  id: string;
  /** The chat this Job was started from. */
  chatId: string;
  name: string;
  task: string;
  castByRole: Partial<Record<AgentRole, string>>;
  plan: Plan;
  status: JobStatus;
  /** Count of Steps that reached a terminal state — a progress counter, not an index. */
  cursor: number;
  haltedReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

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
  | "turn_rejected"
  | "turn_timeout"
  | "turn_retried"
  | "files_copied_in"
  | "files_copied_out"
  | "job_completed"
  | "job_halted";

export interface CoordinationEvent {
  id: string;
  jobId: string;
  type: CoordinationEventType;
  stepId: string | null;
  agentId: string | null;
  turn: number;
  detail: string | null;
  createdAt: string;
}
