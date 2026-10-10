import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  ResearchError,
  confirmRequestSchema,
  confirmResearchRun,
  getResearchRun,
  researchRequestSchema,
  startResearchRun,
  type ResearchDependencies,
} from "../evidence/research/runner.js";

export interface ResearchRouterDependencies extends ResearchDependencies {
  requireProjectEditor: (context: Context, projectId: string) => Promise<{ identityId: string }>;
}

const uuid = z.string().uuid();

function fail(context: Context, error: unknown) {
  if (error instanceof ResearchError) {
    return context.json({ error: { code: error.code, message: error.message } }, error.httpStatus);
  }
  throw error;
}

// Founder-only endpoints: runs contain private evidence (submitted text, unpublished claims).
export function createResearchRouter(deps: ResearchRouterDependencies): Hono {
  const router = new Hono();

  router.post("/projects/:projectId/research-runs", async (context) => {
    const projectId = uuid.safeParse(context.req.param("projectId"));
    if (!projectId.success) return context.json({ error: { code: "INVALID_PROJECT_ID" } }, 400);
    const editor = await deps.requireProjectEditor(context, projectId.data);
    const body = researchRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: { code: "INVALID_INPUT" } }, 400);
    try {
      const run = await startResearchRun(deps, { projectId: projectId.data, identityId: editor.identityId, request: body.data });
      return context.json(run, run.cached ? 200 : 202);
    } catch (error) {
      return fail(context, error);
    }
  });

  router.get("/projects/:projectId/research-runs/:runId", async (context) => {
    const projectId = uuid.safeParse(context.req.param("projectId"));
    const runId = uuid.safeParse(context.req.param("runId"));
    if (!projectId.success || !runId.success) return context.json({ error: { code: "INVALID_INPUT" } }, 400);
    await deps.requireProjectEditor(context, projectId.data);
    try {
      const run = await getResearchRun(deps.pool, projectId.data, runId.data);
      return context.json({ run });
    } catch (error) {
      return fail(context, error);
    }
  });

  router.post("/projects/:projectId/research-runs/:runId/confirm", async (context) => {
    const projectId = uuid.safeParse(context.req.param("projectId"));
    const runId = uuid.safeParse(context.req.param("runId"));
    if (!projectId.success || !runId.success) return context.json({ error: { code: "INVALID_INPUT" } }, 400);
    const editor = await deps.requireProjectEditor(context, projectId.data);
    const body = confirmRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: { code: "INVALID_INPUT" } }, 400);
    try {
      const result = await confirmResearchRun(deps.pool, {
        projectId: projectId.data,
        runId: runId.data,
        identityId: editor.identityId,
        ...body.data,
      });
      return context.json(result, 201);
    } catch (error) {
      return fail(context, error);
    }
  });

  return router;
}
