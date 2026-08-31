import { describe, expect, it } from "vitest";
import { fail, ok, FakeTurnRunner } from "../coordinator/fake-turn-runner.js";
import { ModelPlanDrafter } from "./model-plan-drafter.js";

const wellFormedReply = JSON.stringify({
  plan: {
    steps: [{ id: "s1", role: "implementer", instruction: "build it", needs: [], produces: [] }],
    contextMode: "none",
    source: "generated",
  },
  castByRole: { implementer: { kind: "existing", agentId: "agent-1" } },
});

describe("ModelPlanDrafter", () => {
  it("sends the draft prompt through the given orchestrator Agent and parses the reply", async () => {
    const runner = new FakeTurnRunner();
    runner.queue("orchestrator-agent", async (agentId, prompt) => {
      expect(agentId).toBe("orchestrator-agent");
      expect(prompt).toMatch(/do the thing/);
      return ok(wellFormedReply);
    });

    const drafter = new ModelPlanDrafter(runner, "orchestrator-agent");
    const draft = await drafter.draft("do the thing", []);

    expect(draft.plan.steps[0]!.role).toBe("implementer");
  });

  it("surfaces a runner failure as a rejected promise instead of a bad parse", async () => {
    const runner = new FakeTurnRunner(async () => fail("503 service unavailable"));
    const drafter = new ModelPlanDrafter(runner, "orchestrator-agent");

    await expect(drafter.draft("do the thing", [])).rejects.toThrow(/Plan drafting turn failed/);
  });
});
