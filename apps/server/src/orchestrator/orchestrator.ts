import { validatePlan } from "../coordinator/plan-validation.js";
import type { DraftedPlan, Job } from "../contracts.js";
import type { AgentCreator } from "./materialize.js";
import { buildJobFromDraft, materializeCast } from "./materialize.js";
import type { CapabilityCandidate, PlanDrafter } from "./plan-drafter.js";

const MAX_DRAFT_ATTEMPTS = 2;

export class OrchestratorDraftError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "OrchestratorDraftError";
  }
}

/**
 * Drafts a Plan for a task, casting each Step against candidate Agents'
 * capabilitySummary — the judgement call, made once per Job (AGENTS.md §5). A
 * draft that fails plan-validation (overlapping produces, out-of-order needs) is
 * sent back to the drafter once with the errors as guidance before giving up,
 * the same bounded-retry instinct the Coordinator applies to a Step's output.
 */
export class Orchestrator {
  constructor(private readonly drafter: PlanDrafter) {}

  async draftPlan(task: string, candidates: readonly CapabilityCandidate[]): Promise<DraftedPlan> {
    let guidance: string | undefined;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt += 1) {
      const draft = await this.drafter.draft(task, candidates, guidance);
      lastErrors = validatePlan(draft.plan);
      if (lastErrors.length === 0) {
        return draft;
      }
      guidance = lastErrors.join("; ");
    }

    throw new OrchestratorDraftError(
      `Drafted plan was invalid after ${MAX_DRAFT_ATTEMPTS} attempt(s): ${lastErrors.join("; ")}`,
      MAX_DRAFT_ATTEMPTS,
    );
  }

  /**
   * Approval: materialize any "new" cast proposals into real Agents, then build
   * the Job. Static — approval doesn't need a PlanDrafter, only draftPlan() does
   * — so a caller that only has a drafted plan in hand (no Orchestrator instance
   * around) can still go through the one tested approval path instead of
   * reimplementing it inline.
   */
  static async approve(name: string, task: string, draft: DraftedPlan, creator: AgentCreator): Promise<Job> {
    const castByRole = await materializeCast(draft, creator);
    return buildJobFromDraft(name, task, draft, castByRole);
  }
}
