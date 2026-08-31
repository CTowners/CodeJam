import type { AgentRole, Plan } from "../contracts.js";

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

/**
 * Not a hard error — the Coordinator's scheduler already serializes two Steps
 * that share an Agent (at most one Step per Agent per batch), so this never
 * breaks anything. But it does mean two Steps the Plan's shape implies could run
 * in parallel actually won't, silently, unless something says so — this is that
 * something. Returns a human-readable note per conflicting pair, for the caller
 * to surface visibly (e.g. as the job_started event's detail) rather than not at all.
 */
export function sameAgentConflicts(plan: Plan, castByRole: Partial<Record<AgentRole, string>>): string[] {
  const dependsOn = new Map<string, Set<string>>();
  for (const step of plan.steps) dependsOn.set(step.id, new Set());
  const producedBy = new Map<string, string>();
  for (const step of plan.steps) {
    for (const path of step.produces) producedBy.set(path, step.id);
  }
  for (const step of plan.steps) {
    for (const path of step.needs) {
      const producerId = producedBy.get(path);
      if (producerId) dependsOn.get(step.id)!.add(producerId);
    }
  }

  const isOrdered = (fromId: string, towardId: string): boolean => {
    const seen = new Set<string>();
    const stack = [...dependsOn.get(fromId)!];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === towardId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...dependsOn.get(current)!);
    }
    return false;
  };

  const notes: string[] = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    for (let j = i + 1; j < plan.steps.length; j += 1) {
      const a = plan.steps[i]!;
      const b = plan.steps[j]!;
      const agentA = castByRole[a.role];
      const agentB = castByRole[b.role];
      if (!agentA || agentA !== agentB) continue;
      if (isOrdered(a.id, b.id) || isOrdered(b.id, a.id)) continue; // a real dependency already forces sequencing
      notes.push(
        `Steps "${a.id}" (${a.role}) and "${b.id}" (${b.role}) are cast to the same Agent with no dependency ` +
          `between them — they'll run one after another, not in parallel.`,
      );
    }
  }
  return notes;
}
