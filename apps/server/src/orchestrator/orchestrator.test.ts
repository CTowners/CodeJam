import { describe, expect, it } from "vitest";
import type { DraftedPlan } from "../contracts.js";
import { HttpError } from "../errors.js";
import { FakePlanDrafter } from "./fake-plan-drafter.js";
import type { AgentCreator } from "./materialize.js";
import { Orchestrator, OrchestratorDraftError } from "./orchestrator.js";

const validDraft: DraftedPlan = {
  plan: {
    steps: [{ id: "s1", role: "implementer", instruction: "build it", needs: [], produces: ["out.txt"] }],
    contextMode: "none",
    source: "generated",
  },
  castByRole: { implementer: { kind: "existing", agentId: "agent-1" } },
};

const invalidDraft: DraftedPlan = {
  plan: {
    steps: [
      { id: "s1", role: "a", instruction: "x", needs: [], produces: ["same.txt"] },
      { id: "s2", role: "b", instruction: "y", needs: [], produces: ["same.txt"] },
    ],
    contextMode: "none",
    source: "generated",
  },
  castByRole: { a: { kind: "existing", agentId: "agent-1" }, b: { kind: "existing", agentId: "agent-2" } },
};

describe("Orchestrator.draftPlan", () => {
  it("returns the draft immediately when it validates", async () => {
    const drafter = new FakePlanDrafter(async () => validDraft);
    const orchestrator = new Orchestrator(drafter);

    const result = await orchestrator.draftPlan("do the thing", []);

    expect(result).toEqual(validDraft);
    expect(drafter.calls).toHaveLength(1);
    expect(drafter.calls[0]!.guidance).toBeUndefined();
  });

  it("retries once with the validation errors as guidance, then accepts a fixed draft", async () => {
    const drafter = new FakePlanDrafter();
    drafter.enqueue(
      async () => invalidDraft,
      async () => validDraft,
    );
    const orchestrator = new Orchestrator(drafter);

    const result = await orchestrator.draftPlan("do the thing", []);

    expect(result).toEqual(validDraft);
    expect(drafter.calls).toHaveLength(2);
    expect(drafter.calls[1]!.guidance).toMatch(/both declare produces "same\.txt"/);
  });

  it("gives up after exhausting attempts on a persistently invalid draft", async () => {
    const drafter = new FakePlanDrafter(async () => invalidDraft);
    const orchestrator = new Orchestrator(drafter);

    await expect(orchestrator.draftPlan("do the thing", [])).rejects.toThrow(OrchestratorDraftError);
    expect(drafter.calls).toHaveLength(2);
  });

  it("fails fast with a clean HttpError, without retrying, when the drafting turn itself fails", async () => {
    const drafter = new FakePlanDrafter(async () => {
      throw new Error("Plan drafting turn failed: This Agent is stopped");
    });
    const orchestrator = new Orchestrator(drafter);

    const rejection = orchestrator.draftPlan("do the thing", []);
    await expect(rejection).rejects.toThrow(HttpError);
    await expect(rejection).rejects.toThrow(/This Agent is stopped/);
    // A stopped Agent won't un-stop itself between attempts — retrying blindly
    // would just fail the same way twice for no benefit, so this must not retry.
    expect(drafter.calls).toHaveLength(1);
  });
});

describe("Orchestrator.approve", () => {
  it("is static (no PlanDrafter/instance needed) and passes an \"existing\" cast proposal through unchanged", async () => {
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
