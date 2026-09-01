import type { Agent, DraftedPlan } from "../types";

/** Mirrors apps/server/src/orchestrator/instructions.ts's DRAFT_PLAN_MARKER. */
export const DRAFT_PLAN_MARKER = "[[DRAFT_PLAN]]";

/** A "chat" is a real Agent flagged with kind — never inferred from its (user-renamable) name. */
export function isOrchestratorAgent(agent: Pick<Agent, "kind">): boolean {
  return agent.kind === "orchestrator";
}

/** True for the one specially-marked outbound message the UI sends to trigger drafting. */
export function isDraftTriggerMessage(content: string): boolean {
  return content.startsWith(DRAFT_PLAN_MARKER);
}

/**
 * A light shape check, not full validation — the server (response-schema.ts's
 * zod schema, run again at /api/jobs/approve) is the real authority. This only
 * decides whether an assistant reply is render-as-a-plan-card material versus
 * plain conversational text; a reply that's valid JSON but fails this check is
 * treated as an invalid-draft reply, never shown as raw JSON either way.
 */
export function looksLikeDraftedPlan(value: unknown): value is DraftedPlan {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const plan = candidate.plan as Record<string, unknown> | undefined;
  if (!plan || typeof plan !== "object") return false;
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  if (typeof candidate.castByRole !== "object" || candidate.castByRole === null) return false;
  return plan.steps.every(
    (step) =>
      step &&
      typeof step === "object" &&
      typeof (step as Record<string, unknown>).id === "string" &&
      typeof (step as Record<string, unknown>).role === "string" &&
      typeof (step as Record<string, unknown>).instruction === "string",
  );
}

/** Strips a ```json fence the model may have added, mirroring the server's own tolerance. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

export type ParsedReply =
  | { kind: "plan"; draft: DraftedPlan }
  | { kind: "invalid-plan-attempt" }
  | { kind: "text" };

/**
 * Classifies an assistant reply for rendering — the one place that decides
 * whether raw model text could ever reach the screen unmediated. A reply is
 * only ever "text" (shown as-is) when it does NOT parse as JSON at all;
 * anything that parses as JSON is either a valid plan card or a clean
 * "invalid-plan-attempt" notice — its raw content is never rendered.
 */
export function classifyReply(content: string): ParsedReply {
  const candidate = stripCodeFence(content);
  // Cheap pre-check: plain conversational text almost never starts with `{` —
  // avoids paying JSON.parse's cost (and its risk of matching something that
  // merely happens to be valid JSON, e.g. a lone number) on the common path.
  if (!candidate.startsWith("{")) {
    return { kind: "text" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { kind: "text" };
  }
  if (looksLikeDraftedPlan(parsed)) {
    return { kind: "plan", draft: parsed };
  }
  return { kind: "invalid-plan-attempt" };
}
