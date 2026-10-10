import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { stripApiTrailingSlash } from "../src/app.js";

describe("stripApiTrailingSlash", () => {
  const app = new Hono();
  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.post("/api/echo", async (context) => context.json({ path: context.req.path, body: await context.req.json() }));
  app.get("/rounds/", (context) => context.text("page"));
  const fetch = stripApiTrailingSlash(app.fetch);

  it("routes /api/x/ like /api/x", async () => {
    expect((await fetch(new Request("http://localhost/api/health/"))).status).toBe(200);
    expect((await fetch(new Request("http://localhost/api/health"))).status).toBe(200);
  });

  it("preserves method, body, and query on POST", async () => {
    const response = await fetch(
      new Request("http://localhost/api/echo/?a=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "student@unc.edu" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "/api/echo", body: { email: "student@unc.edu" } });
  });

  it("leaves non-API paths alone", async () => {
    expect((await fetch(new Request("http://localhost/rounds/"))).status).toBe(200);
  });
});
