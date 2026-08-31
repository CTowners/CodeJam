/**
 * Derives Agent.capabilitySummary from instructions. Deterministic and free —
 * runs on every create/update with no Ark key, preserving the project's existing
 * guarantee that Agent CRUD needs no credentials. The Orchestrator reads this
 * field to match Plan Steps to Agents. Swap this for a model-generated summary
 * later without changing any caller.
 */
const MAX_LENGTH = 240;

export function summarizeCapability(instructions: string): string {
  const collapsed = instructions.trim().replace(/\s+/g, " ");
  if (collapsed.length <= MAX_LENGTH) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_LENGTH - 1).trimEnd() + "…";
}
