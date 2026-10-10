import { GoogleGenAI } from "@google/genai";
import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { createApi } from "./app.js";
import { createAuth, createAuthPool } from "./auth/better-auth.js";
import { createOtpSender } from "./auth/otp-delivery.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const pool = new Pool({ connectionString: config.DATABASE_URL });
const authPool = createAuthPool(config.DATABASE_URL);
// An idle client can error when Tiger drops the connection; log it instead of crashing.
for (const p of [pool, authPool]) {
  p.on("error", (error) => console.error("postgres pool error:", error.message));
}

// Fail fast on a bad URL or an unmigrated database instead of on the first request.
try {
  await pool.query("select 1 from projects limit 1");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `Cannot use DATABASE_URL: ${message}\n` +
      "Check the connection string, then apply migrations with: npm run db:migrate",
  );
  process.exit(1);
}

const app = createApi({
  pool,
  ai: new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }),
  model: config.GEMINI_MODEL,
  githubToken: config.GITHUB_TOKEN,
  auth: createAuth({
    authPool,
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.PUBLIC_ORIGIN,
    campusDomains: config.CAMPUS_EMAIL_DOMAINS,
    sendOtp: createOtpSender(config.otpDelivery),
  }),
  emailHashPepper: config.EMAIL_HASH_PEPPER,
  campusDomains: config.CAMPUS_EMAIL_DOMAINS,
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.info(`Prospecto API listening on http://localhost:${info.port}${config.DEMO_MODE ? " (DEMO_MODE)" : ""}`);
});

async function shutdown() {
  server.close();
  await Promise.allSettled([pool.end(), authPool.end()]);
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
