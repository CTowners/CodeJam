import { z } from "zod";
import type { DraftedPlan } from "../contracts.js";

const castProposalSchema = z.union([
  z.object({ kind: z.literal("existing"), agentId: z.string().min(1) }),
  z.object({ kind: z.literal("new"), name: z.string().min(1), instructions: z.string().min(1) }),
]);

// Models frequently emit `null` for "nothing here" instead of omitting the key
// or sending `[]` — tolerate that in addition to a proper missing/empty value,
// since it's not a real drafting mistake worth a whole retry-with-guidance round trip.
const nullableStringArray = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((value) => value ?? []);
const nullableString = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const planStepSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  instruction: z.string().min(1),
  needs: nullableStringArray,
  produces: nullableStringArray,
  replyPattern: nullableString,
});

const draftedPlanSchema = z.object({
  plan: z.object({
    steps: z.array(planStepSchema).min(1),
    contextMode: z.enum(["none", "transcript"]),
    source: z.literal("generated"),
  }),
  castByRole: z.record(z.string(), castProposalSchema),
});

/** Strips a ```json fence the model may have added despite being told not to. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

/**
 * Pulls the JSON object out of a reply that wrapped it in prose. Models are told
 * to answer with the object alone; smaller ones often add a sentence either side.
 */
function extractObject(text: string): string {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : text;
}

/**
 * Escapes lone backslashes that JSON does not allow.
 *
 * `replyPattern` carries a regular expression, and a model writing "^\d+$" emits
 * a single backslash — valid regex, invalid JSON, and the whole draft is thrown
 * away over it. Only backslashes that do not begin a legal JSON escape are
 * doubled, so genuine \n, \", \\ and \uXXXX sequences are left untouched.
 */
function escapeLoneBackslashes(text: string): string {
  return text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
}

export class DraftedPlanParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "DraftedPlanParseError";
  }
}

export function parseDraftedPlan(raw: string): DraftedPlan {
  const candidate = extractObject(stripCodeFence(raw));
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (firstError) {
    // One repair attempt before giving up: a lone backslash from a regex in
    // replyPattern is the common case, and re-drafting for it wastes a turn.
    try {
      json = JSON.parse(escapeLoneBackslashes(candidate));
    } catch {
      throw new DraftedPlanParseError(`Not valid JSON: ${(firstError as Error).message}`, raw);
    }
  }
  const result = draftedPlanSchema.safeParse(json);
  if (!result.success) {
    throw new DraftedPlanParseError(`Did not match the expected shape: ${result.error.message}`, raw);
  }
  const missingRoles = result.data.plan.steps
    .map((step) => step.role)
    .filter((role) => !(role in result.data.castByRole));
  if (missingRoles.length > 0) {
    throw new DraftedPlanParseError(`castByRole is missing an entry for role(s): ${missingRoles.join(", ")}`, raw);
  }
  return {
    plan: {
      steps: result.data.plan.steps.map((step) => ({
        id: step.id,
        role: step.role,
        instruction: step.instruction,
        needs: step.needs,
        produces: step.produces,
        ...(step.replyPattern !== undefined ? { replyPattern: step.replyPattern } : {}),
      })),
      contextMode: result.data.plan.contextMode,
      source: result.data.plan.source,
    },
    castByRole: result.data.castByRole,
  };
}
