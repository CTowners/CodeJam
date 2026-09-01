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

export const draftedPlanSchema = z.object({
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

export class DraftedPlanParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "DraftedPlanParseError";
  }
}

/**
 * Shared by both entry points below: the zod schema's transforms produce
 * `replyPattern: string | undefined` as an always-present key, which
 * `exactOptionalPropertyTypes` rejects for PlanStep's optional field — so the
 * object is rebuilt here with the key omitted entirely when absent, once,
 * rather than duplicating this reconstruction at every caller.
 */
function toDraftedPlan(raw: string, data: z.infer<typeof draftedPlanSchema>): DraftedPlan {
  const missingRoles = data.plan.steps.map((step) => step.role).filter((role) => !(role in data.castByRole));
  if (missingRoles.length > 0) {
    throw new DraftedPlanParseError(`castByRole is missing an entry for role(s): ${missingRoles.join(", ")}`, raw);
  }
  return {
    plan: {
      steps: data.plan.steps.map((step) => ({
        id: step.id,
        role: step.role,
        instruction: step.instruction,
        needs: step.needs,
        produces: step.produces,
        ...(step.replyPattern !== undefined ? { replyPattern: step.replyPattern } : {}),
      })),
      contextMode: data.plan.contextMode,
      source: data.plan.source,
    },
    castByRole: data.castByRole,
  };
}

export function parseDraftedPlan(raw: string): DraftedPlan {
  const candidate = stripCodeFence(raw);
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (error) {
    throw new DraftedPlanParseError(`Not valid JSON: ${(error as Error).message}`, raw);
  }
  const result = draftedPlanSchema.safeParse(json);
  if (!result.success) {
    throw new DraftedPlanParseError(`Did not match the expected shape: ${result.error.message}`, raw);
  }
  return toDraftedPlan(raw, result.data);
}

/**
 * Same validation as parseDraftedPlan, for a value that's already a parsed
 * JSON object (an HTTP request body) rather than a raw model-reply string —
 * used to revalidate a client-submitted plan on /api/jobs/approve.
 */
export function parseDraftedPlanValue(value: unknown): DraftedPlan {
  const raw = JSON.stringify(value);
  const result = draftedPlanSchema.safeParse(value);
  if (!result.success) {
    throw new DraftedPlanParseError(`Did not match the expected shape: ${result.error.message}`, raw);
  }
  return toDraftedPlan(raw, result.data);
}
