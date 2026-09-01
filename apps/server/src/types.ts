import type { CoordinationEvent, Job, JobMessage } from "./contracts.js";

export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  /**
   * Derived from `instructions`, regenerated whenever it changes — never
   * hand-typed. The Orchestrator matches Plan Steps against this, not
   * `description` (user-authored, sidebar-only, never used for matching).
   */
  capabilitySummary: string;
  /**
   * "orchestrator" marks a planning chat rather than a work Agent — excluded
   * from every Plan's candidate list, and its `instructions` are always the
   * canonical Orchestrator instructions, never client-supplied. Undefined for
   * every ordinary Agent.
   */
  kind?: "orchestrator";
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: RunUsage | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Database {
  version: 2;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
  jobs: Job[];
  /** Job-turn transcript. Distinct from `messages`, which is Playground chat. */
  jobMessages: JobMessage[];
  events: CoordinationEvent[];
}

/** v1 on disk, before the coordination collections existed. */
export interface DatabaseV1 {
  version: 1;
  agents: Omit<Agent, "capabilitySummary">[];
  messages: Message[];
  runs: AgentRun[];
}

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
  /** When "orchestrator", createAgent ignores description/instructions and sets its own. */
  kind?: "orchestrator" | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
}

export interface RunnerResult {
  output: string;
  threadId: string | null;
  usage: RunUsage | null;
}

export interface RunnerRequest {
  agentId: string;
  workspacePath: string;
  prompt: string;
  threadId: string | null;
}

export interface AgentRunner {
  run(request: RunnerRequest): Promise<RunnerResult>;
  cancel(agentId: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}
