import type { DraftedPlan } from "../contracts.js";
import type { CapabilityCandidate, PlanDrafter } from "./plan-drafter.js";

export type FakeDraftHandler = (
  task: string,
  candidates: readonly CapabilityCandidate[],
  guidance: string | undefined,
) => Promise<DraftedPlan> | DraftedPlan;

/** Canned-response PlanDrafter for unit tests — no Ark key, no runner turn. */
export class FakePlanDrafter implements PlanDrafter {
  private readonly queue: FakeDraftHandler[] = [];
  public readonly calls: { task: string; candidates: readonly CapabilityCandidate[]; guidance: string | undefined }[] = [];

  constructor(private readonly defaultHandler?: FakeDraftHandler) {}

  enqueue(...handlers: FakeDraftHandler[]): void {
    this.queue.push(...handlers);
  }

  async draft(task: string, candidates: readonly CapabilityCandidate[], guidance?: string): Promise<DraftedPlan> {
    this.calls.push({ task, candidates, guidance });
    const handler = this.queue.shift() ?? this.defaultHandler;
    if (!handler) {
      throw new Error("FakePlanDrafter: no handler queued");
    }
    return handler(task, candidates, guidance);
  }
}
