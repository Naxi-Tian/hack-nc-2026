import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";
import { GoogleGenAI } from "@google/genai";

import type { ProspectoAuth } from "./auth/better-auth.js";
import { requireProjectEditor } from "./auth/identity.js";
import { createGeminiResearchModel } from "./evidence/research/gemini.js";
import { collectGithub } from "./evidence/research/github.js";
import { safeFetch } from "./evidence/research/safe-fetch.js";
import { createAuthRouter } from "./routes/auth.js";
import { createEvidenceIntakeRouter } from "./routes/evidence-intake.js";
import { createResearchRouter } from "./routes/research.js";

export interface ApiDependencies {
  pool: Pool;
  ai: GoogleGenAI;
  model: string;
  /** Optional; raises GitHub's unauthenticated limit of 60 requests/hour. */
  githubToken?: string;
  auth: ProspectoAuth;
  /** EMAIL_HASH_PEPPER: HMAC key for identities.campus_email_hash. */
  emailHashPepper: string;
  campusDomains: readonly string[];
}

export function createApi(dependencies: ApiDependencies): Hono {
  const app = new Hono();
  const identityDependencies = {
    pool: dependencies.pool,
    auth: dependencies.auth,
    emailHashPepper: dependencies.emailHashPepper,
    campusDomains: dependencies.campusDomains,
  };
  const requireEditor = (context: Context, projectId: string) =>
    requireProjectEditor(context, projectId, identityDependencies);

  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.route("/api", createAuthRouter(identityDependencies));
  app.route("/api", createEvidenceIntakeRouter({ ...dependencies, requireProjectEditor: requireEditor }));
  app.route(
    "/api",
    createResearchRouter({
      pool: dependencies.pool,
      model: createGeminiResearchModel(dependencies.ai, dependencies.model),
      fetchPage: safeFetch,
      collectGithub: (target, projectSiteKey) => collectGithub(target, projectSiteKey, { token: dependencies.githubToken }),
      requireProjectEditor: requireEditor,
    }),
  );

  app.onError((error, context) => {
    if (error instanceof HTTPException) return error.getResponse();
    return context.json({ error: { code: "INTERNAL" } }, 500);
  });

  return app;
}
