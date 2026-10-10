// OpenRouter adapter for evidence research (EVIDENCE_RESEARCH §3), used when the direct Gemini API
// is unavailable. Same prompts, schemas, and verifier as gemini.ts; only the transport differs:
// - Founder pass: the server fetches the founder's pages (SSRF-guarded safeFetch) and sends their
//   text, so no paid URL-reading tool is needed.
// - Corroboration pass: one OpenRouter web-plugin search via Exa (cheapest engine), cited back as
//   url_citation annotations. verifier.ts still re-fetches every cited page and checks each quote.
import { z } from "zod";

import {
  CORROBORATION_SEARCH_TOPICS,
  ResearchModelError,
  corroborationPassJsonSchema,
  corroborationPassSchema,
  corroborationSystem,
  founderPassJsonSchema,
  founderPassSchema,
  founderSystem,
  type PassResult,
  type PassTelemetry,
  type ResearchModel,
} from "./gemini.js";
import type { PageFetcher } from "./safe-fetch.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const PAGE_TEXT_MAX = 30_000;
// Exa returns extractive highlights; 5 results keeps the request at OpenRouter's base Exa price.
const SEARCH_RESULTS = 5;

export interface OpenRouterOptions {
  apiKey: string;
  /** OpenRouter model slug, e.g. google/gemini-2.5-flash. */
  model: string;
  fetchPage: PageFetcher;
  /** Sent as HTTP-Referer for OpenRouter attribution; never contains secrets. */
  appUrl?: string;
  fetchImpl?: typeof fetch;
}

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          annotations: z
            .array(z.object({ type: z.string(), url_citation: z.object({ url: z.string() }).partial().optional() }))
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ total_tokens: z.number().optional() }).partial().optional(),
});

function wrap(tag: string, body: string, attributes = ""): string {
  return `<${tag}${attributes}>\n${body.replaceAll(`</${tag}>`, "")}\n</${tag}>`;
}

/** Some providers wrap JSON in a markdown fence even with structured output; strip it. */
function jsonText(content: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(content.trim());
  return fenced ? fenced[1] : content;
}

export function createOpenRouterResearchModel(options: OpenRouterOptions): ResearchModel {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function complete<T>(
    system: string,
    user: string,
    name: string,
    jsonSchema: object,
    schema: z.ZodType<T>,
    plugins: object[],
  ): Promise<PassResult<T>> {
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
          "X-Title": "Prospecto",
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_schema", json_schema: { name, strict: true, schema: jsonSchema } },
          // Only route to endpoints that honor structured output.
          provider: { require_parameters: true },
          max_tokens: 8_192,
          ...(plugins.length ? { plugins } : {}),
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      throw new ResearchModelError("AI_UNAVAILABLE", error instanceof Error ? error.message : "OpenRouter request failed");
    }
    if (!response.ok) {
      // Status only: the body can echo request details, and the key must never reach logs.
      throw new ResearchModelError("AI_UNAVAILABLE", `OpenRouter returned HTTP ${response.status}`);
    }
    const body = completionSchema.safeParse(await response.json().catch(() => null));
    const message = body.success ? body.data.choices[0].message : null;
    if (!message?.content) throw new ResearchModelError("AI_UNAVAILABLE", "OpenRouter returned no content");
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText(message.content));
    } catch {
      throw new ResearchModelError("AI_INVALID_OUTPUT", "output was not JSON");
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new ResearchModelError("AI_INVALID_OUTPUT", "output did not match schema");

    const telemetry: PassTelemetry = {
      // Founder pages are fetched by our server, not by the model, so no URL-context records.
      urlContext: [],
      citationUrls: (message.annotations ?? [])
        .filter((annotation) => annotation.type === "url_citation" && annotation.url_citation?.url)
        .map((annotation) => annotation.url_citation!.url!),
      searchQueries: [],
      groundingCalls: plugins.length ? 1 : 0,
      totalTokens: body.success ? (body.data.usage?.total_tokens ?? null) : null,
    };
    return { output: result.data, telemetry };
  }

  return {
    model: `openrouter:${options.model}`,
    async founderPass({ project, urls, founderText }) {
      const pages = await Promise.all(urls.map((url) => options.fetchPage(url)));
      const sources = urls.map((url, index) => {
        const page = pages[index];
        return page.status === "OK" && page.text
          ? wrap("source", page.text.slice(0, PAGE_TEXT_MAX), ` url="${url}"`)
          : wrap("source", `(could not be read: ${page.status})`, ` url="${url}"`);
      });
      const input = [
        `Startup: ${project.name}: ${project.oneLiner}`,
        `Sector: ${project.sector ?? "unspecified"} · Stage claimed by founder: ${project.stage}`,
        wrap("sources", sources.length ? sources.join("\n") : "(none)"),
        founderText ? wrap("founder_text", founderText) : "",
      ].join("\n\n");
      return complete(
        founderSystem(
          `Read the page text in each <source> inside <sources> (cite it with that source's url), plus <founder_text> if present (cite it as source_url "founder_text").`,
        ),
        input,
        "founder_pass",
        founderPassJsonSchema,
        founderPassSchema,
        [],
      );
    },
    corroborationPass({ project }) {
      const input = [
        `Startup: ${project.name}: ${project.oneLiner}`,
        `Sector: ${project.sector ?? "unspecified"} · Stage: ${project.stage}`,
        `Website: ${project.website ?? "none"}`,
      ].join("\n");
      return complete(
        corroborationSystem(`Use only the attached web search results as sources, looking for: ${CORROBORATION_SEARCH_TOPICS}.`),
        input,
        "corroboration_pass",
        corroborationPassJsonSchema,
        corroborationPassSchema,
        [{ id: "web", engine: "exa", max_results: SEARCH_RESULTS }],
      );
    },
  };
}
