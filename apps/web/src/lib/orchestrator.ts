import type { Agent } from "../types";

/** Mirrors apps/server/src/agent-kinds.ts's CHAT_AGENT_NAME. */
export const CHAT_AGENT_NAME = "Chat";

/**
 * Chats and templates both hold a conversation; a worker does not, because it
 * belongs to a running Job and messaging it would race the Coordinator.
 */
export function isChattable(agent: Pick<Agent, "kind">): boolean {
  return agent.kind !== "worker";
}

/** Only a chat plans work and fans it out. A template answers for itself alone. */
export function canOrchestrate(agent: Pick<Agent, "kind">): boolean {
  return agent.kind === "chat";
}

/**
 * Only the last remaining chat is protected: drafting needs one to exist, but
 * chats are user-creatable, so the rest are ordinary and deletable.
 */
export function isProtectedAgent(agent: Pick<Agent, "kind">, agents: Pick<Agent, "kind">[]): boolean {
  return agent.kind === "chat" && agents.filter((item) => item.kind === "chat").length <= 1;
}

/** One line explaining what this Agent is, shown wherever it is selected. */
export function describeKind(agent: Pick<Agent, "kind">): string {
  switch (agent.kind) {
    case "chat":
      return "Chat · plans work and fans it out to Agents";
    case "template":
      return "Your Agent · answers on its own, and Chats can call on it";
    case "worker":
      return "Subagent · spawned for one Job, inspect only";
  }
}
