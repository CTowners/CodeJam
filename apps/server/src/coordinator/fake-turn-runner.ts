import type { TurnResult, TurnRunner } from "../contracts.js";

export type FakeTurnHandler = (agentId: string, prompt: string, turnNumber: number) => Promise<TurnResult> | TurnResult;

/**
 * Canned-reply TurnRunner for unit-testing the Coordinator — no Ark key, no
 * Docker, milliseconds per test. Each call to an agentId consumes the next
 * handler queued for it via `queue`; falls back to `defaultHandler` if the
 * queue for that agentId is empty.
 */
export class FakeTurnRunner implements TurnRunner {
  private readonly queues = new Map<string, FakeTurnHandler[]>();
  private readonly callCounts = new Map<string, number>();
  public readonly resetCalls: string[] = [];

  constructor(private readonly defaultHandler?: FakeTurnHandler) {}

  queue(agentId: string, ...handlers: FakeTurnHandler[]): void {
    const existing = this.queues.get(agentId) ?? [];
    this.queues.set(agentId, [...existing, ...handlers]);
  }

  async runTurn(agentId: string, prompt: string, _timeoutMs: number): Promise<TurnResult> {
    const turnNumber = (this.callCounts.get(agentId) ?? 0) + 1;
    this.callCounts.set(agentId, turnNumber);
    const queue = this.queues.get(agentId);
    const handler = queue?.shift() ?? this.defaultHandler;
    if (!handler) {
      throw new Error(`FakeTurnRunner: no handler queued for agent "${agentId}"`);
    }
    const start = Date.now();
    const result = await handler(agentId, prompt, turnNumber);
    return { ...result, durationMs: Date.now() - start };
  }

  async resetMemory(agentId: string): Promise<void> {
    this.resetCalls.push(agentId);
  }
}

export const ok = (reply: string): TurnResult => ({ ok: true, reply, error: null, durationMs: 0 });
export const fail = (error: string): TurnResult => ({ ok: false, reply: "", error, durationMs: 0 });
