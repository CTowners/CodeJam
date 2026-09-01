import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { RunCancelledError } from "./errors.js";
import { JsonStore } from "./store.js";
import type { AgentRunner, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

function makeCancellableRunner(): AgentRunner & { cancelled: boolean; started: Promise<void> } {
  let rejectRun: ((error: Error) => void) | null = null;
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const runner = {
    cancelled: false,
    started,
    async run(_request: RunnerRequest): Promise<RunnerResult> {
      return new Promise<RunnerResult>((_resolve, reject) => {
        rejectRun = reject;
        notifyStarted();
      });
    },
    async cancel(): Promise<boolean> {
      runner.cancelled = true;
      rejectRun?.(new RunCancelledError());
      return true;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
  return runner;
}

class FakeRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return {
      output: "Completed: " + request.prompt,
      threadId: request.threadId ?? "fake-thread",
      usage: { inputTokens: 12, outputTokens: 5 },
    };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeService(
  runner: AgentRunner = new FakeRunner(),
  envOverrides: Record<string, string> = {},
): Promise<AgentService> {
  const root = await mkdtemp(path.join(tmpdir(), "launchpad-test-"));
  temporaryDirectories.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
    ...envOverrides,
  });
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json")),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
  );
  await service.initialize();
  return service;
}

describe("Agent lifecycle", () => {
  it("creates, updates, stops, starts and deletes an Agent", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Builder" });
    expect(service.listAgents()).toHaveLength(1);
    expect((await service.updateAgent(agent.id, { description: "Builds apps" })).description)
      .toBe("Builds apps");
    expect((await service.stopAgent(agent.id)).status).toBe("stopped");
    expect((await service.startAgent(agent.id)).status).toBe("ready");
    await service.deleteAgent(agent.id);
    expect(service.listAgents()).toHaveLength(0);
  });

  it("forces the canonical instructions/description for kind: orchestrator, ignoring any client-supplied text", async () => {
    const service = await makeService();
    const chat = await service.createAgent({
      name: "My planning chat",
      kind: "orchestrator",
      description: "client-supplied, should be ignored",
      instructions: "client-supplied, should be ignored",
    });

    expect(chat.kind).toBe("orchestrator");
    expect(chat.name).toBe("My planning chat");
    expect(chat.instructions).not.toContain("client-supplied");
    expect(chat.instructions).toMatch(/DRAFT_PLAN/);
    expect(chat.description).not.toContain("client-supplied");

    const ordinary = await service.createAgent({ name: "Ordinary Agent", instructions: "do work" });
    expect(ordinary.kind).toBeUndefined();
  });

  it("persists a playground conversation", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Coder" });
    const { run } = await service.sendMessage(agent.id, "write hello world");
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    const messages = service.getMessages(agent.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("write hello world");
    expect(service.getAgent(agent.id).codexThreadId).toBe("fake-thread");
  });

  it("atomically accepts only one concurrent run per Agent", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const runner: AgentRunner = {
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Concurrent" });
    const attempts = await Promise.allSettled([
      service.sendMessage(agent.id, "first"),
      service.sendMessage(agent.id, "second"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(service.getMessages(agent.id)).toHaveLength(1);

    finish({ output: "done", threadId: "thread", usage: null });
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    if (accepted?.status === "fulfilled") {
      await expect.poll(() => service.getRun(accepted.value.run.id).status).toBe("completed");
    }
  });

  it("does not let start reset a busy Agent and admit a second run", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy" });
    const { run } = await service.sendMessage(agent.id, "first");

    await expect(service.startAgent(agent.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.sendMessage(agent.id, "second")).rejects.toMatchObject({
      statusCode: 409,
    });

    finish({ output: "done", threadId: "thread", usage: null });
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
  });
});

describe("AgentService as a TurnRunner (Job turns)", () => {
  it("runs a turn and updates codexThreadId, without creating a Playground message", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Turner" });

    const result = await service.runTurn(agent.id, "do the step", 5_000);

    expect(result).toMatchObject({ ok: true, error: null, reply: "Completed: do the step" });
    expect(service.getAgent(agent.id).codexThreadId).toBe("fake-thread");
    expect(service.getMessages(agent.id)).toHaveLength(0);
  });

  it("fails without throwing when Ark is not configured", async () => {
    const service = await makeService(new FakeRunner(), { ARK_API_KEY: "", ARK_MODEL: "" });
    const agent = await service.createAgent({ name: "Keyless" });

    const result = await service.runTurn(agent.id, "do the step", 5_000);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Ark is not configured/);
  });

  it("fails without throwing for an unknown Agent id", async () => {
    const service = await makeService();

    const result = await service.runTurn("00000000-0000-0000-0000-000000000000", "do it", 5_000);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Agent not found/);
  });

  it("fails without throwing when the Agent is already mid-turn", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy" });

    const first = service.runTurn(agent.id, "first", 5_000);
    const second = await service.runTurn(agent.id, "second", 5_000);

    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already running a turn/);

    finish({ output: "done", threadId: "thread", usage: null });
    await first;
  });

  it("clears codexThreadId on resetMemory", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Forgetful" });
    await service.runTurn(agent.id, "do the step", 5_000);
    expect(service.getAgent(agent.id).codexThreadId).not.toBeNull();

    await service.resetMemory(agent.id);

    expect(service.getAgent(agent.id).codexThreadId).toBeNull();
  });

  it("classifies its own watchdog timeout distinctly from a genuine external cancellation", async () => {
    const runner = makeCancellableRunner();
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Slow" });

    const result = await service.runTurn(agent.id, "do it", 20);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Turn timed out after 20ms/);
    expect(runner.cancelled).toBe(true);
  });

  it("keeps the original message when cancellation comes from outside the watchdog", async () => {
    const runner = makeCancellableRunner();
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Cancelled" });

    const turnPromise = service.runTurn(agent.id, "do it", 60_000);
    await runner.started;
    await runner.cancel(agent.id);
    const result = await turnPromise;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Run cancelled");
  });
});
