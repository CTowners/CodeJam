export const RESPONSE_CONTRACT = `Respond with ONLY a single JSON object, no prose, no markdown fences. Shape:

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
- Steps run in the array order you give; a step's "needs" must each be produced by
  an EARLIER step's "produces" (or be omitted if nothing upstream produces it).
- Two steps must never declare the same "produces" path.
- Prefer casting an existing Agent whose capabilitySummary genuinely covers the
  step. Only propose "kind":"new" when nothing in the candidate list fits — a
  fresh Agent is not free, so don't default to it.
- Keep the plan as short as correctness allows. Prefer one step per specialist
  concern over many trivial steps.`;
