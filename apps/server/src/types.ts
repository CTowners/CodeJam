import type { CoordinationEvent, Job, JobMessage } from "./contracts.js";

export type AgentStatus = "ready" | "busy" | "stopped" | "error";

/**
 * What an Agent *is*, which decides where it appears and whether the user may
 * talk to it directly. The three kinds are deliberately not interchangeable:
 *
 *   "chat"     — a conversation the user drives. The only chattable kind, and the
 *                only entry point: the user asks here, and this is what drafts
 *                Plans and fans work out to workers.
 *   "template" — a specialist the user defined: a name and instructions, nothing
 *                else. Holds no workspace, no thread and no history; it is a
 *                reusable role definition a chat may cast, not a running thing.
 *   "worker"   — spawned to execute one Job's Step, from a template or invented
 *                by the chat. Inspectable (its transcript is the evidence) but
 *                never chattable: to direct a worker you go through its chat.
 */
export type AgentKind = "chat" | "template" | "worker";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";

export interface Agent {
  id: string;
  kind: AgentKind;
  /**
   * Which chat this Agent belongs under, giving the sidebar its nesting.
   * Set for "worker" only — chats are roots and templates are shared across all
   * of them, so both are null.
   */
  parentChatId: string | null;
  name: string;
  description: string;
  instructions: string;
  /**
   * Derived from `instructions`, regenerated whenever it changes — never
   * hand-typed. The Orchestrator matches Plan Steps against this, not
   * `description` (user-authored, sidebar-only, never used for matching).
   */
  capabilitySummary: string;
  status: AgentStatus;
  /** Null only on rows migrated from a schema where this Agent held no files. */
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
  version: 3;
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
  agents: Omit<Agent, "capabilitySummary" | "kind" | "parentChatId">[];
  messages: Message[];
  runs: AgentRun[];
}

/** v2 on disk, before Agents were split into chat/template/worker kinds. */
export interface DatabaseV2 {
  version: 2;
  agents: Omit<Agent, "kind" | "parentChatId">[];
  messages: Message[];
  runs: AgentRun[];
  /** chatId did not exist yet; migrateV2 backfills it. */
  jobs: (Omit<Job, "chatId"> & { chatId?: string })[];
  jobMessages: JobMessage[];
  events: CoordinationEvent[];
}

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
  /** Defaults to "template": what the user creates by hand is a role definition. */
  kind?: AgentKind | undefined;
  /** Required for "worker" — the chat whose Job spawned it. */
  parentChatId?: string | null | undefined;
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
