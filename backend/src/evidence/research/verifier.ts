// Deterministic verifier: turns Gemini proposals and collector output into evidence proposals
// with an evidence_status. This module, not Gemini, decides trust (BACKEND_STACK §1, M§2.4).
// Rules are documented in docs/EVIDENCE_RESEARCH.md §4; keep the two in sync.
import { createHash } from "node:crypto";

import { compareDecimal, differsBeyond, isDecimal, isInteger, normalizeDecimal, valueAppearsInText } from "../decimal.js";
import { METRICS, PRODUCT_STATUSES, assessmentMetricCode, isMetricCode, type MetricCode } from "../metrics.js";
import type { CorroborationPassOutput, ProposedClaim } from "./gemini.js";
import type { CollectedClaim } from "./github.js";
import type { FetchStatus } from "./safe-fetch.js";
import { normalizeUrl } from "./urls.js";

export const VERIFIER_VERSION = "verifier-v1";

export type EvidenceStatus =
  | "INDEPENDENTLY_VERIFIED"
  | "REVIEWER_VERIFIED"
  | "PUBLIC_WEAK"
  | "FOUNDER_ATTESTED"
  | "AI_ASSESSED"
  | "MISSING_OR_CONTRADICTED";

export type SourceType = "FOUNDER_STATEMENT" | "LINK" | "INTEGRATION" | "AI_ASSESSMENT";

export interface SourceRecord {
  url: string;
  finalUrl: string | null;
  origin: "FOUNDER_SUBMITTED" | "SEARCH_CITATION";
  founderControlled: boolean;
  fetchStatus: FetchStatus | "NOT_FETCHED" | "UNSUPPORTED_LINK";
  text: string | null;
  /** True when Gemini's grounding metadata (url_citation / url_context_result) named this URL. */
  groundingSeen: boolean;
}

export interface VerifyInput {
  project: { name: string; siteKey: string | null };
  founderText: string | null;
  sources: SourceRecord[];
  founderClaims: ProposedClaim[];
  corroborationClaims: ProposedClaim[];
  assessments: CorroborationPassOutput["assessments"];
  collected: CollectedClaim[];
}

export interface EvidenceProposal {
  id: string;
  metric_code: string;
  value_numeric: string | null;
  value_text: string | null;
  period_end: string | null;
  source_type: SourceType;
  source_url: string | null;
  quote: string | null;
  status: EvidenceStatus;
  /** Recorded as the evidence_verifications note, e.g. "system:quote-check". */
  method: string;
  reasons: string[];
  /** Only the founder's own low-confidence statements may be dropped at review (EVIDENCE_RESEARCH §5). */
  droppable: boolean;
}

export interface RejectedProposal {
  origin: "founder_pass" | "corroboration_pass" | "assessment";
  metric_code: string;
  source_url: string | null;
  reason: string;
}

export interface VerifyResult {
  proposals: EvidenceProposal[];
  rejected: RejectedProposal[];
}

// Pages whose readable text is shorter than this are treated as unverifiable (typically
// client-rendered apps), not as evidence that the quote is absent.
const MIN_VERIFIABLE_TEXT = 200;
// Two values for the same metric and period disagree when they differ by more than this percent.
const CONTRADICTION_TOLERANCE_PCT = 25n;
const MARKET_METRICS = new Set<string>(["tam_usd", "market_growth_pct"]);
// Backstop only: the closed metric vocabulary is the primary pedigree control (M§2.3).
const PEDIGREE_PATTERN =
  /\b(ivy league|alma mater|gpa|graduated from|degree from|prestigious|elite (?:school|university|college)|top[- ]tier (?:school|university|college)|gender|race|ethnicity|nationality|family background)\b/i;

const STATUS_RANK: Record<EvidenceStatus, number> = {
  INDEPENDENTLY_VERIFIED: 5,
  REVIEWER_VERIFIED: 4,
  PUBLIC_WEAK: 3,
  AI_ASSESSED: 2,
  FOUNDER_ATTESTED: 1,
  MISSING_OR_CONTRADICTED: 0,
};

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type QuoteState = "verified" | "absent" | "unverifiable";

function quoteState(quote: string, source: SourceRecord): QuoteState {
  if (source.fetchStatus !== "OK" || !source.text) return "unverifiable";
  const haystack = normalizeForMatch(source.text);
  if (haystack.includes(normalizeForMatch(quote))) return "verified";
  return haystack.length < MIN_VERIFIABLE_TEXT ? "unverifiable" : "absent";
}

function mentions(text: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  return n.length >= 3 && normalizeForMatch(text).includes(n);
}

function proposalId(parts: (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/** Validates the value against the metric's kind and range; returns [value_numeric, value_text] or a reason. */
function validateValue(code: MetricCode, value: string, quote: string): [string | null, string | null] | string {
  const definition = METRICS[code];
  if (definition.kind === "product_status") {
    const status = value.trim().toLowerCase();
    return (PRODUCT_STATUSES as readonly string[]).includes(status) ? [null, status] : "INVALID_VALUE";
  }
  const trimmed = value.trim();
  if (!isDecimal(trimmed)) return "INVALID_VALUE";
  if (definition.kind === "integer" && !isInteger(trimmed)) return "INVALID_VALUE";
  if ("min" in definition && compareDecimal(trimmed, definition.min) < 0) return "OUT_OF_RANGE";
  if ("max" in definition && compareDecimal(trimmed, definition.max) > 0) return "OUT_OF_RANGE";
  // Anti-hallucination: the number must literally appear in the cited excerpt.
  if (!valueAppearsInText(trimmed, quote)) return "VALUE_NOT_IN_QUOTE";
  return [normalizeDecimal(trimmed), null];
}

export function verifyResearch(input: VerifyInput): VerifyResult {
  const rejected: RejectedProposal[] = [];
  const proposals: EvidenceProposal[] = [];

  const byUrl = new Map<string, SourceRecord>();
  for (const source of input.sources) {
    for (const key of [source.url, source.finalUrl]) if (key) byUrl.set(key, source);
  }
  const findSource = (raw: string): SourceRecord | null => {
    const normalized = normalizeUrl(raw);
    if (!normalized) return null;
    const direct = byUrl.get(normalized);
    if (direct) return direct;
    const url = new URL(normalized);
    url.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
    return byUrl.get(url.toString()) ?? null;
  };

  const push = (proposal: Omit<EvidenceProposal, "id">) =>
    proposals.push({
      id: proposalId([proposal.metric_code, proposal.value_numeric, proposal.value_text, proposal.source_url, proposal.quote, proposal.source_type]),
      ...proposal,
    });

  // Founder pass: the founder's own links and text.
  for (const claim of input.founderClaims) {
    const reject = (reason: string) =>
      rejected.push({ origin: "founder_pass", metric_code: claim.metric_code, source_url: claim.source_url, reason });
    if (!isMetricCode(claim.metric_code)) {
      reject("UNKNOWN_METRIC");
      continue;
    }
    const value = validateValue(claim.metric_code, claim.value, claim.quote);
    if (typeof value === "string") {
      reject(value);
      continue;
    }
    const base = {
      metric_code: claim.metric_code,
      value_numeric: value[0],
      value_text: value[1],
      period_end: claim.period_end,
      quote: claim.quote,
    };

    if (claim.source_url === "founder_text") {
      if (!input.founderText || !normalizeForMatch(input.founderText).includes(normalizeForMatch(claim.quote))) {
        reject("QUOTE_NOT_IN_SOURCE");
        continue;
      }
      push({ ...base, source_type: "FOUNDER_STATEMENT", source_url: null, status: "FOUNDER_ATTESTED", method: "system:founder-text", reasons: [], droppable: true });
      continue;
    }

    const source = findSource(claim.source_url);
    if (!source || source.origin !== "FOUNDER_SUBMITTED") {
      reject("UNKNOWN_SOURCE");
      continue;
    }
    const state = quoteState(claim.quote, source);
    if (state === "absent") {
      reject("QUOTE_NOT_IN_SOURCE");
      continue;
    }
    const reasons = state === "unverifiable" ? ["QUOTE_UNVERIFIABLE"] : [];
    if (!source.founderControlled && state === "verified" && source.text && mentions(source.text, input.project.name)) {
      push({ ...base, source_type: "LINK", source_url: source.url, status: "PUBLIC_WEAK", method: "system:quote-check;third-party", reasons, droppable: false });
    } else {
      if (!source.founderControlled) reasons.push("THIRD_PARTY_UNCONFIRMED");
      push({ ...base, source_type: "LINK", source_url: source.url, status: "FOUNDER_ATTESTED", method: "system:quote-check;founder-source", reasons, droppable: true });
    }
  }

  // Corroboration pass: third-party pages found by search. Anything not provable is dropped.
  for (const claim of input.corroborationClaims) {
    const reject = (reason: string) =>
      rejected.push({ origin: "corroboration_pass", metric_code: claim.metric_code, source_url: claim.source_url, reason });
    if (!isMetricCode(claim.metric_code)) {
      reject("UNKNOWN_METRIC");
      continue;
    }
    const value = validateValue(claim.metric_code, claim.value, claim.quote);
    if (typeof value === "string") {
      reject(value);
      continue;
    }
    const source = findSource(claim.source_url);
    if (!source) {
      reject("UNKNOWN_SOURCE");
      continue;
    }
    if (source.founderControlled) {
      reject("SELF_PUBLISHED_SOURCE");
      continue;
    }
    const state = quoteState(claim.quote, source);
    if (state !== "verified") {
      reject(state === "absent" ? "QUOTE_NOT_IN_SOURCE" : "QUOTE_UNVERIFIABLE");
      continue;
    }
    // Company-specific facts must name the company and, unless the founder submitted the page,
    // its domain too. Student startups often share names with unrelated companies.
    if (!MARKET_METRICS.has(claim.metric_code)) {
      const text = source.text ?? "";
      const namesCompany = mentions(text, input.project.name);
      const namesDomain = input.project.siteKey !== null && mentions(text, input.project.siteKey);
      if (!namesCompany || (source.origin === "SEARCH_CITATION" && !namesDomain)) {
        reject("ENTITY_UNCONFIRMED");
        continue;
      }
    }
    push({
      metric_code: claim.metric_code,
      value_numeric: value[0],
      value_text: value[1],
      period_end: claim.period_end,
      source_type: "LINK",
      source_url: source.url,
      quote: claim.quote,
      status: "PUBLIC_WEAK",
      method: "system:quote-check;third-party",
      reasons: source.groundingSeen ? ["GROUNDING_CITED"] : [],
      droppable: false,
    });
  }

  // AI assessments of judgment factors: bounded influence via the AI_ASSESSED multiplier.
  for (const assessment of input.assessments) {
    const code = assessmentMetricCode(assessment.subfactor);
    const reject = (reason: string, url: string | null = null) => rejected.push({ origin: "assessment", metric_code: code, source_url: url, reason });
    if (PEDIGREE_PATTERN.test(assessment.rationale)) {
      reject("PEDIGREE_REASONING");
      continue;
    }
    const verified = assessment.citations.find((citation) => {
      const source = findSource(citation.source_url);
      return source !== null && quoteState(citation.quote, source) === "verified";
    });
    if (!verified) {
      reject("NO_VERIFIED_CITATION", assessment.citations[0]?.source_url ?? null);
      continue;
    }
    push({
      metric_code: code,
      value_numeric: normalizeDecimal(["0", "0.25", "0.5", "0.75", "1"][assessment.level]),
      value_text: assessment.rationale,
      period_end: null,
      source_type: "AI_ASSESSMENT",
      source_url: findSource(verified.source_url)!.url,
      quote: verified.quote,
      status: "AI_ASSESSED",
      method: "system:ai-assessment;quote-check",
      reasons: [],
      droppable: false,
    });
  }

  // Deterministic collectors (GitHub API).
  for (const claim of input.collected) {
    push({
      metric_code: claim.metric_code,
      value_numeric: normalizeDecimal(claim.value_numeric),
      value_text: claim.detail,
      period_end: null,
      source_type: "INTEGRATION",
      source_url: claim.source_url,
      quote: null,
      status: claim.status,
      method: claim.method,
      reasons: [],
      droppable: false,
    });
  }

  return { proposals: markContradictions(dedupe(proposals)), rejected };
}

function sortKey(proposal: EvidenceProposal): string {
  return `${String(9 - STATUS_RANK[proposal.status])}|${proposal.source_url ?? ""}|${proposal.id}`;
}

function dedupe(proposals: EvidenceProposal[]): EvidenceProposal[] {
  const seen = new Set<string>();
  return [...proposals]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    .filter((proposal) => {
      const key = [proposal.metric_code, proposal.value_numeric, proposal.metric_code.startsWith("assessment.") ? "" : proposal.value_text, proposal.period_end, proposal.status].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function disagree(a: EvidenceProposal, b: EvidenceProposal): boolean {
  if (a.value_numeric !== null && b.value_numeric !== null) return differsBeyond(a.value_numeric, b.value_numeric, CONTRADICTION_TOLERANCE_PCT);
  return a.value_text !== b.value_text;
}

/**
 * Within a metric/period group, the highest-ranked claims define the consensus. If they disagree
 * with each other, the whole group is contradicted (neutral prior + reviewer flag); otherwise
 * lower-ranked claims that disagree with the consensus are contradicted.
 */
function markContradictions(proposals: EvidenceProposal[]): EvidenceProposal[] {
  const groups = new Map<string, EvidenceProposal[]>();
  for (const proposal of proposals) {
    if (proposal.source_type === "AI_ASSESSMENT") continue;
    const key = `${proposal.metric_code}|${proposal.period_end ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), proposal]);
  }
  const contradicted = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const topRank = Math.max(...group.map((proposal) => STATUS_RANK[proposal.status]));
    const top = group.filter((proposal) => STATUS_RANK[proposal.status] === topRank);
    if (top.some((a) => top.some((b) => disagree(a, b)))) {
      group.forEach((proposal) => contradicted.add(proposal.id));
      continue;
    }
    for (const proposal of group) {
      if (STATUS_RANK[proposal.status] < topRank && disagree(proposal, top[0])) contradicted.add(proposal.id);
    }
  }
  return proposals.map((proposal) =>
    contradicted.has(proposal.id)
      ? {
          ...proposal,
          status: "MISSING_OR_CONTRADICTED",
          method: `${proposal.method};contradiction`,
          reasons: [...proposal.reasons, "CONTRADICTED"],
          droppable: false,
        }
      : proposal,
  );
}
