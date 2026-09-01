import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DraftedPlanParseError, parseDraftedPlanValue } from "./orchestrator/response-schema.js";
import { HttpError } from "./errors.js";
import type { JobService } from "./job-service.js";

const jobIdParams = z.object({ id: z.string().uuid() });
const approvePlanBody = z.object({
  name: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(20_000),
  draft: z.unknown(),
});

/** Mounted the same way every other route group is: `app.register(jobRoutes, { jobService })`. */
export async function jobRoutes(app: FastifyInstance, opts: { jobService: JobService }): Promise<void> {
  const { jobService } = opts;

  // The plan itself came from a chat turn (an ordinary Agent reply), not a
  // server-held draft — this route revalidates it against the same schema
  // the Orchestrator's own JSON replies go through, so an approval can never
  // materialize a plan the server hasn't independently checked.
  app.post("/api/jobs/approve", async (request, reply) => {
    const body = approvePlanBody.parse(request.body);
    let draft;
    try {
      draft = parseDraftedPlanValue(body.draft);
    } catch (error) {
      if (error instanceof DraftedPlanParseError) {
        throw new HttpError(400, `Invalid plan: ${error.message}`);
      }
      throw error;
    }
    const job = await jobService.approvePlan(body.name, body.task, draft);
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
