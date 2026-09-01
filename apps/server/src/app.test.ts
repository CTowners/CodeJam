import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { AgentService } from "./agent-service.js";
import type { JobService } from "./job-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

const jobService = {} as unknown as JobService;

describe("HTTP boundary", () => {
  it("protects API routes with the configured shared token", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-test-token" }),
      service,
      jobService,
    );
    const denied = await app.inject({ method: "GET", url: "/api/agents" });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: "Bearer a-strong-test-token" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("preserves Fastify client error status codes", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, jobService);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });
    expect(malformed.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("runs the custom error handler for every route, including ones registered before the jobRoutes plugin", async () => {
    // Regression test: setErrorHandler must be registered before any awaited
    // app.register() call. createApp never calls app.ready() itself (index.ts's
    // listen() and this test's inject() both boot it lazily), so Fastify/avvio
    // finalizes each awaited register()'s error-handler wiring immediately —
    // a setErrorHandler placed after one silently stops applying to routes
    // registered before it, falling back to Fastify's generic
    // {statusCode, error: "<reason phrase>", message} shape instead of this
    // app's {error: message} contract.
    const throwingService = {
      listAgents: () => [],
      systemInfo: async () => ({}),
      sendMessage: async () => {
        throw new HttpError(503, "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.");
      },
    } as unknown as AgentService;

    const app = await createApp(loadConfig({ NODE_ENV: "test" }), throwingService, jobService);
    const response = await app.inject({
      method: "POST",
      url: "/api/agents/00000000-0000-0000-0000-000000000000/messages",
      payload: { content: "hi" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
    });
    await app.close();
  });

  it("refuses to delete a chat (kind: orchestrator), at the request boundary not just the UI", async () => {
    let deleteCalled = false;
    const protectedService = {
      listAgents: () => [],
      systemInfo: async () => ({}),
      getAgent: (id: string) => ({ id, name: "Planning session", kind: "orchestrator", status: "ready" }),
      deleteAgent: async () => {
        deleteCalled = true;
        return { archivedWorkspace: "/should/never/be/called" };
      },
    } as unknown as AgentService;

    const app = await createApp(loadConfig({ NODE_ENV: "test" }), protectedService, jobService);
    const response = await app.inject({
      method: "DELETE",
      url: "/api/agents/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/Chats can't be deleted/);
    expect(deleteCalled).toBe(false);
    await app.close();
  });

  it("still allows deleting an ordinary Agent", async () => {
    let deleteCalled = false;
    const ordinaryService = {
      listAgents: () => [],
      systemInfo: async () => ({}),
      getAgent: (id: string) => ({ id, name: "Implementer", status: "ready" }),
      deleteAgent: async () => {
        deleteCalled = true;
        return { archivedWorkspace: "/archived" };
      },
    } as unknown as AgentService;

    const app = await createApp(loadConfig({ NODE_ENV: "test" }), ordinaryService, jobService);
    const response = await app.inject({
      method: "DELETE",
      url: "/api/agents/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(200);
    expect(deleteCalled).toBe(true);
    await app.close();
  });

  it("refuses to change a chat's description/instructions via PATCH, but still allows renaming it", async () => {
    let updateCalled = false;
    const protectedService = {
      listAgents: () => [],
      systemInfo: async () => ({}),
      getAgent: (id: string) => ({ id, name: "Planning session", kind: "orchestrator", status: "ready" }),
      updateAgent: async (_id: string, input: unknown) => {
        updateCalled = true;
        return { id: _id, ...(input as object) };
      },
    } as unknown as AgentService;

    const app = await createApp(loadConfig({ NODE_ENV: "test" }), protectedService, jobService);

    const blocked = await app.inject({
      method: "PATCH",
      url: "/api/agents/00000000-0000-0000-0000-000000000000",
      payload: { instructions: "do something else" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(updateCalled).toBe(false);

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/agents/00000000-0000-0000-0000-000000000000",
      payload: { name: "Renamed chat" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(updateCalled).toBe(true);
    await app.close();
  });

});
