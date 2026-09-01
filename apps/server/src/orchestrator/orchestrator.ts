import type { DraftedPlan, Job } from "../contracts.js";
import type { AgentCreator } from "./materialize.js";
import { buildJobFromDraft, materializeCast } from "./materialize.js";

/**
 * Approval: materialize any "new" cast proposals into real Agents, then build
 * the Job. The draft itself now comes from an ordinary chat turn against an
 * orchestrator-kind Agent (app.ts's /draft-plan route), revalidated against
 * response-schema.ts's schema at /api/jobs/approve — this is what turns an
 * approved draft into a real, running Job (AGENTS.md §5).
 */
export const Orchestrator = {
  async approve(name: string, task: string, draft: DraftedPlan, creator: AgentCreator): Promise<Job> {
    const castByRole = await materializeCast(draft, creator);
    return buildJobFromDraft(name, task, draft, castByRole);
  },
};
