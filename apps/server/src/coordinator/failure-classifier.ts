/**
 * Classifies a runner-level failure (TurnResult.ok === false) from its raw error
 * signal — never by asking a model to judge its own failure. Reply/produces-check
 * failures don't go through this: they're "validation" by definition, since the
 * check itself is the classification.
 */
export type FailureCause = "transient" | "validation" | "auth" | "cancelled";

const CANCELLED_PATTERN = /\bcancell?ed\b/i;
// "auth" also catches a stale/missing cast ("Agent not found"), an Agent a human
// has stopped ("This Agent is stopped", agent-service.ts), and a needs-path that
// escapes its root (file-courier.ts) — like a bad credential, retrying the exact
// same call can never fix any of these on its own; each needs a human (recast the
// Step, restart the Agent, or fix the drafted Plan) before a retry could succeed.
const AUTH_PATTERN =
  /\b(401|403|unauthorized|forbidden|invalid[_ -]?api[_ -]?key|auth(?:entication)?[_ -]?(?:failed|error)|not found|no such agent|agent is stopped|escapes its intended root)\b/i;
const TIMEOUT_PATTERN = /\btimed?[ -]?out\b|\betimedout\b/i;
// "already running a turn" (agent-service.ts's busy guard) is transient in spirit
// even though it isn't network-shaped: the Agent is mid-turn on someone else's work
// right now — the Playground, or another Step — not broken, and backoff gives it a
// real chance to free up before the next attempt, unlike validation's no-backoff retry.
const TRANSIENT_PATTERN =
  /\b(econnreset|econnrefused|enotfound|network|5\d\d|socket hang up|service unavailable|rate[ -]?limit(?:ed)?|429|already running a turn)\b/i;

export function isTimeout(errorMessage: string): boolean {
  return TIMEOUT_PATTERN.test(errorMessage);
}

export function classifyFailure(errorMessage: string): FailureCause {
  if (CANCELLED_PATTERN.test(errorMessage)) return "cancelled";
  if (AUTH_PATTERN.test(errorMessage)) return "auth";
  if (TRANSIENT_PATTERN.test(errorMessage) || isTimeout(errorMessage)) return "transient";
  return "validation";
}
