import { describe, expect, it } from "vitest";
import { classifyFailure } from "./failure-classifier.js";

describe("classifyFailure", () => {
  it("classifies a stale/missing cast as auth (halt immediately, retrying can't fix a bad id)", () => {
    expect(classifyFailure("Agent not found")).toBe("auth");
  });

  it("classifies an Agent a human has stopped as auth (needs a human to restart it, not a retry)", () => {
    expect(classifyFailure("This Agent is stopped")).toBe("auth");
  });

  it("classifies a busy Agent as transient (mid someone-else's-turn right now, likely to free up)", () => {
    expect(classifyFailure("This Agent is already running a turn")).toBe("transient");
  });

  it("classifies a plain wrong-output message as validation, the default bucket", () => {
    expect(classifyFailure("Codex completed without an agent message")).toBe("validation");
  });

  it("classifies an explicit cancellation as cancelled", () => {
    expect(classifyFailure("Run cancelled")).toBe("cancelled");
  });

  it("classifies a network-shaped error as transient", () => {
    expect(classifyFailure("connect ECONNREFUSED 127.0.0.1:443")).toBe("transient");
  });

  it("classifies a path-traversal escape as auth (a malicious/hallucinated path won't fix itself on retry)", () => {
    expect(classifyFailure('Path "../../etc/passwd" escapes its intended root')).toBe("auth");
  });
});
