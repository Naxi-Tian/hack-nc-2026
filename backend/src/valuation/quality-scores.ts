// PURE: confirmed evidence claims → sub-factor scores → category scores → composite Q.
// Implements MARKET ARCHITECTURE §4.3–4.5 and BACKEND_STACK §5.1–5.2. All weights, multipliers,
// and rubrics come from model parameters (model_versions); none are hard-coded here.
// Scores are model outputs in [0, 1], not money, so binary floating point is acceptable.
import { z } from "zod";

import { compareDecimal, isDecimal } from "../evidence/decimal.js";
import { METRICS, METRIC_CODES, PRODUCT_STATUSES, SUBFACTORS, type Category, type Subfactor } from "../evidence/metrics.js";

const CATEGORIES = Object.keys(SUBFACTORS) as Category[];
const STAGES = ["IDEA", "PROTOTYPE", "LAUNCHED", "EARLY_REVENUE", "REPEATABLE_REVENUE"] as const;
const STATUSES = ["INDEPENDENTLY_VERIFIED", "REVIEWER_VERIFIED", "PUBLIC_WEAK", "FOUNDER_ATTESTED", "AI_ASSESSED", "MISSING_OR_CONTRADICTED"] as const;
const RUBRIC_LEVELS = new Set([0, 0.25, 0.5, 0.75, 1]);
const WEIGHT_EPSILON = 1e-9;

export type Stage = (typeof STAGES)[number];
export type ClaimStatus = (typeof STATUSES)[number];

const level = z.number().refine((value) => RUBRIC_LEVELS.has(value), "rubric level must be 0, 0.25, 0.5, 0.75, or 1");
const unit = z.number().min(0).max(1);
const sumsToOne = (record: Record<string, number>) => Math.abs(Object.values(record).reduce((a, b) => a + b, 0) - 1) <= WEIGHT_EPSILON;

const rubricSchema = z.union([
  z.object({ map: z.record(z.string(), level) }),
  z.object({
    bands: z
      .array(z.tuple([z.string().refine(isDecimal), level]))
      .min(1)
      .refine((bands) => bands.every((band, i) => i === 0 || compareDecimal(bands[i - 1][0], band[0]) < 0), "band minimums must ascend"),
  }),
]);

export const qualityParamsSchema = z
  .object({
    id: z.string().min(1),
    stage_weights: z.record(z.enum(STAGES), z.record(z.enum(CATEGORIES as [Category, ...Category[]]), unit)),
    factor_weights: z.record(z.enum(CATEGORIES as [Category, ...Category[]]), z.record(z.string(), unit)),
    normalization_rules: z.object({
      neutral_prior: unit,
      confidence_multipliers: z.record(z.enum(STATUSES), unit),
      assessable_subfactors: z.array(z.string()),
      rubrics: z.record(z.string(), rubricSchema),
      evidence_quality: z.object({
        strong_min_multiplier: unit,
        bands_pct: z.array(z.tuple([z.number().int().min(0).max(100), level])).min(1),
      }),
    }),
  })
  .superRefine((params, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    for (const stage of STAGES) {
      const weights = params.stage_weights[stage];
      if (!weights || CATEGORIES.some((category) => weights[category] === undefined)) issue(`stage ${stage} is missing category weights`);
      else if (!sumsToOne(weights)) issue(`stage ${stage} weights must sum to 1`);
    }
    for (const category of CATEGORIES) {
      const weights = params.factor_weights[category] ?? {};
      const expected = [...SUBFACTORS[category]].sort().join(",");
      if (Object.keys(weights).sort().join(",") !== expected) issue(`${category} factor weights must cover exactly ${expected}`);
      else if (!sumsToOne(weights)) issue(`${category} factor weights must sum to 1`);
    }
    for (const code of METRIC_CODES) {
      if (!params.normalization_rules.rubrics[code]) issue(`no rubric for metric ${code}`);
    }
    const productRubric = params.normalization_rules.rubrics.product_status;
    if (productRubric && (!("map" in productRubric) || PRODUCT_STATUSES.some((status) => productRubric.map[status] === undefined))) {
      issue("product_status rubric must map every product status");
    }
  });

export type QualityParams = z.infer<typeof qualityParamsSchema>;

export interface ScoringClaim {
  id: string;
  metric_code: string;
  value_numeric: string | null;
  value_text: string | null;
  status: ClaimStatus;
  created_at: Date;
}

export interface SubfactorScore {
  subfactor: Subfactor;
  s: number | null;
  c: number;
  adjusted: number;
  claim_id: string | null;
  metric_code: string | null;
  status: ClaimStatus | null;
}

export interface QualityScores {
  model_version_id: string;
  stage: Stage;
  categories: Record<Category, { score: number; weight: number; contribution: number }>;
  composite: number;
  subfactors: SubfactorScore[];
}

function rubricLevel(params: QualityParams, claim: ScoringClaim): number | null {
  if (claim.metric_code.startsWith("assessment.")) {
    // Assessment values are already rubric levels written by the verifier.
    const value = claim.value_numeric === null ? NaN : Number(claim.value_numeric);
    return RUBRIC_LEVELS.has(value) ? value : null;
  }
  const rubric = params.normalization_rules.rubrics[claim.metric_code];
  if (!rubric) return null;
  if ("map" in rubric) return claim.value_text !== null ? (rubric.map[claim.value_text] ?? null) : null;
  if (claim.value_numeric === null) return null;
  let s = rubric.bands[0][1];
  for (const [min, bandLevel] of rubric.bands) if (compareDecimal(claim.value_numeric, min) >= 0) s = bandLevel;
  return s;
}

function subfactorsOf(params: QualityParams, metricCode: string): readonly string[] {
  if (metricCode.startsWith("assessment.")) {
    const subfactor = metricCode.slice("assessment.".length);
    return params.normalization_rules.assessable_subfactors.includes(subfactor) ? [subfactor] : [];
  }
  return Object.hasOwn(METRICS, metricCode) ? METRICS[metricCode as keyof typeof METRICS].subfactors : [];
}

/** Derived evidence_quality input: share of strong claims, computed by the platform (c = 1). */
function evidenceQuality(params: QualityParams, claims: ScoringClaim[]): { s: number | null; c: number } {
  const rules = params.normalization_rules;
  const factual = claims.filter((claim) => !claim.metric_code.startsWith("assessment."));
  if (factual.length === 0) return { s: null, c: 0 };
  const strong = factual.filter((claim) => rules.confidence_multipliers[claim.status] >= rules.evidence_quality.strong_min_multiplier).length;
  let s = rules.evidence_quality.bands_pct[0][1];
  // Integer comparison: strong / total ≥ pct / 100.
  for (const [pct, bandLevel] of rules.evidence_quality.bands_pct) if (strong * 100 >= pct * factual.length) s = bandLevel;
  return { s, c: 1 };
}

/**
 * Picks one claim per sub-factor: highest confidence multiplier, then most recent, then
 * metric code and claim id (deterministic tie-break added here; BACKEND_STACK §5.1 stops at recency).
 */
export function computeQualityScores(params: QualityParams, stage: Stage, claims: ScoringClaim[]): QualityScores {
  const rules = params.normalization_rules;
  const mu = rules.neutral_prior;
  const adjust = (c: number, s: number | null) => (s === null ? mu : c * s + (1 - c) * mu);

  const best = new Map<string, { claim: ScoringClaim; s: number; c: number }>();
  for (const claim of claims) {
    const s = rubricLevel(params, claim);
    if (s === null) continue;
    const c = rules.confidence_multipliers[claim.status];
    for (const subfactor of subfactorsOf(params, claim.metric_code)) {
      const current = best.get(subfactor);
      const wins =
        !current ||
        c > current.c ||
        (c === current.c &&
          (claim.created_at.getTime() > current.claim.created_at.getTime() ||
            (claim.created_at.getTime() === current.claim.created_at.getTime() &&
              `${claim.metric_code}|${claim.id}` < `${current.claim.metric_code}|${current.claim.id}`)));
      if (wins) best.set(subfactor, { claim, s, c });
    }
  }

  const quality = evidenceQuality(params, claims);
  const subfactors: SubfactorScore[] = [];
  const categories = {} as QualityScores["categories"];
  let composite = 0;
  for (const category of CATEGORIES) {
    let score = 0;
    for (const subfactor of SUBFACTORS[category]) {
      let entry: SubfactorScore;
      if (subfactor === "evidence_quality") {
        entry = { subfactor, s: quality.s, c: quality.c, adjusted: adjust(quality.c, quality.s), claim_id: null, metric_code: null, status: null };
      } else {
        const chosen = best.get(subfactor);
        entry = chosen
          ? { subfactor, s: chosen.s, c: chosen.c, adjusted: adjust(chosen.c, chosen.s), claim_id: chosen.claim.id, metric_code: chosen.claim.metric_code, status: chosen.claim.status }
          : { subfactor, s: null, c: 0, adjusted: mu, claim_id: null, metric_code: null, status: null };
      }
      subfactors.push(entry);
      score += params.factor_weights[category][subfactor] * entry.adjusted;
    }
    const weight = params.stage_weights[stage][category];
    categories[category] = { score, weight, contribution: weight * score };
    composite += weight * score;
  }
  return { model_version_id: params.id, stage, categories, composite, subfactors };
}
