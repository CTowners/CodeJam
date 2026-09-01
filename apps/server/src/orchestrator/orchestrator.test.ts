import { describe, expect, it } from "vitest";
import type { DraftedPlan } from "../contracts.js";
import type { AgentCreator } from "./materialize.js";
import { Orchestrator } from "./orchestrator.js";

const validDraft: DraftedPlan = {
  plan: {
    steps: [{ id: "s1", role: "implementer", instruction: "build it", needs: [], produces: ["out.txt"] }],
    contextMode: "none",
    source: "generated",
  },
  castByRole: { implementer: { kind: "existing", agentId: "agent-1" } },
};

describe("Orchestrator.approve", () => {
  it("passes an \"existing\" cast proposal through unchanged", async () => {
    const creator: AgentCreator = {
      createAgent: async () => {
        throw new Error("should not be called");
      },
    };

    const job = await Orchestrator.approve("My Job", "do the thing", validDraft, creator);

    expect(job.castByRole.implementer).toBe("agent-1");
    expect(job.status).toBe("pending");
    expect(job.cursor).toBe(0);
    expect(job.haltedReason).toBeNull();
    expect(job.plan).toEqual(validDraft.plan);
  });

  it("materializes a \"new\" cast proposal into a real Agent before building the Job", async () => {
    const draftWithNewAgent: DraftedPlan = {
      plan: validDraft.plan,
      castByRole: { implementer: { kind: "new", name: "Fresh Agent", instructions: "be fresh" } },
    };
    const created: { name: string; instructions: string }[] = [];
    const creator: AgentCreator = {
      createAgent: async (input) => {
        created.push(input);
        return { id: "new-agent-id" };
      },
    };

    const job = await Orchestrator.approve("My Job", "do the thing", draftWithNewAgent, creator);

    expect(created).toEqual([{ name: "Fresh Agent", instructions: "be fresh" }]);
    expect(job.castByRole.implementer).toBe("new-agent-id");
  });
});
