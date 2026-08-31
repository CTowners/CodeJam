import { randomUUID } from "node:crypto";
import type { AgentRole, DraftedPlan, Job } from "../contracts.js";

/** The slice of AgentService.createAgent that materialization needs. */
export interface AgentCreator {
  createAgent(input: { name: string; instructions: string }): Promise<{ id: string }>;
}

/**
 * Turns a DraftedPlan's cast proposals into a real castByRole map. Only called
 * once the user approves the plan: "existing" proposals pass through untouched,
 * "new" proposals become real Agents here — this is the one moment a "new" draft
 * Agent turns real, so a rejected plan never leaves one behind.
 */
export async function materializeCast(
  draft: DraftedPlan,
  creator: AgentCreator,
): Promise<Partial<Record<AgentRole, string>>> {
  const resolved: Partial<Record<AgentRole, string>> = {};
  for (const [role, proposal] of Object.entries(draft.castByRole)) {
    if (!proposal) continue;
    resolved[role] =
      proposal.kind === "existing"
        ? proposal.agentId
        : (await creator.createAgent({ name: proposal.name, instructions: proposal.instructions })).id;
  }
  return resolved;
}

/** Builds the approved Job once the user has signed off on the draft and its cast is real. */
export function buildJobFromDraft(
  name: string,
  task: string,
  draft: DraftedPlan,
  castByRole: Partial<Record<AgentRole, string>>,
  now: () => string = () => new Date().toISOString(),
): Job {
  return {
    id: randomUUID(),
    name,
    task,
    castByRole,
    plan: draft.plan,
    status: "pending",
    cursor: 0,
    haltedReason: null,
    createdAt: now(),
    completedAt: null,
  };
}
