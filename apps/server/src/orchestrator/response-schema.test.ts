import { describe, expect, it } from "vitest";
import { DraftedPlanParseError, parseDraftedPlan } from "./response-schema.js";

const wellFormed = {
  plan: {
    steps: [
      {
        id: "s1",
        role: "implementer",
        instruction: "write the thing",
        needs: [],
        produces: ["out.txt"],
      },
    ],
    contextMode: "none",
    source: "generated",
  },
  castByRole: {
    implementer: { kind: "existing", agentId: "agent-1" },
  },
};

describe("parseDraftedPlan", () => {
  it("parses a well-formed response", () => {
    const parsed = parseDraftedPlan(JSON.stringify(wellFormed));
    expect(parsed.plan.steps).toHaveLength(1);
    expect(parsed.castByRole.implementer).toEqual({ kind: "existing", agentId: "agent-1" });
  });

  it("strips a markdown code fence the model added anyway", () => {
    const fenced = "```json\n" + JSON.stringify(wellFormed) + "\n```";
    const parsed = parseDraftedPlan(fenced);
    expect(parsed.plan.steps[0]!.id).toBe("s1");
  });

  it("accepts a \"new\" cast proposal", () => {
    const withNewAgent = {
      ...wellFormed,
      castByRole: {
        implementer: { kind: "new", name: "Fresh Agent", instructions: "do the new-agent thing" },
      },
    };
    const parsed = parseDraftedPlan(JSON.stringify(withNewAgent));
    expect(parsed.castByRole.implementer).toEqual({
      kind: "new",
      name: "Fresh Agent",
      instructions: "do the new-agent thing",
    });
  });

  it("throws DraftedPlanParseError on invalid JSON", () => {
    expect(() => parseDraftedPlan("not json at all")).toThrow(DraftedPlanParseError);
  });

  it("throws DraftedPlanParseError when the shape doesn't match", () => {
    expect(() => parseDraftedPlan(JSON.stringify({ plan: {} }))).toThrow(DraftedPlanParseError);
  });

  it("throws when castByRole is missing an entry for a Step's role", () => {
    const missingCast = { ...wellFormed, castByRole: {} };
    expect(() => parseDraftedPlan(JSON.stringify(missingCast))).toThrow(/missing an entry for role/);
  });

  it("tolerates a model sending null for replyPattern/needs/produces instead of omitting them", () => {
    const withNulls = {
      plan: {
        steps: [
          {
            id: "s1",
            role: "implementer",
            instruction: "write the thing",
            needs: null,
            produces: null,
            replyPattern: null,
          },
        ],
        contextMode: "none",
        source: "generated",
      },
      castByRole: { implementer: { kind: "existing", agentId: "agent-1" } },
    };

    const parsed = parseDraftedPlan(JSON.stringify(withNulls));

    expect(parsed.plan.steps[0]).toEqual({
      id: "s1",
      role: "implementer",
      instruction: "write the thing",
      needs: [],
      produces: [],
    });
  });
});
