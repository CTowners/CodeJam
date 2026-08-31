import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarizeCapability } from "./capability-summary.js";
import type { Database, DatabaseV1 } from "./types.js";

const emptyDatabase = (): Database => ({
  version: 2,
  agents: [],
  messages: [],
  runs: [],
  jobs: [],
  jobMessages: [],
  events: [],
});

const isDatabaseV1 = (parsed: { version: unknown }): parsed is DatabaseV1 =>
  parsed.version === 1;

/** v1 had no coordination collections and no Agent.capabilitySummary. */
const migrateV1 = (v1: DatabaseV1): Database => ({
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

export class JsonStore {
  private data: Database = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Database | DatabaseV1;
      if (!Array.isArray(parsed.agents)) {
        throw new Error("Unsupported database format");
      }
      if (isDatabaseV1(parsed)) {
        this.data = migrateV1(parsed);
        await this.persist();
      } else if (parsed.version === 2) {
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
