import { RESPONSE_CONTRACT } from "./prompt.js";
import type { CapabilityCandidate } from "./plan-drafter.js";

/**
 * Prefixes a "draft the plan now" turn so the Orchestrator's instructions know
 * to switch out of conversation and into strict JSON — every other message is
 * answered in plain text. The frontend also uses this to recognize and hide
 * the trigger message itself from the transcript (it's a technical prompt,
 * not something the user typed).
 */
export const DRAFT_PLAN_MARKER = "[[DRAFT_PLAN]]";

/**
 * Conversational by default, strict JSON only when a message starts with
 * DRAFT_PLAN_MARKER — unlike the old one-shot flow, this Agent can now hold a
 * normal back-and-forth (answer questions, take feedback) before drafting.
 */
export const ORCHESTRATOR_CHAT_INSTRUCTIONS = [
  "You are the Orchestrator for a multi-Agent coding platform. You help the",
  "user plan a task by discussing it with them like a normal assistant — ask",
  "questions, suggest an approach, take their feedback — in plain",
  "conversational text. You never touch files or run code yourself.",
  "",
  `When, and only when, a message starts with "${DRAFT_PLAN_MARKER}", stop`,
  "conversing and respond with ONLY the JSON object in the exact shape that",
  "message specifies — no prose, no markdown fences, nothing else. Every",
  "other message: respond normally, in plain text.",
].join("\n");

/** Fixed description shown in the sidebar/settings for every orchestrator-kind Agent. */
export const ORCHESTRATOR_CHAT_DESCRIPTION = "Plans and casts Jobs across your other Agents.";

/**
 * The one specially-marked message that switches this turn into strict JSON —
 * everything the model needs (the schema, the live candidate list) travels in
 * this one message; the task itself is already in the resumed conversation.
 */
export function buildDraftTriggerMessage(candidates: readonly CapabilityCandidate[]): string {
  const candidateList =
    candidates.length > 0
      ? candidates
          .map((c) => `- id: ${c.id}\n  name: ${c.name}\n  capabilitySummary: ${c.capabilitySummary || "(none yet)"}`)
          .join("\n")
      : "(none — every role will need a \"new\" cast proposal)";

  return [
    DRAFT_PLAN_MARKER,
    "Based on our conversation so far, draft an ordered, dependency-aware Plan",
    "of Steps for the task discussed, and propose which Agent should play each",
    "Step's role.",
    "",
    "Existing Agents you may cast (matched by capabilitySummary, not by name):",
    candidateList,
    "",
    RESPONSE_CONTRACT,
  ].join("\n");
}
