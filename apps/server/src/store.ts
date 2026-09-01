import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarizeCapability } from "./capability-summary.js";
import type { Database, DatabaseV1, DatabaseV2 } from "./types.js";
import { CHAT_AGENT_NAME, LEGACY_ORCHESTRATOR_AGENT_NAME } from "./agent-kinds.js";

const emptyDatabase = (): Database => ({
  version: 3,
  agents: [],
  messages: [],
  runs: [],
  jobs: [],
  jobMessages: [],
  events: [],
});

const isDatabaseV1 = (parsed: { version: unknown }): parsed is DatabaseV1 =>
  parsed.version === 1;

const isDatabaseV2 = (parsed: { version: unknown }): parsed is DatabaseV2 =>
  parsed.version === 2;

/** v1 had no coordination collections and no Agent.capabilitySummary. */
const migrateV1 = (v1: DatabaseV1): DatabaseV2 => ({
  version: 2,
  agents: v1.agents.map((agent) => ({
    ...agent,
    capabilitySummary: summarizeCapability(agent.instructions),
  })),
  messages: v1.messages,
  runs: v1.runs,
  jobs: [],
  jobMessages: [],
  events: [],
});

/**
 * v2 had one flat kind of Agent. v3 splits them: the old singleton "Orchestrator"
 * becomes the first "chat" (and takes its new name with it, since the chat is
 * looked up by name), and everything the user made by hand becomes a "template".
 *
 * Every kind keeps its workspace: a template is castable by a chat AND holds its
 * own one-to-one conversation, so it still needs somewhere for Codex to work.
 */
const migrateV2 = (v2: DatabaseV2): Database => {
  const looksLikeChat = (name: string): boolean =>
    name === LEGACY_ORCHESTRATOR_AGENT_NAME || name === CHAT_AGENT_NAME;
  // Exactly ONE agent becomes the chat, by id — nothing ever stopped a user
  // hand-making a second agent called "Orchestrator", and promoting both would
  // give two indistinguishable chats with drafting silently bound to one of them.
  const chatId = v2.agents.find((agent) => looksLikeChat(agent.name))?.id ?? "";

  return {
    version: 3,
    agents: v2.agents.map((agent) => {
      const isChat = agent.id === chatId;
      return {
        ...agent,
        kind: isChat ? ("chat" as const) : ("template" as const),
        parentChatId: null,
        name: isChat ? CHAT_AGENT_NAME : agent.name,
        workspacePath: agent.workspacePath,
      };
    }),
    messages: v2.messages,
    runs: v2.runs,
    // Jobs predate chatId. Attribute them to the one chat that existed, so old
    // Jobs still nest in the sidebar instead of hanging off a chat id nothing has.
    jobs: v2.jobs.map((job) => ({ ...job, chatId: job.chatId ?? chatId })),
    jobMessages: v2.jobMessages,
    events: v2.events,
  };
};

export class JsonStore {
  private data: Database = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Database | DatabaseV1 | DatabaseV2;
      if (!Array.isArray(parsed.agents)) {
        throw new Error("Unsupported database format");
      }
      // Migrations chain: v1 -> v2 -> v3, so a database from any released
      // version reaches the current one in a single load.
      if (isDatabaseV1(parsed)) {
        this.data = migrateV2(migrateV1(parsed));
        await this.persist();
      } else if (isDatabaseV2(parsed)) {
        this.data = migrateV2(parsed);
        await this.persist();
      } else if (parsed.version === 3) {
        this.data = parsed;
      } else {
        throw new Error("Unsupported database format");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }
  }

  snapshot(): Database {
    return structuredClone(this.data);
  }

  async mutate<T>(mutation: (database: Database) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      result = await mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(data: Database = this.data): Promise<void> {
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
