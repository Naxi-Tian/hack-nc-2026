import { Hono, HTTPException } from "hono";
import type { Pool } from "pg";
import { GoogleGenAI } from "@google/genai";

import { createEvidenceIntakeRouter } from "./routes/evidence-intake.js";

export interface ApiDependencies {
  pool: Pool;
  ai: GoogleGenAI;
  model: string;
  requireProjectEditor: (projectId: string) => Promise<{ identityId: string }>;
}

export function createApi(dependencies: ApiDependencies): Hono {
  const app = new Hono();

  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.route("/api", createEvidenceIntakeRouter(dependencies));

  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();
    return context.json({ error: { code: "INTERNAL" } }, 500);
  });

  return app;
}
