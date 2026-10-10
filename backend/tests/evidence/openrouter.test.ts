import { describe, expect, it } from "vitest";

import { ResearchModelError } from "../../src/evidence/research/gemini.js";
import { createOpenRouterResearchModel } from "../../src/evidence/research/openrouter.js";
import type { FetchResult } from "../../src/evidence/research/safe-fetch.js";

const SITE = "https://asterlo.io/";
const page = (url: string, text: string | null): FetchResult => ({
  status: text ? "OK" : "HTTP_ERROR",
  requestedUrl: url,
  finalUrl: url,
  httpStatus: text ? 200 : 404,
  contentType: "text/html",
  text,
  contentSha256: null,
  truncated: false,
});

function harness(reply: { status?: number; body: unknown }) {
  const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  const model = createOpenRouterResearchModel({
    apiKey: "sk-or-secret",
    model: "google/gemini-2.5-flash",
    fetchPage: async (url) => page(url, url === SITE ? "Asterlo: research-backed outreach. Six emails into Gmail Drafts." : null),
    appUrl: "http://localhost:8787",
    fetchImpl,
  });
  return { model, requests };
}

const project = { name: "Asterlo", oneLiner: "", sector: null, stage: "PROTOTYPE" };
const completion = (content: string, annotations: unknown[] = []) => ({
  choices: [{ message: { content, annotations } }],
  usage: { total_tokens: 1234 },
});

describe("OpenRouter research model", () => {
  it("founder pass sends server-fetched page text with structured output and no paid tools", async () => {
    const claims = { claims: [{ metric_code: "product_status", value: "beta", period_end: null, source_url: SITE, quote: "Six emails" }], warnings: [] };
    const { model, requests } = harness({ body: completion("```json\n" + JSON.stringify(claims) + "\n```") });
    const result = await model.founderPass({ project, urls: [SITE, "https://gone.example/"], founderText: "We shipped." });

    expect(model.model).toBe("openrouter:google/gemini-2.5-flash");
    expect(result.output.claims[0].metric_code).toBe("product_status");
    expect(result.telemetry).toMatchObject({ urlContext: [], groundingCalls: 0, totalTokens: 1234 });
    const { body, init } = requests[0];
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.plugins).toBeUndefined();
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "founder_pass", strict: true } });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.temperature).toBe(0);
    const user = (body.messages as { role: string; content: string }[]).find((m) => m.role === "user")!.content;
    expect(user).toContain("Six emails into Gmail Drafts");
    expect(user).toContain("could not be read: HTTP_ERROR");
    expect(user).toContain("<founder_text>");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-secret");
  });

  it("corroboration pass uses one Exa web search and reads url_citation annotations", async () => {
    const output = { claims: [], assessments: [], warnings: [] };
    const { model, requests } = harness({
      body: completion(JSON.stringify(output), [{ type: "url_citation", url_citation: { url: "https://news.example/asterlo", title: "t" } }]),
    });
    const result = await model.corroborationPass({ project: { ...project, website: SITE }, siteSummary: "Asterlo — Research-backed outreach" });
    expect(requests[0].body.plugins).toEqual([{ id: "web", engine: "exa", max_results: 5 }]);
    const user = (requests[0].body.messages as { role: string; content: string }[]).find((m) => m.role === "user")!.content;
    expect(user).toContain("(domain: asterlo.io)");
    expect(user).toContain("<site_summary>\nAsterlo — Research-backed outreach\n</site_summary>");
    expect(result.telemetry.citationUrls).toEqual(["https://news.example/asterlo"]);
    expect(result.telemetry.groundingCalls).toBe(1);
  });

  it("maps HTTP failures to AI_UNAVAILABLE without leaking the key", async () => {
    const { model } = harness({ status: 402, body: { error: { message: "Insufficient credits for key sk-or-secret" } } });
    const error = await model.founderPass({ project, urls: [SITE], founderText: null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResearchModelError);
    expect((error as ResearchModelError).code).toBe("AI_UNAVAILABLE");
    expect((error as Error).message).toBe("OpenRouter returned HTTP 402");
  });

  it("rejects non-JSON and off-schema output as AI_INVALID_OUTPUT", async () => {
    for (const content of ["not json", JSON.stringify({ claims: "nope" })]) {
      const { model } = harness({ body: completion(content) });
      await expect(model.founderPass({ project, urls: [SITE], founderText: null })).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    }
  });
});
