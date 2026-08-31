import type { Plan, PlanStep, StepStatus } from "../contracts.js";

/**
 * Steps that are still pending and whose every `needs` path is already staged —
 * i.e. produced by a Step that has already reached "completed". This is the whole
 * race-condition policy (AGENTS.md §5): no locks, just "don't start until your
 * inputs were written by a Step that has already finished writing them."
 *
 * Does not account for two ready Steps sharing an Agent — the Coordinator's batch
 * selection does that, since "running" state doesn't exist yet for this pass.
 */
export function readySteps(plan: Plan, stepStatus: ReadonlyMap<string, StepStatus>): PlanStep[] {
  const completed = new Set(
    plan.steps.filter((step) => stepStatus.get(step.id) === "completed").map((step) => step.id),
  );
  const producedBy = new Map<string, string>();
  for (const step of plan.steps) {
    for (const path of step.produces) producedBy.set(path, step.id);
  }

  return plan.steps.filter((step) => {
    if (stepStatus.get(step.id) !== "pending") return false;
    return step.needs.every((path) => {
      const producerId = producedBy.get(path);
      return producerId ? completed.has(producerId) : true;
    });
  });
}
