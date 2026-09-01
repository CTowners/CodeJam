import { validatePlan } from "../coordinator/plan-validation.js";
import type { DraftedPlan, Job } from "../contracts.js";
import { HttpError } from "../errors.js";
import type { AgentCreator } from "./materialize.js";
import { buildJobFromDraft, materializeCast } from "./materialize.js";
import type { CapabilityCandidate, PlanDrafter } from "./plan-drafter.js";
import { DraftedPlanParseError } from "./response-schema.js";

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

  /**
   * `initialGuidance` is the user's revision feedback, if any. It is distinct from
   * the guidance this loop generates for itself: validation errors are appended to
   * it rather than replacing it, so a revision request survives a retry.
   */
  async draftPlan(
    task: string,
    candidates: readonly CapabilityCandidate[],
    initialGuidance?: string,
  ): Promise<DraftedPlan> {
    let guidance: string | undefined = initialGuidance;
    let lastErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_DRAFT_ATTEMPTS; attempt += 1) {
      let draft: DraftedPlan;
      try {
        draft = await this.drafter.draft(task, candidates, guidance);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Malformed output is the model's mistake, not the platform's — a small
        // model emitting a stray backslash or a sentence around the JSON can
        // usually fix it when told, so it retries with the parse error as
        // guidance rather than failing the whole request on one bad reply.
        const unwrapped = error instanceof Error ? error.cause : undefined;
        const isMalformed =
          error instanceof DraftedPlanParseError || unwrapped instanceof DraftedPlanParseError;
        if (isMalformed && attempt < MAX_DRAFT_ATTEMPTS) {
          guidance = [
            initialGuidance,
            `Your previous reply could not be parsed: ${message}`,
            "Reply with the JSON object ONLY — no prose, no markdown fences.",
            "Every backslash inside a string must be doubled, so a regex must be",
            "written as \"^\\\\d+$\", never \"^\\d+$\".",
          ]
            .filter(Boolean)
            .join("\n");
          continue;
        }
        // A genuine turn failure (Ark unreachable, the Agent busy or stopped) will
        // not fix itself between attempts, so this fails fast with a typed reason
        // instead of letting a raw error surface as an opaque 500.
        throw new HttpError(503, `Could not draft a plan: ${message}`);
      }
      lastErrors = validatePlan(draft.plan);
      if (lastErrors.length === 0) {
        return draft;
      }
      guidance = [initialGuidance, lastErrors.join("; ")].filter(Boolean).join("\n\n");
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
  static async approve(
    name: string,
    task: string,
    draft: DraftedPlan,
    creator: AgentCreator,
    parentChatId: string,
  ): Promise<Job> {
    const castByRole = await materializeCast(draft, creator, parentChatId);
    return buildJobFromDraft(name, task, draft, castByRole, parentChatId);
  }
}
