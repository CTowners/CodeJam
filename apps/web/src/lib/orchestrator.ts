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

/**
 * Index of the `}` that closes the `{` at `start`, respecting string
 * literals (so a `}` inside a quoted instruction doesn't end the object
 * early) — or -1 if the braces never balance before the text ends. Used to
 * find a JSON object embedded anywhere in a reply, not just one that
 * happens to be the entire message.
 */
function findMatchingBraceEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export type ParsedReply =
  | { kind: "plan"; draft: DraftedPlan; before: string; after: string }
  | { kind: "invalid-plan-attempt" }
  | { kind: "text" };

/**
 * Classifies an assistant reply for rendering — the one place that decides
 * whether raw model text could ever reach the screen unmediated. The model
 * is told to reply with ONLY JSON once it's ready to draft, but doesn't
 * always comply — it sometimes wraps the JSON in a sentence or two of prose
 * ("Here's the plan: {...}"). This scans for a balanced {...} block anywhere
 * in the reply, not just one that happens to be the whole message, so that
 * case still renders as a Plan Card (with the surrounding prose kept as
 * ordinary text) instead of dumping the raw JSON onto the screen.
 */
export function classifyReply(content: string): ParsedReply {
  const stripped = stripCodeFence(content);
  const start = stripped.indexOf("{");
  if (start === -1) {
    return { kind: "text" };
  }
  const end = findMatchingBraceEnd(stripped, start);
  if (end === -1) {
    // An unbalanced `{` is almost always incidental punctuation in prose
    // ("a config like { name: ..."), not an attempted JSON object — showing
    // the surrounding text as-is is the safe default here.
    return { kind: "text" };
  }
  const candidate = stripped.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    // A balanced {...} block that still fails to parse is very unlikely to
    // be incidental — treat it as a genuine broken drafting attempt rather
    // than ever showing that raw, malformed JSON to the user.
    return { kind: "invalid-plan-attempt" };
  }
  if (looksLikeDraftedPlan(parsed)) {
    return {
      kind: "plan",
      draft: parsed,
      before: stripped.slice(0, start).trim(),
      after: stripped.slice(end + 1).trim(),
    };
  }
  // Balanced, valid JSON, but not plan-shaped — most likely an incidental
  // example inside a conversational reply, not a drafting attempt.
  return { kind: "text" };
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
