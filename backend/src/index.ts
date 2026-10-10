// Local/long-running server. On Vercel, server.ts is the entry instead.
import { serve } from "@hono/node-server";

import { stripApiTrailingSlash } from "./app.js";
import { bootstrap } from "./bootstrap.js";

const { app, config, pool, authPool } = await bootstrap();

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

const server = serve({ fetch: stripApiTrailingSlash(app.fetch), port: config.PORT }, (info) => {
  console.info(`Prospecto API listening on http://localhost:${info.port}${config.DEMO_MODE ? " (DEMO_MODE)" : ""}`);
});

async function shutdown() {
  server.close();
  await Promise.allSettled([pool.end(), authPool.end()]);
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
