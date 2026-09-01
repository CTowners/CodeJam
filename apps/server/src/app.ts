import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { AgentService } from "./agent-service.js";
import { jobRoutes } from "./job-routes.js";
import type { JobService } from "./job-service.js";
import { buildDraftTriggerMessage } from "./orchestrator/instructions.js";

const agentIdParams = z.object({ id: z.string().uuid() });
const runIdParams = z.object({ id: z.string().uuid() });
const createAgentBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  instructions: z.string().max(10_000).optional(),
  kind: z.literal("orchestrator").optional(),
});
const updateAgentBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    instructions: z.string().max(10_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const messageBody = z.object({
  content: z.string().trim().min(1).max(50_000),
});

export async function createApp(
  config: AppConfig,
  service: AgentService,
  jobService: JobService,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1_048_576,
  });

  // Must be set before any `await app.register(...)` below: with no explicit
  // app.ready() before use (we return app straight to the caller — index.ts's
  // listen() and app.test.ts's inject() both boot it lazily), Fastify/avvio
  // finalizes each awaited register() call's error-handler wiring immediately,
  // so a setErrorHandler placed after one only covers routes registered after
  // it too — every route defined before falls back to Fastify's own default
  // handler instead (right status code, but the generic HTTP reason phrase in
  // `error` instead of the actual message, and no ZodError `details`).
  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof Error ? error : new Error(String(error));
    const validationError = error instanceof z.ZodError;
    const frameworkStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : validationError
          ? 400
          : frameworkStatus && frameworkStatus >= 400 && frameworkStatus <= 599
            ? frameworkStatus
            : 500;
    if (statusCode >= 500) {
      request.log.error(appError);
    }
    return reply.code(statusCode).send({
      error: appError.message,
      ...(validationError ? { details: error.issues } : {}),
    });
  });

  await app.register(cors, {
    origin:
      config.nodeEnv === "development"
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : false,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (
      !config.authToken ||
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      request.url === "/api/auth"
    ) {
      return;
    }
    const header = request.headers.authorization ?? "";
    const candidate = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expectedBuffer = Buffer.from(config.authToken);
    const candidateBuffer = Buffer.from(candidate);
    const valid =
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer);
    if (!valid) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "volc-agent-launchpad",
  }));

  app.get("/api/auth", async () => ({ required: config.authToken.length > 0 }));

  app.get("/api/system", async () => service.systemInfo());

  app.get("/api/agents", async () => ({ agents: service.listAgents() }));

  app.post("/api/agents", async (request, reply) => {
    const body = createAgentBody.parse(request.body);
    const agent = await service.createAgent(body);
    return reply.code(201).send({ agent });
  });

  app.get("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: service.getAgent(id) };
  });

  app.patch("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    const body = updateAgentBody.parse(request.body);
    // A chat's description/instructions are the server's to own (they encode
    // its dual-mode behavior) — refused here, not just hidden in the UI.
    // Renaming is still allowed; that's the whole point of a rename-able chat.
    if (service.getAgent(id).kind === "orchestrator" && (body.description !== undefined || body.instructions !== undefined)) {
      throw new HttpError(403, "A chat's description and instructions are managed automatically — only its name can be changed");
    }
    return { agent: await service.updateAgent(id, body) };
  });

  app.delete("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    // Refused here, not just hidden in the UI — deleting a chat mid-use would
    // orphan whatever Job it's still in the middle of planning.
    if (service.getAgent(id).kind === "orchestrator") {
      throw new HttpError(403, "Chats can't be deleted");
    }
    return service.deleteAgent(id);
  });

  app.post("/api/agents/:id/draft-plan", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    const agent = service.getAgent(id);
    if (agent.kind !== "orchestrator") {
      throw new HttpError(400, "Only a chat can draft a plan");
    }
    // The live candidate list, read server-side — never trust a client-supplied
    // one, since it's what the drafted cast actually gets validated against.
    const candidates = service
      .listAgents()
      .filter((candidate) => candidate.kind !== "orchestrator")
      .map((candidate) => ({ id: candidate.id, name: candidate.name, capabilitySummary: candidate.capabilitySummary }));
    const triggerMessage = buildDraftTriggerMessage(candidates);
    const result = await service.sendMessage(id, triggerMessage);
    return { run: result.run, message: result.message };
  });

  app.post("/api/agents/:id/start", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.startAgent(id) };
  });

  app.post("/api/agents/:id/stop", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: await service.stopAgent(id) };
  });

  app.get("/api/agents/:id/messages", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { messages: service.getMessages(id) };
  });

  app.get("/api/agents/:id/runs", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { runs: service.getRuns(id) };
  });

  app.post("/api/agents/:id/messages", async (request, reply) => {
    const { id } = agentIdParams.parse(request.params);
    const body = messageBody.parse(request.body);
    const result = await service.sendMessage(id, body.content);
    return reply.code(202).send(result);
  });

  app.get("/api/runs/:id", async (request) => {
    const { id } = runIdParams.parse(request.params);
    return { run: service.getRun(id) };
  });

  await app.register(jobRoutes, { jobService });

  if (config.nodeEnv === "production") {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "API route not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
