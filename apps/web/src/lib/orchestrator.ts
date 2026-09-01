import type { Agent, DraftedPlan, Message } from "../types";

/** A "chat" is a real Agent flagged with kind — never inferred from its (user-renamable) name. */
export function isOrchestratorAgent(agent: Pick<Agent, "kind">): boolean {
  return agent.kind === "orchestrator";
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

export type ChatPhase = "starting" | "discussing" | "thinking" | "plan-ready";

export const CHAT_PHASE_LABEL: Record<ChatPhase, string> = {
  starting: "Tell me about the task",
  discussing: "Discussing the task",
  thinking: "Thinking…",
  "plan-ready": "Plan ready — say the word to run it",
};

/**
 * There's no explicit "draft the plan" step anymore — the model decides on
 * its own when it has enough to plan, and emits the JSON on that turn. This
 * derives a phase label from that same signal (classifyReply) instead of any
 * separate state, so the indicator can never disagree with what's actually
 * rendered below it.
 */
export function deriveChatPhase(messages: readonly Pick<Message, "role" | "content">[], running: boolean): ChatPhase {
  if (running) return "thinking";
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (lastAssistant && classifyReply(lastAssistant.content).kind === "plan") return "plan-ready";
  return messages.length === 0 ? "starting" : "discussing";
}

const AFFIRMATIVE_PATTERN =
  /^(ok(ay)?|yes|yeah|yep|yup|sure|approve[d]?|go ahead|go for it|do it|sounds good|looks good|lgtm|run it|let'?s go|proceed)[.!,\s]*$/i;

/**
 * There's no "Approve & Run" button — approval is just saying so. This gates
 * that: only checked against the user's message when the immediately
 * preceding assistant reply was a drafted plan (see App.tsx's sendMessage),
 * so an unrelated "ok" earlier in the conversation is never mistaken for
 * approval. The materialize/run action it triggers is exactly what the old
 * button called, and still goes through the same server-side revalidation —
 * only the trigger changed, not the safety of the action itself.
 */
export function isAffirmative(text: string): boolean {
  return AFFIRMATIVE_PATTERN.test(text.trim());
}
