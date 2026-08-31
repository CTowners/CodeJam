import { describe, expect, it } from "vitest";
import type { Plan } from "../contracts.js";
import { sameAgentConflicts, validatePlan } from "./plan-validation.js";

describe("validatePlan", () => {
  it("accepts a Plan with no conflicts", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: [], produces: ["out.txt"] },
        { id: "s2", role: "b", instruction: "y", needs: ["out.txt"], produces: [] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    expect(validatePlan(plan)).toEqual([]);
  });

  it("flags two Steps declaring the same produces", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: [], produces: ["out.txt"] },
        { id: "s2", role: "b", instruction: "y", needs: [], produces: ["out.txt"] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    expect(validatePlan(plan)).toHaveLength(1);
  });

  it("flags a Step needing a file from a later Step", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: ["out.txt"], produces: [] },
        { id: "s2", role: "b", instruction: "y", needs: [], produces: ["out.txt"] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    expect(validatePlan(plan)).toHaveLength(1);
  });
});

describe("sameAgentConflicts", () => {
  it("returns nothing when every role has a distinct Agent", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: [], produces: [] },
        { id: "s2", role: "b", instruction: "y", needs: [], produces: [] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    expect(sameAgentConflicts(plan, { a: "agent-1", b: "agent-2" })).toEqual([]);
  });

  it("flags two independent Steps cast to the same Agent", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: [], produces: [] },
        { id: "s2", role: "b", instruction: "y", needs: [], produces: [] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    const notes = sameAgentConflicts(plan, { a: "agent-1", b: "agent-1" });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/"s1".*"s2".*same Agent/);
  });

  it("does not flag two Steps sharing an Agent when one depends on the other", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: [], produces: ["out.txt"] },
        { id: "s2", role: "b", instruction: "y", needs: ["out.txt"], produces: [] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    expect(sameAgentConflicts(plan, { a: "agent-1", b: "agent-1" })).toEqual([]);
  });

  it("does not flag two Steps sharing an Agent when the dependency is indirect (transitive)", () => {
    const plan: Plan = {
      steps: [
        { id: "s1", role: "a", instruction: "x", needs: [], produces: ["mid.txt"] },
        { id: "s2", role: "b", instruction: "y", needs: ["mid.txt"], produces: ["out.txt"] },
        { id: "s3", role: "c", instruction: "z", needs: ["out.txt"], produces: [] },
      ],
      contextMode: "none",
      source: "builtin",
    };
    // s1 and s3 share an Agent but s1 -> s2 -> s3 already forces the order.
    expect(sameAgentConflicts(plan, { a: "agent-1", b: "agent-2", c: "agent-1" })).toEqual([]);
  });

  it("ignores roles with no cast entry", () => {
    const plan: Plan = {
      steps: [{ id: "s1", role: "a", instruction: "x", needs: [], produces: [] }],
      contextMode: "none",
      source: "builtin",
    };
    expect(sameAgentConflicts(plan, {})).toEqual([]);
  });
});
