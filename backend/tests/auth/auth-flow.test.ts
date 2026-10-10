import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { createAuth, createAuthPool } from "../../src/auth/better-auth.js";
import { createAuthRouter } from "../../src/routes/auth.js";

// Runs against a migrated database, e.g. a disposable Tiger fork:
//   AUTH_TEST_DATABASE_URL=postgres://... npx vitest run tests/auth
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
const origin = "http://localhost:8787";

describe.skipIf(!databaseUrl)("campus email sign-in (Better Auth)", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const authPool = createAuthPool(databaseUrl ?? "");
  const sent: { email: string; otp: string }[] = [];
  const auth = createAuth({
    authPool,
    secret: "test-secret-0123456789-0123456789-0123456789",
    baseURL: origin,
    campusDomains: ["unc.edu"],
    sendOtp: async (email, otp) => {
      sent.push({ email, otp });
    },
  });
  const app = new Hono();
  app.route("/api", createAuthRouter({ pool, auth, emailHashPepper: "test-pepper", campusDomains: ["unc.edu"] }));
  app.onError((error, context) =>
    error instanceof HTTPException ? error.getResponse() : context.json({ error: { code: "INTERNAL" } }, 500),
  );

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify(body),
    });
  const email = `student-${randomUUID().slice(0, 8)}@cs.unc.edu`;
  const otpFor = async (address: string) => {
    for (let i = 0; i < 50 && !sent.some((entry) => entry.email === address); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return sent.filter((entry) => entry.email === address).at(-1)?.otp;
  };

  afterAll(async () => {
    await pool.end();
    await authPool.end();
  });

  it("rejects non-campus addresses before sending a code", async () => {
    const response = await post("/email-otp/send-verification-otp", { email: "someone@gmail.com", type: "sign-in" });
    expect(response.status).toBe(400);
    expect(sent.some((entry) => entry.email === "someone@gmail.com")).toBe(false);
  });

  it("rejects non-sign-in code types", async () => {
    const response = await post("/email-otp/send-verification-otp", { email, type: "forget-password" });
    expect(response.status).toBe(400);
  });

  it("signs in with an emailed code, stores it hashed, and provisions one identity", async () => {
    expect((await post("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(200);
    const otp = await otpFor(email);
    expect(otp).toMatch(/^\d{6}$/);

    const stored = await pool.query<{ value: string }>(
      "select value from auth.verification where identifier like $1",
      [`%${email}%`],
    );
    expect(stored.rows.length).toBeGreaterThan(0);
    expect(stored.rows.every((row) => !row.value.includes(otp ?? "none"))).toBe(true);

    const wrong = await post("/sign-in/email-otp", { email, otp: otp === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const signIn = await post("/sign-in/email-otp", { email, otp });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(cookie).toContain("prospecto.session_token");

    const me = await app.request("/api/me", { headers: { cookie, origin } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { identityId: string; verified: boolean; wallets: unknown[] };
    expect(body.verified).toBe(true);
    expect(body.wallets).toEqual([]);

    const again = (await (await app.request("/api/me", { headers: { cookie, origin } })).json()) as { identityId: string };
    expect(again.identityId).toBe(body.identityId);

    const identity = await pool.query<{ verification_status: string; campus_email_hash: string }>(
      "select verification_status, campus_email_hash from identities where id = $1",
      [body.identityId],
    );
    expect(identity.rows[0]?.verification_status).toBe("VERIFIED");
    expect(identity.rows[0]?.campus_email_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects /me without a session", async () => {
    const response = await app.request("/api/me");
    expect(response.status).toBe(401);
  });
});
