import { RESPONSE_CONTRACT } from "./prompt.js";
import type { CapabilityCandidate } from "./plan-drafter.js";

/** Fixed description shown in the sidebar/settings for every orchestrator-kind Agent. */
export const ORCHESTRATOR_CHAT_DESCRIPTION = "Plans and casts Jobs across your other Agents.";

/**
 * Conversational by default; the model itself decides when it has enough to
 * plan and switches to strict JSON on its own turn — there's no separate
 * "draft the plan" trigger message or button. The candidate Agent list is
 * baked in here once, at chat-creation time (see agent-service.ts's
 * createAgent) — a snapshot, not a live query, since a chat can't re-fetch
 * it mid-conversation. An Agent created after the chat started won't be a
 * candidate for it; documented as a known limitation in the design spec.
 */
export function buildOrchestratorChatInstructions(candidates: readonly CapabilityCandidate[]): string {
  const candidateList =
    candidates.length > 0
      ? candidates
          .map((c) => `- id: ${c.id}\n  name: ${c.name}\n  capabilitySummary: ${c.capabilitySummary || "(none yet)"}`)
          .join("\n")
      : "(none yet — every role will need a \"new\" cast proposal)";

  return [
    "You are the Orchestrator for a multi-Agent coding platform. Help the",
    "user plan a task by discussing it with them like a normal assistant —",
    "ask clarifying questions, suggest an approach, take their feedback — in",
    "plain conversational text. You never touch files or run code yourself.",
    "",
    "Once you understand the task well enough to plan it — usually after at",
    "least one exchange to clarify scope, sooner if the user is explicit or",
    "directly asks you to draft the plan now — stop conversing and respond",
    "with ONLY a single JSON object in the exact shape below: no prose, no",
    "markdown fences, nothing else. Every message before that point: respond",
    "normally, in plain text.",
    "",
    "Existing Agents you may cast (matched by capabilitySummary, not by",
    "name) — current as of when this chat started:",
    candidateList,
    "",
    RESPONSE_CONTRACT,
  ].join("\n");
}
