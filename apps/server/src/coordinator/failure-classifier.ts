/**
 * Classifies a runner-level failure (TurnResult.ok === false) from its raw error
 * signal — never by asking a model to judge its own failure. Reply/produces-check
 * failures don't go through this: they're "validation" by definition, since the
 * check itself is the classification.
 */
export type FailureCause = "transient" | "validation" | "auth" | "cancelled";

const CANCELLED_PATTERN = /\bcancell?ed\b/i;
const AUTH_PATTERN =
  /\b(401|403|unauthorized|forbidden|invalid[_ -]?api[_ -]?key|auth(?:entication)?[_ -]?(?:failed|error))\b/i;
const TIMEOUT_PATTERN = /\btimed?[ -]?out\b|\betimedout\b/i;
const TRANSIENT_PATTERN =
  /\b(econnreset|econnrefused|enotfound|network|5\d\d|socket hang up|service unavailable|rate[ -]?limit(?:ed)?|429)\b/i;

export function isTimeout(errorMessage: string): boolean {
  return TIMEOUT_PATTERN.test(errorMessage);
}

export function classifyFailure(errorMessage: string): FailureCause {
  if (CANCELLED_PATTERN.test(errorMessage)) return "cancelled";
  if (AUTH_PATTERN.test(errorMessage)) return "auth";
  if (TRANSIENT_PATTERN.test(errorMessage) || isTimeout(errorMessage)) return "transient";
  return "validation";
}
