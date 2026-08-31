import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Job, Plan, PlanStep } from "../contracts.js";
import { Coordinator } from "./coordinator.js";
import { FakeTurnRunner, fail, ok } from "./fake-turn-runner.js";
import { FileCourier } from "./file-courier.js";

const now = () => new Date().toISOString();

function makeJob(steps: PlanStep[], castByRole: Record<string, string>, contextMode: Plan["contextMode"] = "none"): Job {
  return {
    id: randomUUID(),
    name: "test job",
    task: "do the thing",
    castByRole,
    plan: { steps, contextMode, source: "builtin" },
    status: "pending",
    cursor: 0,
    haltedReason: null,
    createdAt: now(),
    completedAt: null,
  };
}

describe("Coordinator", () => {
  let root: string;
  let stagingDir: string;
  let workspaces: Map<string, string>;
  let courier: FileCourier;

  const workspacePathForAgent = (agentId: string): string => {
    const existing = workspaces.get(agentId);
    if (existing) return existing;
    throw new Error(`no workspace registered for ${agentId}`);
  };

  const registerAgentWorkspace = async (agentId: string): Promise<string> => {
    const dir = path.join(root, "workspaces", agentId);
    await mkdir(dir, { recursive: true });
    workspaces.set(agentId, dir);
    return dir;
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "coordinator-test-"));
    stagingDir = path.join(root, "staging");
    await mkdir(stagingDir, { recursive: true });
    workspaces = new Map();
    courier = new FileCourier(stagingDir);
  });

  it("runs a single-step Plan to completion and copies produces into staging", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner();
    runner.queue("agent-1", async () => {
      await writeFile(path.join(workspacePathForAgent("agent-1"), "out.txt"), "42\n");
      return ok("42");
    });

    const step: PlanStep = { id: "s1", role: "counter", instruction: "count", needs: [], produces: ["out.txt"], replyPattern: "^\\d+$" };
    const job = makeJob([step], { counter: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished, messages, events } = await coordinator.run(job);

    expect(finished.status).toBe("completed");
    expect(finished.haltedReason).toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("42");
    expect(events.map((e) => e.type)).toEqual([
      "job_started",
      "turn_started",
      "files_copied_out",
      "turn_completed",
      "job_completed",
    ]);

    const staged = await readFile(path.join(stagingDir, "out.txt"), "utf8");
    expect(staged).toBe("42\n");
  });

  it("clears temporary workspace copies at Job completion but keeps staging", async () => {
    await registerAgentWorkspace("agent-1");
    await registerAgentWorkspace("agent-2");
    await courier.seed("input.txt", "seed-data");

    const runner = new FakeTurnRunner();
    runner.queue("agent-1", async () => {
      await writeFile(path.join(workspacePathForAgent("agent-1"), "mid.txt"), "mid");
      return ok("done");
    });
    runner.queue("agent-2", async () => {
      await writeFile(path.join(workspacePathForAgent("agent-2"), "final.txt"), "final");
      return ok("done");
    });

    const steps: PlanStep[] = [
      { id: "s1", role: "a", instruction: "step 1", needs: ["input.txt"], produces: ["mid.txt"] },
      { id: "s2", role: "b", instruction: "step 2", needs: ["mid.txt"], produces: ["final.txt"] },
    ];
    const job = makeJob(steps, { a: "agent-1", b: "agent-2" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished } = await coordinator.run(job);

    expect(finished.status).toBe("completed");

    // needs copied into workspace-1, then cleared after the Job finished
    await expect(stat(path.join(workspacePathForAgent("agent-1"), "input.txt"))).rejects.toThrow();
    await expect(stat(path.join(workspacePathForAgent("agent-2"), "mid.txt"))).rejects.toThrow();

    // staging area persists as demo evidence
    expect(await readFile(path.join(stagingDir, "input.txt"), "utf8")).toBe("seed-data");
    expect(await readFile(path.join(stagingDir, "mid.txt"), "utf8")).toBe("mid");
    expect(await readFile(path.join(stagingDir, "final.txt"), "utf8")).toBe("final");
  });

  it("actually runs independent Steps concurrently, not one at a time", async () => {
    await registerAgentWorkspace("agent-1");
    await registerAgentWorkspace("agent-2");

    let started = 0;
    let releaseBoth: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });

    const runner = new FakeTurnRunner(async () => {
      started += 1;
      if (started === 2) releaseBoth();
      // If the Coordinator ran these sequentially, this await would hang until
      // the test's own timeout, since the second call would never arrive.
      await bothStarted;
      return ok("done");
    });

    const steps: PlanStep[] = [
      { id: "s1", role: "a", instruction: "step 1", needs: [], produces: [] },
      { id: "s2", role: "b", instruction: "step 2", needs: [], produces: [] },
    ];
    const job = makeJob(steps, { a: "agent-1", b: "agent-2" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished } = await coordinator.run(job);

    expect(finished.status).toBe("completed");
    expect(started).toBe(2);
  });

  it("retries a validation failure (missing produces) up to the bound, then succeeds", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner();
    runner.queue(
      "agent-1",
      async () => ok("no file yet"),
      async () => {
        await writeFile(path.join(workspacePathForAgent("agent-1"), "out.txt"), "ready");
        return ok("ready");
      },
    );

    const step: PlanStep = { id: "s1", role: "a", instruction: "write file", needs: [], produces: ["out.txt"] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent }, { backoffMs: () => 0 });
    const { job: finished, events } = await coordinator.run(job);

    expect(finished.status).toBe("completed");
    expect(events.map((e) => e.type)).toEqual([
      "job_started",
      "turn_started",
      "turn_rejected",
      "turn_retried",
      "turn_started",
      "files_copied_out",
      "turn_completed",
      "job_completed",
    ]);
  });

  it("halts after exhausting retries on a validation failure", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => ok("never writes the file"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "write file", needs: [], produces: ["out.txt"] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent }, { backoffMs: () => 0 });
    const { job: finished, events } = await coordinator.run(job);

    expect(finished.status).toBe("halted");
    expect(finished.haltedReason).toMatch(/exhausted retries \(validation\)/);
    const rejectedCount = events.filter((e) => e.type === "turn_rejected").length;
    expect(rejectedCount).toBe(3); // 1 initial attempt + 2 retries (maxRetriesPerStep)
  });

  it("halts immediately on an auth failure without retrying", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => fail("401 Unauthorized: invalid api key"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: [], produces: [] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished, events } = await coordinator.run(job);

    expect(finished.status).toBe("halted");
    expect(finished.haltedReason).toMatch(/Auth error/);
    expect(events.filter((e) => e.type === "turn_retried")).toHaveLength(0);
    expect(events.filter((e) => e.type === "turn_started")).toHaveLength(1);
  });

  it("retries a transient failure with backoff, then succeeds", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner();
    runner.queue("agent-1", async () => fail("ECONNRESET: socket hang up"), async () => ok("done"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: [], produces: [] };
    const job = makeJob([step], { a: "agent-1" });

    const backoffCalls: number[] = [];
    const coordinator = new Coordinator(
      { runner, courier, workspacePathForAgent },
      {
        backoffMs: (attempt) => {
          backoffCalls.push(attempt);
          return 0;
        },
      },
    );
    const { job: finished } = await coordinator.run(job);

    expect(finished.status).toBe("completed");
    expect(backoffCalls).toEqual([1]);
  });

  it("marks a cancelled turn cleanly, never as a failure", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => fail("Run cancelled"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: [], produces: [] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished, events } = await coordinator.run(job);

    expect(finished.status).toBe("halted");
    expect(finished.haltedReason).toBe("Cancelled by user");
    expect(events.filter((e) => e.type === "turn_retried")).toHaveLength(0);
  });

  it("rejects an invalid Plan (overlapping produces) before running any turn", async () => {
    const runner = new FakeTurnRunner(async () => ok("should never run"));
    const steps: PlanStep[] = [
      { id: "s1", role: "a", instruction: "x", needs: [], produces: ["shared.txt"] },
      { id: "s2", role: "b", instruction: "y", needs: [], produces: ["shared.txt"] },
    ];
    const job = makeJob(steps, { a: "agent-1", b: "agent-2" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished, events } = await coordinator.run(job);

    expect(finished.status).toBe("halted");
    expect(finished.haltedReason).toMatch(/both declare produces "shared\.txt"/);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("job_halted");
  });

  it("treats a runner that throws the same as an ok:false result, instead of crashing the Job", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => {
      throw new Error("401 unauthorized: bad key");
    });
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: [], produces: [] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished } = await coordinator.run(job);

    expect(finished.status).toBe("halted");
    expect(finished.haltedReason).toMatch(/Auth error/);
  });

  it("fires onEvent/onMessage/onJobUpdate as the Job progresses, not only at the end", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => ok("42"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "count", needs: [], produces: [] };
    const job = makeJob([step], { a: "agent-1" });

    const liveEvents: string[] = [];
    const liveMessages: string[] = [];
    const liveStatuses: string[] = [];
    const liveCursors: number[] = [];
    const coordinator = new Coordinator(
      { runner, courier, workspacePathForAgent },
      {
        onEvent: (event) => liveEvents.push(event.type),
        onMessage: (message) => liveMessages.push(message.content),
        onJobUpdate: (updated) => {
          liveStatuses.push(updated.status);
          liveCursors.push(updated.cursor);
        },
      },
    );
    await coordinator.run(job);

    expect(liveEvents).toEqual(["job_started", "turn_started", "turn_completed", "job_completed"]);
    expect(liveMessages).toEqual(["42"]);
    // job_started -> "running" (cursor 0); the Step finishing -> "running" again
    // (cursor 1, the progress counter, live-updated); job_completed -> "completed".
    expect(liveStatuses).toEqual(["running", "running", "completed"]);
    expect(liveCursors).toEqual([0, 1, 1]);
  });

  it("checks replyPattern against the last non-empty line of the reply", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => ok("some chatter\n\nPASS"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "test", needs: [], produces: [], replyPattern: "^(PASS|FAIL:.*)$" };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished } = await coordinator.run(job);

    expect(finished.status).toBe("completed");
  });

  it("classifies a stale/missing Agent id instead of letting run() reject", async () => {
    // Deliberately never registered — mirrors a deleted/renamed Agent still in castByRole.
    const runner = new FakeTurnRunner(async () => ok("should never be called"));
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: [], produces: [] };
    const job = makeJob([step], { a: "agent-ghost" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent }, { backoffMs: () => 0 });
    const { job: finished } = await coordinator.run(job); // must not reject

    expect(finished.status).toBe("halted");
    expect(finished.haltedReason).toMatch(/no workspace registered for agent-ghost/);
  });

  it("classifies a courier copyIn failure instead of letting run() reject", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => ok("should never be called"));
    // needs a file that was never seeded into staging — copyIn will throw ENOENT.
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: ["missing.txt"], produces: [] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent }, { backoffMs: () => 0 });
    const { job: finished } = await coordinator.run(job); // must not reject

    expect(finished.status).toBe("halted");
  });

  it("classifies a courier copyOut failure instead of letting run() reject", async () => {
    const workspaceDir = await registerAgentWorkspace("agent-1");
    // A plain file sits where the staging dir needs to be, so copyOut's own
    // mkdir(..., { recursive: true }) fails (ENOTDIR) instead of silently working.
    const blockedStagingPath = path.join(root, "blocked-staging-dir");
    await writeFile(blockedStagingPath, "not a directory");
    const brokenCourier = new FileCourier(blockedStagingPath);
    const runner = new FakeTurnRunner(async () => {
      await writeFile(path.join(workspaceDir, "out.txt"), "done");
      return ok("done");
    });
    const step: PlanStep = { id: "s1", role: "a", instruction: "do work", needs: [], produces: ["out.txt"] };
    const job = makeJob([step], { a: "agent-1" });

    const coordinator = new Coordinator(
      { runner, courier: brokenCourier, workspacePathForAgent },
      { backoffMs: () => 0 },
    );
    const { job: finished } = await coordinator.run(job); // must not reject

    expect(finished.status).toBe("halted");
  });

  it("notes two independent Steps cast to the same Agent in the job_started event, without failing the Job", async () => {
    await registerAgentWorkspace("agent-1");
    const runner = new FakeTurnRunner(async () => ok("done"));
    const steps: PlanStep[] = [
      { id: "s1", role: "a", instruction: "x", needs: [], produces: [] },
      { id: "s2", role: "b", instruction: "y", needs: [], produces: [] },
    ];
    const job = makeJob(steps, { a: "agent-1", b: "agent-1" });

    const coordinator = new Coordinator({ runner, courier, workspacePathForAgent });
    const { job: finished, events } = await coordinator.run(job);

    expect(finished.status).toBe("completed");
    const jobStarted = events.find((event) => event.type === "job_started");
    expect(jobStarted?.detail).toMatch(/"s1".*"s2".*same Agent/);
  });
});
