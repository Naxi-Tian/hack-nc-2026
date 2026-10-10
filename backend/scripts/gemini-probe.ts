// Live probe for EVIDENCE_RESEARCH build step 1: confirms that structured output works together
// with url_context and google_search on GEMINI_MODEL, and prints the provenance the verifier relies on.
//   GEMINI_API_KEY=... GEMINI_MODEL=gemini-3.8-flash npm run probe:gemini -- https://your-site.example "Name" "One-liner"
// Prints step types, URL-context statuses, citation URLs, and search counts. Never prints the key.
import { GoogleGenAI } from "@google/genai";

import { createGeminiResearchModel, ResearchModelError } from "../src/evidence/research/gemini.js";

const [url, name = "Example", oneLiner = "An example startup"] = process.argv.slice(2);
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;
if (!apiKey || !model || !url) {
  console.error("Usage: GEMINI_API_KEY=… GEMINI_MODEL=… npm run probe:gemini -- <public-url> [name] [one-liner]");
  process.exit(2);
}

const ai = new GoogleGenAI({ apiKey });
const raw: { steps?: { type?: string }[]; usage?: unknown }[] = [];
// Record raw interactions so the probe shows exactly what the API returned.
const recording = {
  interactions: {
    create: async (...args: Parameters<typeof ai.interactions.create>) => {
      const interaction = await ai.interactions.create(...args);
      raw.push(interaction as never);
      return interaction;
    },
  },
} as unknown as GoogleGenAI;

const research = createGeminiResearchModel(recording, model);
const project = { name, oneLiner, sector: null, stage: "PROTOTYPE" };

for (const [label, run] of [
  ["founder pass (url_context)", () => research.founderPass({ project, urls: [url], founderText: null })],
  ["corroboration pass (google_search + url_context)", () => research.corroborationPass({ project: { ...project, website: url } })],
] as const) {
  console.log(`\n=== ${label} ===`);
  const before = raw.length;
  try {
    const result = await run();
    const output = result.output as { claims: unknown[]; assessments?: unknown[]; warnings: string[] };
    console.log("schema: OK", { claims: output.claims.length, assessments: output.assessments?.length ?? 0, warnings: output.warnings });
    console.log("telemetry:", JSON.stringify(result.telemetry, null, 2));
  } catch (error) {
    console.log("FAILED:", error instanceof ResearchModelError ? `${error.code}: ${error.message}` : error);
  }
  for (const interaction of raw.slice(before)) {
    console.log("step types:", (interaction.steps ?? []).map((step) => step.type).join(" → "));
    console.log("usage:", JSON.stringify(interaction.usage));
  }
}
