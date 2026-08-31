import type { Plan } from "../contracts.js";

/**
 * Checked once, before a Job starts: two Steps declaring the same `produces` is a
 * conflict (which one wins?), and a Step's `needs` must trace back to an earlier
 * Step's `produces` or be treated as externally supplied. Both are plan-authoring
 * mistakes, not runtime races — catching them here is what makes the Coordinator's
 * dependency-gated scheduling race-free by construction (see AGENTS.md §5).
 */
export function validatePlan(plan: Plan): string[] {
  const errors: string[] = [];
  const producedBy = new Map<string, string>();
  const indexOf = new Map(plan.steps.map((step, index) => [step.id, index]));

  for (const step of plan.steps) {
    for (const path of step.produces) {
      const existing = producedBy.get(path);
      if (existing) {
        errors.push(`Steps "${existing}" and "${step.id}" both declare produces "${path}"`);
      } else {
        producedBy.set(path, step.id);
      }
    }
  }

  for (const step of plan.steps) {
    for (const path of step.needs) {
      const producerId = producedBy.get(path);
      if (!producerId) continue; // no declared producer: treated as externally supplied
      if (indexOf.get(producerId)! >= indexOf.get(step.id)!) {
        errors.push(
          `Step "${step.id}" needs "${path}" from "${producerId}", which is not an earlier step`,
        );
      }
    }
  }

  return errors;
}
