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
  it("is static (no PlanDrafter/instance needed) and spawns a worker from an \"existing\" template", async () => {
    const spawnedFrom: string[] = [];
    const creator: AgentCreator = {
      createAgent: async () => {
        throw new Error("should not be called");
      },
      spawnWorkerFromTemplate: async (templateId) => {
        spawnedFrom.push(templateId);
        return { id: "worker-from-agent-1" };
      },
      getAgent: () => ({ kind: "template", name: "Implementer" }),
    };

    const job = await Orchestrator.approve("My Job", "do the thing", validDraft, creator, "chat-1");

    // The template is cloned into a fresh worker rather than cast directly, so
    // the role definition itself never runs and never accumulates Job state.
    expect(spawnedFrom).toEqual(["agent-1"]);
    expect(job.castByRole.implementer).toBe("worker-from-agent-1");
    expect(job.chatId).toBe("chat-1");
    expect(job.status).toBe("pending");
    expect(job.cursor).toBe(0);
    expect(job.haltedReason).toBeNull();
    expect(job.plan).toEqual(validDraft.plan);
  });

  it("refuses a cast that names something other than one of Your Agents", async () => {
    const creator: AgentCreator = {
      createAgent: async () => ({ id: "unused" }),
      spawnWorkerFromTemplate: async () => {
        throw new Error("should not be called");
      },
      // The model only ever sees template ids, so a worker id here is a
      // hallucinated or stale one — caught where the Agent would be created.
      getAgent: () => ({ kind: "worker", name: "Diet Researcher" }),
    };

    await expect(
      Orchestrator.approve("My Job", "do the thing", validDraft, creator, "chat-1"),
    ).rejects.toThrow(/is a worker, not one of Your Agents/);
  });

  it("materializes a \"new\" cast proposal into a real worker before building the Job", async () => {
    const draftWithNewAgent: DraftedPlan = {
      plan: validDraft.plan,
      castByRole: { implementer: { kind: "new", name: "Fresh Agent", instructions: "be fresh" } },
    };
    const created: { name: string; instructions: string; kind?: string; parentChatId?: string | null }[] = [];
    const creator: AgentCreator = {
      createAgent: async (input) => {
        created.push(input);
        return { id: "new-agent-id" };
      },
      spawnWorkerFromTemplate: async () => {
        throw new Error("should not be called");
      },
      getAgent: () => ({ kind: "template", name: "unused" }),
    };

    const job = await Orchestrator.approve("My Job", "do the thing", draftWithNewAgent, creator, "chat-1");

    expect(created).toEqual([
      { name: "Fresh Agent", instructions: "be fresh", kind: "worker", parentChatId: "chat-1" },
    ]);
    expect(job.castByRole.implementer).toBe("new-agent-id");
  });
});
