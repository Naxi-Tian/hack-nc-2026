import { Hono } from "hono";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { createAuth, createAuthPool } from "../../src/auth/better-auth.js";
import { createAuthRouter } from "../../src/routes/auth.js";

// These cases reject before any query, so the pools never connect.
const origin = "http://localhost:3000";
const unusedUrl = "postgres://unused:unused@127.0.0.1:1/unused";

function appWith(demoSignIn: boolean | undefined) {
  const auth = createAuth({
    authPool: createAuthPool(unusedUrl),
    secret: "test-secret-0123456789-0123456789-0123456789",
    baseURL: origin,
    campusDomains: ["edu"],
    sendOtp: async () => undefined,
  });
  const app = new Hono();
  app.route(
    "/api",
    createAuthRouter({ pool: new Pool({ connectionString: unusedUrl }), auth, emailHashPepper: "pepper", campusDomains: ["edu"], demoSignIn }),
  );
  return app;
}

const signIn = (app: Hono, email: unknown, headers: Record<string, string> = { origin }) =>
  app.request("/api/demo/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email }),
  });

describe("demo sign-in (DEMO_MODE shortcut)", () => {
  it("does not exist unless enabled", async () => {
    expect((await signIn(appWith(undefined), "student@unc.edu")).status).toBe(404);
    expect((await signIn(appWith(false), "student@unc.edu")).status).toBe(404);
  });

  it("rejects other origins and missing origins", async () => {
    const app = appWith(true);
    expect((await signIn(app, "student@unc.edu", { origin: "https://evil.example" })).status).toBe(403);
    expect((await signIn(app, "student@unc.edu", {})).status).toBe(403);
  });

  it("rejects non-campus and malformed addresses", async () => {
    const app = appWith(true);
    for (const email of ["someone@gmail.com", "student@edu.evil.com", "", 42, "a@b@unc.edu"]) {
      expect((await signIn(app, email)).status).toBe(400);
    }
  });
});
