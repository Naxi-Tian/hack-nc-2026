// PURE: quality score + confirmed claims → the four M§4.2 values and a unit price.
// Implements MARKET ARCHITECTURE §4.6–4.10 and BACKEND_STACK §5.3–5.6. Every coefficient comes
// from model parameters (model_versions); none are hard-coded here.
//
// Precision: scenario, blend, and demand values are model outputs computed in binary floating point
// and rounded to 8 decimal places (numeric(30, 8) in valuation_snapshots). The money boundary, the
// unit price, is derived from that 8-decimal string with exact integer arithmetic and rounded DOWN,
// as M§4.10 and the valuation_snapshots check constraint require (BACKEND_STACK §5.6 says
// round_half_up; MARKET and the schema win, see docs/EVIDENCE_RESEARCH.md).
import { createHash } from "node:crypto";

import { z } from "zod";

import { compareDecimal, fromScaled, toScaled } from "../evidence/decimal.js";
import {
  computeQualityScores,
  effectiveStage,
  qualityParamsSchema,
  STAGES,
  type EffectiveStage,
  type QualityParams,
  type QualityScores,
  type ScoringClaim,
  type Stage,
} from "./quality-scores.js";

const SCENARIO_COUNT = 4;
const PROBABILITY_EPSILON = 1e-9;
export const REFERENCE_UNITS = 1_000_000n;

const stageKey = (stage: Stage) => stage.toLowerCase() as Lowercase<Stage>;
const LOWER_STAGES = STAGES.map(stageKey) as [Lowercase<Stage>, ...Lowercase<Stage>[]];
const quad = z.array(z.number().finite()).length(SCENARIO_COUNT);
const unit = z.number().min(0).max(1);

export const modelValueParamsSchema = z.object({
  scenario_parameters: z.object({
    horizon_years: z.number().int().positive(),
    scenarios: z.array(z.string()).length(SCENARIO_COUNT),
    baseline_probabilities: z
      .record(z.enum(LOWER_STAGES), quad)
      .refine((record) => LOWER_STAGES.every((stage) => record[stage] !== undefined), "every stage needs baseline probabilities")
      .refine(
        (record) => Object.values(record).every((p) => p.every((x) => x > 0) && Math.abs(p.reduce((a, b) => a + b, 0) - 1) <= PROBABILITY_EPSILON),
        "baseline probabilities must be positive (breakout stays non-zero, M§4.6) and sum to 1",
      ),
    beta: quad,
    default_sector: z.object({
      terminal_revenue_usd: quad.refine((v) => v.every((x) => x >= 0)),
      multiple: quad.refine((v) => v.every((x) => x >= 0)),
      discount_rate: quad.refine((v) => v.every((x) => x > -1)),
    }),
    // Only revenue stages have one; earlier stages use max(0, net assets) (M§4.7).
    stage_revenue_multiple: z.partialRecord(z.enum(LOWER_STAGES), z.number().positive()),
    operating_value: z.object({
      revenue_metric: z.string(),
      annualization: z.number().positive(),
      min_multiplier: unit,
    }),
    blend_alpha: z
      .record(z.enum(LOWER_STAGES), unit)
      .refine((record) => LOWER_STAGES.every((stage) => record[stage] !== undefined), "every stage needs a blend alpha"),
  }),
  demand_parameters: z
    .object({
      target_unique_buyers: z.number().int().positive(),
      k: z.number().positive(),
      clamp_low: z.number().positive(),
      clamp_high: z.number().positive(),
    })
    .refine((d) => d.clamp_low <= 1 && d.clamp_high >= 1, "clamp must contain 1"),
});

export type ModelValueParams = z.infer<typeof modelValueParamsSchema>;
export type ValuationParams = QualityParams & ModelValueParams;

/** Demand from the preceding round, after excluding founder, team, duplicate, and flagged buyers (M§4.9). */
export interface PriorRound {
  round_implied_value: string;
  accepted_micro_usd: bigint;
  target_micro_usd: bigint;
  /** Accepted amount per eligible buyer. */
  buyer_allocations_micro_usd: bigint[];
}

export interface ValuationInput {
  declared_stage: Stage;
  /** Current (non-superseded) claims with their latest verification status. */
  claims: ScoringClaim[];
  /** Null for a project's first round: demand multiplier 1, no clamp (BACKEND_STACK §5.5). */
  prior_round: PriorRound | null;
}

export interface ScenarioDetail {
  scenario: string;
  baseline_probability: number;
  probability: number;
  terminal_enterprise_value: number;
  present_value: number;
}

export interface Valuation {
  model_version_id: string;
  stage: EffectiveStage;
  scores: QualityScores;
  scenarios: ScenarioDetail[];
  operating: { arr: string | null; revenue_claim_id: string | null; revenue_multiple: number | null; net_cash: string };
  alpha: number;
  demand: { score: number | null; multiplier: number; clamped: boolean };
  values: {
    current_operating: string;
    fundamental_scenario: string;
    model_reference: string;
    round_implied: string;
  };
  reference_units: string;
  unit_price_micro_usd: string;
}

export class ValuationError extends Error {
  constructor(
    readonly code: "PRICE_BELOW_TICK" | "INVALID_PRIOR_ROUND",
    message: string,
  ) {
    super(message);
  }
}

/** Parses a model_versions row (or seed file) into both parameter groups. */
export function parseValuationParams(json: unknown): ValuationParams {
  return { ...qualityParamsSchema.parse(json), ...modelValueParamsSchema.parse(json) };
}

/** Model outputs are stored as numeric(30, 8). */
function toDecimal8(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`valuation produced ${value}`);
  return fromScaled(toScaled(value.toFixed(8)));
}

/** M§4.6: softmax(ln p_k + beta_k × (Q − 0.5)). */
export function scenarioProbabilities(baseline: readonly number[], beta: readonly number[], q: number): number[] {
  const logits = baseline.map((p, k) => Math.log(p) + beta[k] * (q - 0.5));
  const max = Math.max(...logits);
  const weights = logits.map((logit) => Math.exp(logit - max));
  const total = weights.reduce((a, b) => a + b, 0);
  const probabilities = weights.map((w) => w / total);
  if (Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) > PROBABILITY_EPSILON) throw new Error("probabilities must sum to 1");
  return probabilities;
}

/** M§4.9 demand score D, with BACKEND_STACK §5.5's normalized HHI. Inputs exclude ineligible buyers. */
export function demandScore(prior: PriorRound, targetUniqueBuyers: number): number {
  if (prior.target_micro_usd <= 0n || prior.accepted_micro_usd < 0n || prior.buyer_allocations_micro_usd.some((a) => a < 0n)) {
    throw new ValuationError("INVALID_PRIOR_ROUND", "Prior round amounts must be non-negative with a positive target.");
  }
  const fillRate = Number(prior.accepted_micro_usd) / Number(prior.target_micro_usd);
  const buyers = prior.buyer_allocations_micro_usd.filter((a) => a > 0n);
  const n = buyers.length;
  const breadth = Math.min(1, n / targetUniqueBuyers);
  const total = buyers.reduce((a, b) => a + b, 0n);
  const hhi = total === 0n ? 1 : buyers.reduce((sum, a) => sum + (Number(a) / Number(total)) ** 2, 0);
  const normalizedHhi = n <= 1 ? 1 : (hhi - 1 / n) / (1 - 1 / n);
  return 0.55 * Math.min(1, fillRate) + 0.3 * breadth + 0.15 * (1 - normalizedHhi);
}

/** M§4.10: floor(round_implied_value × 10^6 / REFERENCE_UNITS) micro-USD, exact. */
export function unitPriceMicroUsd(roundImpliedValue: string, referenceUnits: bigint = REFERENCE_UNITS): bigint {
  // toScaled is ×10^8, so divide the extra 10^8 back out together with the units.
  return (toScaled(roundImpliedValue) * 1_000_000n) / (100_000_000n * referenceUnits);
}

/** Highest-confidence, then most recent, qualifying revenue claim (M§4.7 "verified revenue"). */
function verifiedRevenue(params: ValuationParams, claims: ScoringClaim[]): ScoringClaim | null {
  const { revenue_metric, min_multiplier } = params.scenario_parameters.operating_value;
  const multipliers = params.normalization_rules.confidence_multipliers;
  let best: ScoringClaim | null = null;
  for (const claim of claims) {
    if (claim.metric_code !== revenue_metric || claim.value_numeric === null) continue;
    if (multipliers[claim.status] < min_multiplier || compareDecimal(claim.value_numeric, "0") < 0) continue;
    if (
      !best ||
      multipliers[claim.status] > multipliers[best.status] ||
      (multipliers[claim.status] === multipliers[best.status] && claim.created_at.getTime() > best.created_at.getTime())
    ) {
      best = claim;
    }
  }
  return best;
}

export function computeValuation(params: ValuationParams, input: ValuationInput): Valuation {
  const stage = effectiveStage(params, input.declared_stage, input.claims);
  const key = stageKey(stage.effective);
  const scores = computeQualityScores(params, stage.effective, input.claims);
  const sp = params.scenario_parameters;

  // M§4.6. No net-cash metric exists yet, so current_net_cash is 0 (BACKEND_STACK §5.3).
  const netCash = 0;
  const probabilities = scenarioProbabilities(sp.baseline_probabilities[key], sp.beta, scores.composite);
  const scenarios = sp.scenarios.map((scenario, k): ScenarioDetail => {
    const terminal = sp.default_sector.terminal_revenue_usd[k] * sp.default_sector.multiple[k];
    return {
      scenario,
      baseline_probability: sp.baseline_probabilities[key][k],
      probability: probabilities[k],
      terminal_enterprise_value: terminal,
      present_value: terminal / (1 + sp.default_sector.discount_rate[k]) ** sp.horizon_years,
    };
  });
  const fundamental = scenarios.reduce((sum, s) => sum + s.probability * s.present_value, 0) + netCash;

  // M§4.7: ARR × stage multiple once a revenue stage applies; before that, max(0, net assets).
  const revenueMultiple = sp.stage_revenue_multiple[key] ?? null;
  const revenue = revenueMultiple === null ? null : verifiedRevenue(params, input.claims);
  const arr = revenue ? Number(revenue.value_numeric) * sp.operating_value.annualization : null;
  const currentOperating = Math.max(0, netCash + (arr !== null && revenueMultiple !== null ? arr * revenueMultiple : 0));

  // M§4.8.
  const alpha = sp.blend_alpha[key];
  const modelReference = toDecimal8(alpha * currentOperating + (1 - alpha) * fundamental);

  // M§4.9: crowd demand from the preceding round, bounded, and only for the next round.
  let demand: Valuation["demand"] = { score: null, multiplier: 1, clamped: false };
  let roundImplied = modelReference;
  if (input.prior_round) {
    const dp = params.demand_parameters;
    const score = demandScore(input.prior_round, dp.target_unique_buyers);
    const multiplier = Math.exp(dp.k * (score - 0.5));
    const previous = Number(input.prior_round.round_implied_value);
    const raw = Number(modelReference) * multiplier;
    const clampedValue = Math.min(Math.max(raw, previous * dp.clamp_low), previous * dp.clamp_high);
    demand = { score, multiplier, clamped: clampedValue !== raw };
    roundImplied = toDecimal8(clampedValue);
  }

  const price = unitPriceMicroUsd(roundImplied);
  if (price < 1n) throw new ValuationError("PRICE_BELOW_TICK", "Round value is below one micro-USD per unit.");

  return {
    model_version_id: params.id,
    stage,
    scores,
    scenarios,
    operating: {
      arr: arr === null ? null : toDecimal8(arr),
      revenue_claim_id: revenue?.id ?? null,
      revenue_multiple: revenueMultiple,
      net_cash: toDecimal8(netCash),
    },
    alpha,
    demand,
    values: {
      current_operating: toDecimal8(currentOperating),
      fundamental_scenario: toDecimal8(fundamental),
      model_reference: modelReference,
      round_implied: roundImplied,
    },
    reference_units: REFERENCE_UNITS.toString(),
    unit_price_micro_usd: price.toString(),
  };
}

/** Canonical JSON (sorted keys) so the same parameters always hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** model_versions.model_hash: sha256 of the canonical parameter JSON. */
export function modelHash(params: unknown): string {
  return createHash("sha256").update(canonicalJson(params)).digest("hex");
}
