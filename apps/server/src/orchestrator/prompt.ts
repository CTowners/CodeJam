import type { CapabilityCandidate } from "./plan-drafter.js";

const RESPONSE_CONTRACT = `Respond with ONLY a single JSON object, no prose, no markdown fences. Shape:

{
  "plan": {
    "steps": [
      {
        "id": "short-kebab-id",
        "role": "short free-form label, e.g. \\"implementer\\"",
        "instruction": "what this Agent should do, in full",
        "needs": ["workspace-relative/paths.txt"],
        "produces": ["workspace-relative/paths.txt"],
        "replyPattern": "optional regex the LAST non-empty line of the reply must match"
      }
    ],
    "contextMode": "none" | "transcript",
    "source": "generated"
  },
  "castByRole": {
    "<role label used above>": { "kind": "existing", "agentId": "<id from the candidate list>" }
      | { "kind": "new", "name": "short Agent name", "instructions": "full instructions for a brand-new Agent" }
  }
}

Rules:
- Every step's role must have exactly one entry in castByRole.
- Two steps must never declare the same "produces" path.
- A step's "needs" must each be produced by a step listed EARLIER in the array
  (or be omitted if nothing upstream produces it). This constrains how you LIST
  steps, not when they run — see parallelism below.
- Prefer casting an existing Agent whose capabilitySummary genuinely covers the
  step. Propose "kind":"new" when nothing in the candidate list fits, including
  for non-coding specialists (a researcher, a writer, an editor, an analyst).
- Keep each step a single specialist concern. Don't split one concern into
  several trivial steps.

Parallelism — read this carefully:
- Steps do NOT run one at a time in array order. Every step whose "needs" are
  already satisfied starts at the same time as its siblings. Sequencing comes
  only from real data dependencies: a step waits solely because it needs a file
  an earlier step produces.
- So two steps with no shared files run in PARALLEL. Use this. When a task splits
  into independent parts — several angles of a research question, several
  sections of a document, several files to review — emit one step per part with
  no "needs" between them, and they all run at once.
- Two steps cast to the SAME Agent cannot run at the same time; they are forced
  into sequence. To actually fan out N workers you must give them N DISTINCT role
  labels, each with its own castByRole entry, e.g. "researcher-diet",
  "researcher-pollution", "researcher-genetics". Reusing one label serializes them
  and throws the parallelism away.
- Fan out when parts are genuinely independent; a fan-out of 2-5 is typical.
  Then, where it helps, add ONE final step that "needs" the fanned-out files and
  synthesizes them into a single result.`;

/**
 * Guidance for a re-draft the user asked for. The previous plan is included
 * verbatim — without it the model re-plans from scratch and quietly discards the
 * parts the user was happy with.
 */
export function buildRevisionGuidance(previousPlan: unknown, feedback: string): string {
  return [
    "You already drafted this plan:",
    JSON.stringify(previousPlan, null, 2),
    "",
    "The user asked for these changes:",
    feedback,
    "",
    "Draft the plan again with those changes applied. Keep everything the user did",
    "not ask you to change. If the change is impossible with the Agents available,",
    "say so by drafting the closest plan you can with the Agents you were given.",
  ].join("\n");
}

export function buildDraftPrompt(
  task: string,
  candidates: readonly CapabilityCandidate[],
  guidance?: string,
): string {
  const candidateList =
    candidates.length > 0
      ? candidates.map((c) => `- id: ${c.id}\n  name: ${c.name}\n  capabilitySummary: ${c.capabilitySummary || "(none yet)"}`).join("\n")
      : "(none — every role will need a \"new\" cast proposal)";

  const guidanceBlock = guidance ? `\nYour previous draft was rejected:\n${guidance}\nFix it and try again.\n` : "";

  return [
    "You are the Orchestrator for a multi-Agent assistant. Tasks are not only code:",
    "research, writing, analysis and review are all in scope, and each Agent works",
    "by reading and writing files in its own private workspace.",
    "Draft a dependency-aware Plan of Steps for this task, and propose which Agent",
    "should play each Step's role. Fan independent work out across several Agents",
    "so it runs in parallel, rather than defaulting to a single chain of steps.",
    "",
    `Task: ${task}`,
    "",
    "Existing Agents you may cast (matched by capabilitySummary, not by name):",
    candidateList,
    guidanceBlock,
    RESPONSE_CONTRACT,
  ].join("\n");
}
