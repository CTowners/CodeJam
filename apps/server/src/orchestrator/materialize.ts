import { randomUUID } from "node:crypto";
import type { AgentRole, DraftedPlan, Job } from "../contracts.js";

/** The slice of AgentService that materialization needs. */
export interface AgentCreator {
  createAgent(input: {
    name: string;
    instructions: string;
    kind?: "chat" | "template" | "worker";
    parentChatId?: string | null;
  }): Promise<{ id: string }>;
  /** Clones a template's role definition into a fresh worker for this Job. */
  spawnWorkerFromTemplate(templateId: string, parentChatId: string): Promise<{ id: string }>;
  /** Used to reject a cast that names something other than a template. */
  getAgent(id: string): { kind: string; name: string };
}

/**
 * Turns a DraftedPlan's cast proposals into a real castByRole map. Only called
 * once the user approves the plan — this is the one moment a proposal turns into
 * something real, so a rejected plan never leaves anything behind.
 *
 * Both proposal kinds resolve to a **worker**, never to the template itself:
 * "existing" clones the named template's instructions into a fresh worker, and
 * "new" creates one outright. That is what lets a template stay a pure role
 * definition — no workspace, no thread, no history — while still being castable
 * again and again, and it gives each Job its own isolated Agents.
 */
export async function materializeCast(
  draft: DraftedPlan,
  creator: AgentCreator,
  parentChatId: string,
): Promise<Partial<Record<AgentRole, string>>> {
  const resolved: Partial<Record<AgentRole, string>> = {};
  for (const [role, proposal] of Object.entries(draft.castByRole)) {
    if (!proposal) continue;
    if (proposal.kind === "existing") {
      // The model is only ever shown template ids, so anything else here is a
      // hallucinated or stale id. Checked at the point of materialization rather
      // than trusting the prompt, since this is what actually creates the Agent.
      const target = creator.getAgent(proposal.agentId);
      if (target.kind !== "template") {
        throw new Error(
          `Plan casts "${role}" to "${target.name}", which is a ${target.kind}, not one of Your Agents`,
        );
      }
    }
    resolved[role] =
      proposal.kind === "existing"
        ? (await creator.spawnWorkerFromTemplate(proposal.agentId, parentChatId)).id
        : (
            await creator.createAgent({
              name: proposal.name,
              instructions: proposal.instructions,
              kind: "worker",
              parentChatId,
            })
          ).id;
  }
  return resolved;
}

/** Builds the approved Job once the user has signed off on the draft and its cast is real. */
export function buildJobFromDraft(
  name: string,
  task: string,
  draft: DraftedPlan,
  castByRole: Partial<Record<AgentRole, string>>,
  chatId: string,
  now: () => string = () => new Date().toISOString(),
): Job {
  return {
    id: randomUUID(),
    chatId,
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
