/**
 * Names and rules for the three Agent kinds, in one place so the store's
 * migration, the Job service and the HTTP layer can't drift apart on them.
 */
import type { Agent, AgentKind } from "./types.js";

/**
 * The user-facing name of a chat Agent. Chats are looked up by name, so this is
 * effectively schema: changing it needs a migration (see store.ts's migrateV2).
 */
export const CHAT_AGENT_NAME = "Chat";

/** What CHAT_AGENT_NAME was called before v3, kept so the migration can find it. */
export const LEGACY_ORCHESTRATOR_AGENT_NAME = "Orchestrator";

/**
 * What a chat is told to do. Applied server-side to every chat, because a chat
 * without these produces prose (or just starts doing the task) instead of a Plan,
 * and the drafting turn then burns its full timeout before failing validation.
 * The user names a chat; they never author this.
 */
export const CHAT_INSTRUCTIONS = [
  "You draft Plans for the Coordinator to execute — you never touch files or run",
  "code yourself. Given a task and a list of candidate Agents (each with an id,",
  "name, and capabilitySummary), respond with a Plan and a proposed cast, in the",
  "exact JSON shape you're given in each prompt. Nothing else.",
].join(" ");

/**
 * Chats and templates can both be talked to; only a worker cannot. The two
 * conversations differ in what they can do, not whether they exist:
 *
 *   chat     — one-to-one, and can fan the work out to several Agents.
 *   template — one-to-one only. No planning, no subagents; just this Agent.
 *
 * A worker stays off-limits because it belongs to a running Job — messaging it
 * would race the Coordinator for the same Agent. Direct it through its chat.
 */
export function isChattable(agent: Pick<Agent, "kind">): boolean {
  return agent.kind !== "worker";
}

/**
 * Which kinds own a workspace directory: all of them. A template is still a
 * reusable role definition a chat can cast, but it also holds its own
 * conversation, and Codex needs somewhere to work.
 */
export function hasWorkspace(_kind: AgentKind): boolean {
  return true;
}

/** Only a chat plans work and fans it out; a template answers for itself alone. */
export function canOrchestrate(agent: Pick<Agent, "kind">): boolean {
  return agent.kind === "chat";
}
