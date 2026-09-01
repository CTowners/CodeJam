import type { Agent } from "../types";

/** Mirrors apps/server/src/job-service.ts's ORCHESTRATOR_AGENT_NAME. */
export const ORCHESTRATOR_AGENT_NAME = "Orchestrator";

/**
 * The one system Agent auto-created to draft Plans for Jobs — shown in its own
 * section at the top of the sidebar, never offered a Delete control, since
 * deleting it breaks Job drafting until it's lazily recreated.
 */
export function isOrchestratorAgent(agent: Pick<Agent, "name">): boolean {
  return agent.name === ORCHESTRATOR_AGENT_NAME;
}
