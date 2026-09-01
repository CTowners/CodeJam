import { randomUUID } from "node:crypto";
import { CHAT_INSTRUCTIONS, hasWorkspace } from "./agent-kinds.js";
import { summarizeCapability } from "./capability-summary.js";
import type { AppConfig } from "./config.js";
import { isArkConfigured } from "./config.js";
import type { TurnResult, TurnRunner } from "./contracts.js";
import { HttpError, RunCancelledError } from "./errors.js";
import { JsonStore } from "./store.js";
import type {
  Agent,
  AgentRun,
  AgentRunner,
  CreateAgentInput,
  Message,
  UpdateAgentInput,
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const now = () => new Date().toISOString();

export class AgentService implements TurnRunner {
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly cancellationRequests = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly workspaces: WorkspaceManager,
    private readonly runner: AgentRunner,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.workspaces.initialize();
    await this.store.mutate((database) => {
      for (const run of database.runs) {
        if (run.status === "queued" || run.status === "running") {
          run.status = "cancelled";
          run.error = "Server restarted while this run was active";
          run.completedAt = now();
        }
      }
      for (const agent of database.agents) {
        if (agent.status === "busy") {
          agent.status = "ready";
          agent.updatedAt = now();
        }
      }
    });
  }

  listAgents(): Agent[] {
    return this.store
      .snapshot()
      .agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * Narrows an Agent to one that can actually run. A template has no workspace
   * by construction, so reaching a runner with one is a routing mistake, not a
   * runtime condition — fail with the reason rather than a null path deeper in.
   */
  private requireWorkspace(agent: Agent): string {
    if (!agent.workspacePath) {
      throw new HttpError(
        409,
        `"${agent.name}" defines a role and never runs on its own — cast it from a chat instead.`,
      );
    }
    return agent.workspacePath;
  }

  getAgent(id: string): Agent {
    const agent = this.store.snapshot().agents.find((item) => item.id === id);
    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }
    return agent;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const timestamp = now();
    const id = randomUUID();
    const kind = input.kind ?? "template";
    // A chat's instructions are the platform's, not the user's: without them the
    // drafting turn has nothing telling it to answer with a Plan.
    const instructions = input.instructions?.trim() || (kind === "chat" ? CHAT_INSTRUCTIONS : "");
    const agent: Agent = {
      id,
      kind,
      parentChatId: input.parentChatId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      instructions,
      capabilitySummary: summarizeCapability(instructions),
      status: "ready",
      workspacePath: hasWorkspace(kind) ? this.workspaces.workspacePath(id) : null,
      codexThreadId: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (agent.workspacePath) {
      await this.workspaces.create({ ...agent, workspacePath: agent.workspacePath });
    }
    await this.store.mutate((database) => database.agents.push(agent));
    return agent;
  }

  /**
   * Spawns a worker for one Job from a template, copying the role definition's
   * instructions. The template itself never runs, which is what keeps it reusable
   * across Jobs and free of any single Job's state.
   */
  async spawnWorkerFromTemplate(templateId: string, parentChatId: string): Promise<Agent> {
    const template = this.getAgent(templateId);
    return this.createAgent({
      name: template.name,
      description: template.description,
      instructions: template.instructions,
      kind: "worker",
      parentChatId,
    });
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const current = this.getAgent(id);
    // A worker is the record of what one Job did. Rewriting its instructions
    // after the fact would falsify the evidence the transcript is read against,
    // so it is refused here rather than only disabled in the UI.
    if (current.kind === "worker") {
      throw new HttpError(409, `"${current.name}" is a subagent — its record can be inspected but not edited.`);
    }
    if (current.status === "busy") {
      throw new HttpError(409, "Stop the active run before editing this Agent");
    }
    const updated = await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before editing this Agent");
      }
      if (input.name !== undefined) agent.name = input.name.trim();
      if (input.description !== undefined) agent.description = input.description.trim();
      if (input.instructions !== undefined) {
        agent.instructions = input.instructions.trim();
        agent.capabilitySummary = summarizeCapability(agent.instructions);
      }
      agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
    if (updated.workspacePath) {
      await this.workspaces.writeInstructions({ ...updated, workspacePath: updated.workspacePath });
    }
    return updated;
  }

  async deleteAgent(id: string): Promise<{ archivedWorkspace: string | null }> {
    const agent = this.getAgent(id);
    await this.cancelExecution(id);
    const archivedWorkspace = agent.workspacePath
      ? await this.workspaces.archive({ ...agent, workspacePath: agent.workspacePath })
      : null;
    await this.store.mutate((database) => {
      database.agents = database.agents.filter((item) => item.id !== id);
      database.messages = database.messages.filter((item) => item.agentId !== id);
      database.runs = database.runs.filter((item) => item.agentId !== id);
    });
    return { archivedWorkspace };
  }

  async startAgent(id: string): Promise<Agent> {
    return this.setStatus(id, "ready");
  }

  async stopAgent(id: string): Promise<Agent> {
    this.getAgent(id);
    await this.cancelExecution(id);
    return this.setStatus(id, "stopped");
  }

  getMessages(agentId: string): Message[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .messages.filter((message) => message.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getRun(runId: string): AgentRun {
    const run = this.store.snapshot().runs.find((item) => item.id === runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return run;
  }

  getRuns(agentId: string): AgentRun[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .runs.filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async sendMessage(
    agentId: string,
    prompt: string,
  ): Promise<{ run: AgentRun; message: Message }> {
    if (!isArkConfigured(this.config)) {
      throw new HttpError(
        503,
        "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
      );
    }
    const timestamp = now();
    const runId = randomUUID();
    const run: AgentRun = {
      id: runId,
      agentId,
      status: "queued",
      prompt,
      output: null,
      error: null,
      usage: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
    };
    const message: Message = {
      id: randomUUID(),
      agentId,
      runId,
      role: "user",
      content: prompt,
      createdAt: timestamp,
    };
    const agentAtStart = await this.store.mutate((database) => {
      const storedAgent = database.agents.find((item) => item.id === agentId);
      if (!storedAgent) {
        throw new HttpError(404, "Agent not found");
      }
      if (storedAgent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before sending a message");
      }
      if (storedAgent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }
      database.runs.push(run);
      database.messages.push(message);
      const snapshot = structuredClone(storedAgent);
      storedAgent.status = "busy";
      storedAgent.lastError = null;
      storedAgent.updatedAt = timestamp;
      return snapshot;
    });
    const execution = this.executeRun(agentAtStart, run);
    this.activeExecutions.set(agentId, execution);
    void execution
      .finally(() => {
        if (this.activeExecutions.get(agentId) === execution) {
          this.activeExecutions.delete(agentId);
        }
      })
      .catch(() => undefined);
    return { run, message };
  }

  /**
   * TurnRunner implementation, so a Coordinator can drive this AgentService
   * directly (see index.ts). Separate from sendMessage/executeRun: a Job turn
   * doesn't create a Playground AgentRun/Message, and failures come back as a
   * TurnResult rather than a thrown error, so the Coordinator can classify the
   * cause instead of catching an exception.
   */
  async runTurn(agentId: string, prompt: string, timeoutMs: number): Promise<TurnResult> {
    const start = Date.now();
    if (!isArkConfigured(this.config)) {
      return {
        ok: false,
        reply: "",
        error: "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
        durationMs: Date.now() - start,
      };
    }
    // Check-and-flip-to-busy happens inside one mutate() call, same as sendMessage
    // — mutate()'s queue serializes callbacks, so this is atomic. Doing the check
    // and the flip as two separate awaited steps would leave a window where two
    // concurrent runTurn calls for the same Agent both read "ready" before either
    // one's flip lands, and both proceed.
    let agent: Agent;
    try {
      agent = await this.store.mutate((database) => {
        const stored = database.agents.find((item) => item.id === agentId);
        if (!stored) {
          throw new HttpError(404, "Agent not found");
        }
        if (stored.status === "busy") {
          throw new HttpError(409, "This Agent is already running a turn");
        }
        if (stored.status === "stopped") {
          throw new HttpError(409, "This Agent is stopped");
        }
        const snapshot = structuredClone(stored);
        stored.status = "busy";
        stored.updatedAt = now();
        return snapshot;
      });
    } catch (error) {
      return {
        ok: false,
        reply: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      };
    }

    // Our own watchdog, distinct from the underlying runner's own timeout: it lets
    // the Coordinator's per-turn budget (which may be shorter) cut a turn off, and
    // cancels the runner so a retry against the same Agent isn't blocked behind it.
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      void this.runner.cancel(agentId);
    }, timeoutMs);

    try {
      const result = await this.runner.run({
        agentId,
        workspacePath: this.requireWorkspace(agent),
        prompt,
        threadId: agent.codexThreadId,
      });
      await this.store.mutate((database) => {
        const stored = database.agents.find((item) => item.id === agentId);
        if (stored) {
          stored.status = "ready";
          stored.codexThreadId = result.threadId;
          stored.lastError = null;
          stored.updatedAt = now();
        }
      });
      return { ok: true, reply: result.output, error: null, durationMs: Date.now() - start };
    } catch (error) {
      // A watchdog-triggered cancel surfaces as the same RunCancelledError a real
      // user cancellation would — override its message so failure-classifier sees
      // a timeout, not "cancelled", here. An external cancel (not from this
      // watchdog) keeps the original message and is correctly classified cancelled.
      const message = timedOut
        ? `Turn timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      await this.store.mutate((database) => {
        const stored = database.agents.find((item) => item.id === agentId);
        if (stored && stored.status !== "stopped") {
          stored.status = "ready";
          stored.lastError = message;
          stored.updatedAt = now();
        }
      });
      return { ok: false, reply: "", error: message, durationMs: Date.now() - start };
    } finally {
      clearTimeout(watchdog);
    }
  }

  async resetMemory(agentId: string): Promise<void> {
    await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === agentId);
      if (agent) {
        agent.codexThreadId = null;
        agent.updatedAt = now();
      }
    });
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return {
      arkConfigured: isArkConfigured(this.config),
      arkBaseUrl: this.config.arkBaseUrl,
      arkModel: this.config.arkModel || null,
      codexAvailable: await this.runner.isAvailable(),
      codexSandboxMode: this.config.codexSandboxMode,
      runtimeProvider: this.config.runtimeProvider,
      containerEngine:
        this.config.runtimeProvider === "container"
          ? this.config.containerEngine
          : null,
      runtime:
        this.config.runtimeProvider === "container"
          ? "Codex CLI in " + this.config.containerEngine + " Runtime"
          : "Codex CLI in application container",
    };
  }

  private async executeRun(agentAtStart: Agent, run: AgentRun): Promise<void> {
    await this.store.mutate((database) => {
      const storedRun = database.runs.find((item) => item.id === run.id);
      if (storedRun) {
        storedRun.status = "running";
        storedRun.startedAt = now();
      }
    });
    try {
      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }
      const result = await this.runner.run({
        agentId: agentAtStart.id,
        workspacePath: this.requireWorkspace(agentAtStart),
        prompt: run.prompt,
        threadId: agentAtStart.codexThreadId,
      });
      const completedAt = now();
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (!storedRun || !agent) return;
        storedRun.status = "completed";
        storedRun.output = result.output;
        storedRun.usage = result.usage;
        storedRun.completedAt = completedAt;
        database.messages.push({
          id: randomUUID(),
          agentId: agent.id,
          runId: run.id,
          role: "assistant",
          content: result.output,
          createdAt: completedAt,
        });
        agent.status = "ready";
        agent.codexThreadId = result.threadId;
        agent.lastError = null;
        agent.updatedAt = completedAt;
      });
    } catch (error) {
      const completedAt = now();
      const cancelled = error instanceof RunCancelledError;
      const message = error instanceof Error ? error.message : String(error);
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (storedRun) {
          storedRun.status = cancelled ? "cancelled" : "failed";
          storedRun.error = message;
          storedRun.completedAt = completedAt;
        }
        if (agent) {
          if (agent.status !== "stopped") {
            agent.status = cancelled ? "ready" : "error";
          }
          agent.lastError = cancelled ? null : message;
          agent.updatedAt = completedAt;
        }
      });
    }
  }

  private async setStatus(id: string, status: Agent["status"]): Promise<Agent> {
    return this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (status === "ready" && agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before starting this Agent");
      }
      agent.status = status;
      if (status === "ready") agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
  }

  private async cancelExecution(agentId: string): Promise<void> {
    this.cancellationRequests.add(agentId);
    try {
      await this.runner.cancel(agentId);
      const execution = this.activeExecutions.get(agentId);
      if (execution) {
        await execution;
      }
    } finally {
      this.cancellationRequests.delete(agentId);
    }
  }
}
