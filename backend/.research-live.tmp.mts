// Live end-to-end run of the evidence-research pipeline against a disposable Tiger fork.
// Env: DB (fork URL), GEMINI_API_KEY, GEMINI_MODEL, OUT (result JSON path). Never prints secrets.
import { readFileSync, writeFileSync } from "node:fs";

import { GoogleGenAI } from "@google/genai";
import pg from "pg";

const B = "/Users/zhangyaxin742/Desktop/hack-nc-2026/backend/src";
const { createGeminiResearchModel } = await import(`${B}/evidence/research/gemini.ts`);
const { collectGithub } = await import(`${B}/evidence/research/github.ts`);
const { safeFetch } = await import(`${B}/evidence/research/safe-fetch.ts`);
const { startResearchRun, executeResearchRun, getResearchRun } = await import(`${B}/evidence/research/runner.ts`);
const { computeQualityScores, qualityParamsSchema } = await import(`${B}/valuation/quality-scores.ts`);

const pool = new pg.Pool({ connectionString: process.env.DB });
const ids = {
  user: "00000000-0000-0000-0000-00000000aa01",
  identity: "00000000-0000-0000-0000-00000000bb01",
  project: "00000000-0000-0000-0000-00000000cc01",
};
await pool.query(
  `insert into auth."user"(id, name, email, "emailVerified", "createdAt", "updatedAt")
   values ($1, 'Founder', 'founder@campus.edu', true, now(), now()) on conflict do nothing`, [ids.user]);
await pool.query(
  `insert into identities(id, auth_user_id, campus_email_hash, verification_status, verified_at)
   values ($1, $2, repeat('9', 64), 'VERIFIED', now()) on conflict do nothing`, [ids.identity, ids.user]);
// Stage and one-liner are unknown up front; the description stays empty so Gemini reads them from the site.
await pool.query(
  `insert into projects(id, slug, name, description, stage, founder_identity_id)
   values ($1, 'asterlo', 'Asterlo', '', 'PROTOTYPE', $2) on conflict do nothing`, [ids.project, ids.identity]);

let background: Promise<void> | undefined;
const deps = {
  pool,
  model: createGeminiResearchModel(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }), process.env.GEMINI_MODEL!),
  fetchPage: safeFetch,
  collectGithub: (target: { owner: string; repo: string | null }, siteKey: string | null) => collectGithub(target, siteKey, {}),
  runInBackground: (task: () => Promise<void>) => { background = task(); },
};

const started = Date.now();
const run = await startResearchRun(deps as never, {
  projectId: ids.project,
  identityId: ids.identity,
  request: {
    website_url: "https://asterlo.io/",
    urls: ["https://www.linkedin.com/in/linhua-zhou-31948b42b/"],
    refresh: true,
  },
});
console.log("run", run.status, "cached:", run.cached);
if (background) await background;
const result = await getResearchRun(pool, ids.project, run.runId);
writeFileSync(process.env.OUT!, JSON.stringify(result, null, 2));
console.log("finished in", Math.round((Date.now() - started) / 1000), "s");

const r = result as { status: string; error_code: string | null; search_query_count: number; total_tokens: number | null;
  result: { proposals: any[]; rejected: any[]; warnings: string[]; passes: Record<string, string>; sources: any[] } | null };
console.log("status:", r.status, "error:", r.error_code, "searches:", r.search_query_count, "tokens:", r.total_tokens);
if (r.result) {
  console.log("passes:", JSON.stringify(r.result.passes));
  console.log("warnings:", r.result.warnings);
  console.log("sources:");
  for (const s of r.result.sources) console.log("  ", s.origin, s.fetch_status, s.founder_controlled ? "founder" : "3rd-party", s.url);
  console.log(`proposals (${r.result.proposals.length}):`);
  for (const p of r.result.proposals) {
    console.log("  ", p.status.padEnd(24), p.metric_code.padEnd(28), (p.value_numeric ?? p.value_text ?? "").toString().slice(0, 60), "|", (p.quote ?? "").slice(0, 90));
  }
  console.log(`rejected (${r.result.rejected.length}):`);
  for (const x of r.result.rejected) console.log("  ", x.origin, x.metric_code, "-", x.reason);

  const params = qualityParamsSchema.parse(JSON.parse(readFileSync("/Users/zhangyaxin742/Desktop/hack-nc-2026/db/seeds/valuation-v0.1.json", "utf8")));
  const claims = r.result.proposals.map((p) => ({ id: p.id, metric_code: p.metric_code, value_numeric: p.value_numeric,
    value_text: p.value_text, status: p.status, created_at: new Date() }));
  const scores = computeQualityScores(params, "PROTOTYPE", claims);
  console.log("quality scores (PROTOTYPE stage):", JSON.stringify(scores.categories), "composite:", (scores as any).composite);
}
await pool.end();
