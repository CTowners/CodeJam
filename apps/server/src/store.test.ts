import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "./store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JsonStore migrations", () => {
  const writeDatabase = async (contents: unknown): Promise<string> => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-migrate-test-"));
    temporaryDirectories.push(root);
    const filePath = path.join(root, "db.json");
    await writeFile(filePath, JSON.stringify(contents), "utf8");
    return filePath;
  };

  const v2Agent = (id: string, name: string) => ({
    id,
    name,
    description: "",
    instructions: "do things",
    capabilitySummary: "do things",
    status: "ready",
    workspacePath: "/tmp/ws/" + id,
    codexThreadId: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("promotes exactly one Agent to chat, even when two carry a chat-like name", async () => {
    // Nothing ever reserved these names, so a v2 database can legitimately hold
    // two. Promoting both would give two indistinguishable Chats with drafting
    // silently bound to whichever came first.
    const filePath = await writeDatabase({
      version: 2,
      agents: [v2Agent("id-1", "Orchestrator"), v2Agent("id-2", "Orchestrator"), v2Agent("id-3", "Coder")],
      messages: [],
      runs: [],
      jobs: [],
      jobMessages: [],
      events: [],
    });
    const store = new JsonStore(filePath);
    await store.initialize();

    const agents = store.snapshot().agents;
    expect(agents.filter((agent) => agent.kind === "chat")).toHaveLength(1);
    expect(agents.find((agent) => agent.id === "id-1")!.kind).toBe("chat");
    expect(agents.find((agent) => agent.id === "id-1")!.name).toBe("Chat");
    expect(agents.find((agent) => agent.id === "id-2")!.kind).toBe("template");
    expect(agents.find((agent) => agent.id === "id-2")!.name).toBe("Orchestrator");
    expect(agents.find((agent) => agent.id === "id-3")!.kind).toBe("template");
  });

  it("backfills chatId onto Jobs that predate it", async () => {
    const filePath = await writeDatabase({
      version: 2,
      agents: [v2Agent("chat-id", "Orchestrator")],
      messages: [],
      runs: [],
      jobs: [
        {
          id: "job-1",
          name: "Old job",
          task: "do it",
          castByRole: {},
          plan: { steps: [], contextMode: "none", source: "builtin" },
          status: "completed",
          cursor: 0,
          haltedReason: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      jobMessages: [],
      events: [],
    });
    const store = new JsonStore(filePath);
    await store.initialize();

    expect(store.snapshot().jobs[0]!.chatId).toBe("chat-id");
  });

  it("chains v1 straight through to v3, keeping workspaces and adding kinds", async () => {
    const filePath = await writeDatabase({
      version: 1,
      agents: [
        {
          id: "id-1",
          name: "Coder",
          description: "",
          instructions: "write code",
          status: "ready",
          workspacePath: "/tmp/ws/id-1",
          codexThreadId: null,
          lastError: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      messages: [],
      runs: [],
    });
    const store = new JsonStore(filePath);
    await store.initialize();

    const database = store.snapshot();
    expect(database.version).toBe(3);
    const agent = database.agents[0]!;
    expect(agent.kind).toBe("template");
    expect(agent.capabilitySummary).toBe("write code");
    // Every kind keeps its workspace: a template is chattable one-to-one too.
    expect(agent.workspacePath).toBe("/tmp/ws/id-1");
    // The migrated result is written back, so the next load is a plain v3 read.
    expect(JSON.parse(await readFile(filePath, "utf8")).version).toBe(3);
  });
});

describe("JsonStore", () => {
  it("does not publish a mutation in memory when persistence fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "launchpad-store-test-"));
    temporaryDirectories.push(root);
    const originalPath = path.join(root, "db.json");
    const store = new JsonStore(originalPath);
    await store.initialize();

    const mutableStore = store as unknown as { filePath: string };
    mutableStore.filePath = path.join(root, "missing-directory", "db.json");
    await expect(
      store.mutate((database) => {
        database.messages.push({
          id: "message-1",
          agentId: "agent-1",
          runId: "run-1",
          role: "user",
          content: "must not become visible",
          createdAt: new Date().toISOString(),
        });
      }),
    ).rejects.toThrow();
    expect(store.snapshot().messages).toEqual([]);

    mutableStore.filePath = originalPath;
    await store.mutate((database) => {
      database.messages.push({
        id: "message-2",
        agentId: "agent-1",
        runId: "run-2",
        role: "user",
        content: "queue recovered",
        createdAt: new Date().toISOString(),
      });
    });
    expect(store.snapshot().messages.map((message) => message.content)).toEqual([
      "queue recovered",
    ]);
  });
});
