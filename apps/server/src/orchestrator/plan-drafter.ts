import type { DraftedPlan } from "../contracts.js";

/** What the Orchestrator sees of each existing Agent when drafting a cast. */
export interface CapabilityCandidate {
  id: string;
  name: string;
  capabilitySummary: string;
}

/**
 * The one LLM-in-the-loop seam. Injected, same reason TurnRunner is: the rest of
 * the Orchestrator (validation, retry-on-invalid-draft, materialization) is unit
 * tested against a fake, no Ark key needed.
 */
export interface PlanDrafter {
  draft(task: string, candidates: readonly CapabilityCandidate[], guidance?: string): Promise<DraftedPlan>;
}
