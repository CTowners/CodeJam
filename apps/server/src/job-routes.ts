import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { JobService } from "./job-service.js";

const jobIdParams = z.object({ id: z.string().uuid() });
const draftIdParams = z.object({ draftId: z.string().uuid() });
const draftJobBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  task: z.string().trim().min(1).max(20_000),
});

/** Mounted the same way every other route group is: `app.register(jobRoutes, { jobService })`. */
export async function jobRoutes(app: FastifyInstance, opts: { jobService: JobService }): Promise<void> {
  const { jobService } = opts;

  app.post("/api/jobs/draft", async (request, reply) => {
    const body = draftJobBody.parse(request.body);
    const draft = await jobService.draftJob(body.name ?? body.task.slice(0, 80), body.task);
    return reply.code(201).send(draft);
  });

  app.get("/api/jobs/drafts/:draftId", async (request) => {
    const { draftId } = draftIdParams.parse(request.params);
    return jobService.getDraft(draftId);
  });

  app.post("/api/jobs/drafts/:draftId/approve", async (request, reply) => {
    const { draftId } = draftIdParams.parse(request.params);
    const job = await jobService.approveDraft(draftId);
    return reply.code(201).send({ job });
  });

  app.get("/api/jobs", async () => ({ jobs: jobService.listJobs() }));

  app.get("/api/jobs/:id", async (request) => {
    const { id } = jobIdParams.parse(request.params);
    return { job: jobService.getJob(id) };
  });

  app.get("/api/jobs/:id/messages", async (request) => {
    const { id } = jobIdParams.parse(request.params);
    return { messages: jobService.getJobMessages(id) };
  });

  app.get("/api/jobs/:id/events", async (request) => {
    const { id } = jobIdParams.parse(request.params);
    return { events: jobService.getJobEvents(id) };
  });

  app.post("/api/jobs/:id/cancel", async (request) => {
    const { id } = jobIdParams.parse(request.params);
    return { job: await jobService.cancelJob(id) };
  });
}
