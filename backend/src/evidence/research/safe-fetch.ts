// Server-side page fetcher for quote verification. Founder URLs and search citations are
// attacker-influenced, so this is an SSRF boundary:
// - http(s) only, ports 80/443, no credentials in URLs (normalizeUrl);
// - every DNS answer is checked against private/reserved ranges inside the socket's own lookup,
//   so the address validated is the address connected to (no rebinding window);
// - redirects are followed manually and re-validated, capped at MAX_REDIRECTS;
// - bodies are capped (after decompression) and the whole fetch has a deadline.
import { createHash } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { normalizeUrl } from "./urls.js";

export type FetchStatus =
  | "OK"
  | "INVALID_URL"
  | "BLOCKED"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "UNSUPPORTED_TYPE"
  | "TOO_MANY_REDIRECTS"
  | "NETWORK_ERROR";

export interface FetchResult {
  status: FetchStatus;
  requestedUrl: string;
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
  /** Visible text plus title/meta descriptions; null unless status is OK. */
  text: string | null;
  /** sha256 of the raw (decompressed) body bytes that were read. */
  contentSha256: string | null;
  truncated: boolean;
  /** The page's own <title> and meta description (HTML only); tells corroboration what to search for. */
  summary?: { title: string | null; description: string | null };
}

export type PageFetcher = (url: string) => Promise<FetchResult>;

const MAX_REDIRECTS = 4;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 8_000;
const TEXT_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json"];

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  // No ::ffff:0:0/96 rule: BlockList checks IPv4-mapped addresses against the IPv4 ranges above,
  // and such a rule would also match every plain IPv4 address.
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

class BlockedAddressError extends Error {}

// Signature-compatible replacement for dns.lookup used by the HTTP agent.
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number } & Record<string, unknown>,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
      return callback(new BlockedAddressError(`blocked address for ${hostname}`) as NodeJS.ErrnoException, []);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function decode(stream: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return stream.pipe(createGunzip());
    case "deflate":
      return stream.pipe(createInflate());
    case "br":
      return stream.pipe(createBrotliDecompress());
    default:
      return stream;
  }
}

interface RawResponse {
  httpStatus: number;
  location: string | null;
  contentType: string | null;
  body: Buffer;
  truncated: boolean;
}

function requestOnce(url: URL, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      reject(new BlockedAddressError("blocked literal address"));
      return;
    }
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as never,
        signal,
        headers: {
          "user-agent": "ProspectoEvidenceBot/1.0 (+demo; quote verification)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (response) => {
        const httpStatus = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : null;
        const contentType = response.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? null;
        if ((httpStatus >= 300 && httpStatus < 400) || !TEXT_TYPES.includes(contentType ?? "")) {
          response.resume();
          resolve({ httpStatus, location, contentType, body: Buffer.alloc(0), truncated: false });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const stream = decode(response, response.headers["content-encoding"]);
        stream.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = MAX_BODY_BYTES - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room));
            size = MAX_BODY_BYTES;
            truncated = true;
            response.destroy();
            resolve({ httpStatus, location, contentType, body: Buffer.concat(chunks), truncated });
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on("end", () => resolve({ httpStatus, location, contentType, body: Buffer.concat(chunks), truncated }));
        stream.on("error", (error) => (truncated ? undefined : reject(error)));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

const SUMMARY_MAX = 300;

/** Title and the first non-empty description meta tag, entity-decoded and capped. */
export function pageSummary(html: string): { title: string | null; description: string | null } {
  const clean = (value: string | undefined) => {
    const text = value ? decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX) : "";
    return text || null;
  };
  const description = [...html.matchAll(/<meta\s[^>]*(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/gi)]
    .map((tag) => /content=["']([^"']*)["']/i.exec(tag[0])?.[1])
    .find((content) => content && content.trim());
  return { title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]), description: clean(description) };
}

/** Visible text plus <title> and meta descriptions (JS-rendered landing pages often only have those). */
export function htmlToText(html: string): string {
  const metas = [...html.matchAll(/<meta\s[^>]*(?:name|property)=["'](?:description|og:description|og:title|twitter:description)["'][^>]*>/gi)]
    .map((tag) => /content=["']([^"']*)["']/i.exec(tag[0])?.[1] ?? "")
    .filter(Boolean);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities([title, ...metas, body].join("\n"))
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function result(requestedUrl: string, partial: Partial<FetchResult> & { status: FetchStatus }): FetchResult {
  return {
    requestedUrl,
    finalUrl: null,
    httpStatus: null,
    contentType: null,
    text: null,
    contentSha256: null,
    truncated: false,
    ...partial,
  };
}

export const safeFetch: PageFetcher = async (requestedUrl) => {
  const start = normalizeUrl(requestedUrl);
  if (!start) return result(requestedUrl, { status: "INVALID_URL" });

  const signal = AbortSignal.timeout(DEADLINE_MS);
  let current = start;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await requestOnce(new URL(current), signal);
      if (response.httpStatus >= 300 && response.httpStatus < 400) {
        const next = response.location ? normalizeUrl(new URL(response.location, current).toString()) : null;
        if (!next) return result(requestedUrl, { status: "INVALID_URL", finalUrl: current, httpStatus: response.httpStatus });
        current = next;
        continue;
      }
      const base = { finalUrl: current, httpStatus: response.httpStatus, contentType: response.contentType };
      if (response.httpStatus < 200 || response.httpStatus >= 300) return result(requestedUrl, { status: "HTTP_ERROR", ...base });
      if (!TEXT_TYPES.includes(response.contentType ?? "")) return result(requestedUrl, { status: "UNSUPPORTED_TYPE", ...base });

      const raw = new TextDecoder("utf-8", { fatal: false }).decode(response.body);
      const isHtml = response.contentType === "text/html" || response.contentType === "application/xhtml+xml";
      return result(requestedUrl, {
        status: "OK",
        ...base,
        text: isHtml ? htmlToText(raw) : raw,
        contentSha256: createHash("sha256").update(response.body).digest("hex"),
        truncated: response.truncated,
        ...(isHtml ? { summary: pageSummary(raw) } : {}),
      });
    }
    return result(requestedUrl, { status: "TOO_MANY_REDIRECTS", finalUrl: current });
  } catch (error) {
    if (error instanceof BlockedAddressError) return result(requestedUrl, { status: "BLOCKED", finalUrl: current });
    if (signal.aborted) return result(requestedUrl, { status: "TIMEOUT", finalUrl: current });
    return result(requestedUrl, { status: "NETWORK_ERROR", finalUrl: current });
  }
};
