import { COORDINATION_LIMITS } from "../contracts.js";
import type { DraftedPlan, TurnRunner } from "../contracts.js";
import type { CapabilityCandidate, PlanDrafter } from "./plan-drafter.js";
import { buildDraftPrompt } from "./prompt.js";
import { parseDraftedPlan } from "./response-schema.js";

/**
 * Real PlanDrafter: sends the planning prompt through a TurnRunner turn, same
 * mechanism a Coordinator Step uses. Needs a real Agent (and, transitively, an
 * Ark key) behind `orchestratorAgentId` to actually run — everything upstream of
 * this (validation, retry-on-invalid-draft, materialization) is tested against
 * FakePlanDrafter instead, so none of that needs a key.
 */
export class ModelPlanDrafter implements PlanDrafter {
  constructor(
    private readonly runner: TurnRunner,
    private readonly orchestratorAgentId: string,
    private readonly timeoutMs: number = COORDINATION_LIMITS.turnTimeoutMs,
  ) {}

  async draft(task: string, candidates: readonly CapabilityCandidate[], guidance?: string): Promise<DraftedPlan> {
    const prompt = buildDraftPrompt(task, candidates, guidance);
    const result = await this.runner.runTurn(this.orchestratorAgentId, prompt, this.timeoutMs);
    if (!result.ok) {
      throw new Error(`Plan drafting turn failed: ${result.error ?? "unknown error"}`);
    }
    // Thrown as-is: the Orchestrator distinguishes a malformed reply (retryable)
    // from a failed turn (not), and wrapping it would erase that distinction.
    return parseDraftedPlan(result.reply);
  }
}
