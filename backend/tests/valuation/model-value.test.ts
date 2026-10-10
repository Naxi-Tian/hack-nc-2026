import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  computeValuation,
  demandScore,
  modelHash,
  modelValueParamsSchema,
  parseValuationParams,
  scenarioProbabilities,
  unitPriceMicroUsd,
  type PriorRound,
} from "../../src/valuation/model-value.js";
import { computeQualityScores, effectiveStage, type ScoringClaim } from "../../src/valuation/quality-scores.js";

const seed = JSON.parse(readFileSync(new URL("../../../db/seeds/valuation-v0.1.json", import.meta.url), "utf8"));
const params = parseValuationParams(seed);

let n = 0;
const claim = (metric_code: string, value: string, status: ScoringClaim["status"], text = false): ScoringClaim => ({
  id: `c${++n}`,
  metric_code,
  value_numeric: text ? null : value,
  value_text: text ? value : null,
  status,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)),
});

// Expected values computed independently with Python's decimal module from valuation-v0.1.
const close = (actual: string, expected: string) => expect(Math.abs(Number(actual) - Number(expected))).toBeLessThan(1e-4);

describe("computeValuation (M§4.6–4.10 golden cases)", () => {
  it("idea stage, no evidence: baseline scenario odds, zero operating value", () => {
    const v = computeValuation(params, { declared_stage: "IDEA", claims: [], prior_round: null });
    expect(v.scores.composite).toBeCloseTo(0.5, 12);
    expect(v.scenarios.map((s) => s.probability)).toEqual([0.7, 0.2, 0.08, 0.02].map((p) => expect.closeTo(p, 12)));
    close(v.scenarios[1].present_value.toFixed(8), "53865.81486858");
    close(v.scenarios[3].present_value.toFixed(8), "15802469.13580247");
    close(v.values.fundamental_scenario, "416071.07308906");
    expect(v.values.current_operating).toBe("0");
    close(v.values.model_reference, "374463.96578016");
    expect(v.values.round_implied).toBe(v.values.model_reference);
    expect(v.unit_price_micro_usd).toBe("374463");
    expect(v.demand).toEqual({ score: null, multiplier: 1, clamped: false });
  });

  it("an unsupported declared stage prices as IDEA", () => {
    const declared = computeValuation(params, { declared_stage: "REPEATABLE_REVENUE", claims: [], prior_round: null });
    const idea = computeValuation(params, { declared_stage: "IDEA", claims: [], prior_round: null });
    expect(declared.stage).toEqual({ declared: "REPEATABLE_REVENUE", effective: "IDEA", claim_ids: [] });
    expect(declared.values).toEqual(idea.values);
  });

  it("verified MRR unlocks early revenue: ARR × multiple blended at alpha 0.5", () => {
    const mrr = claim("mrr_usd", "2000", "REVIEWER_VERIFIED");
    const v = computeValuation(params, { declared_stage: "EARLY_REVENUE", claims: [mrr], prior_round: null });
    expect(v.stage.effective).toBe("EARLY_REVENUE");
    // revenue_or_commitments s=0.5 is neutral; evidence_quality 100% strong lifts product by 0.05 → Q = 0.505.
    expect(v.scores.composite).toBeCloseTo(0.505, 12);
    expect(v.operating).toEqual({ arr: "24000", revenue_claim_id: mrr.id, revenue_multiple: 2, net_cash: "0" });
    expect(v.values.current_operating).toBe("48000");
    close(v.values.fundamental_scenario, "1211512.81359091");
    close(v.values.model_reference, "629756.40679545");
    expect(v.unit_price_micro_usd).toBe("629756");
  });

  it("founder-attested MRR does not unlock a revenue stage", () => {
    const v = computeValuation(params, { declared_stage: "EARLY_REVENUE", claims: [claim("mrr_usd", "9000", "FOUNDER_ATTESTED")], prior_round: null });
    expect(v.stage.effective).toBe("IDEA");
    expect(v.operating.arr).toBeNull();
  });

  it("prior-round demand adjusts the next round within the clamp", () => {
    const prior: PriorRound = {
      round_implied_value: "400000",
      accepted_micro_usd: 50_000_000000n,
      target_micro_usd: 100_000_000000n,
      buyer_allocations_micro_usd: Array(5).fill(10_000_000000n),
    };
    // fill 0.5, breadth 0.5, equal shares → deconcentration 1 → D = 0.575.
    expect(demandScore(prior, 10)).toBeCloseTo(0.575, 12);
    const v = computeValuation(params, { declared_stage: "IDEA", claims: [], prior_round: prior });
    expect(v.demand.multiplier).toBeCloseTo(Math.exp(0.4 * 0.075), 12);
    expect(v.demand.clamped).toBe(false);
    close(v.values.round_implied, "385868.09134038");
    expect(v.unit_price_micro_usd).toBe("385868");
  });

  it("clamps the next round to 1.5× the previous round value", () => {
    const prior: PriorRound = {
      round_implied_value: "100000",
      accepted_micro_usd: 100_000_000000n,
      target_micro_usd: 100_000_000000n,
      buyer_allocations_micro_usd: [100_000_000000n],
    };
    const v = computeValuation(params, { declared_stage: "IDEA", claims: [], prior_round: prior });
    expect(v.demand.clamped).toBe(true);
    expect(v.values.round_implied).toBe("150000");
    expect(v.unit_price_micro_usd).toBe("150000");
  });

  it("is deterministic for the same input and parameters", () => {
    const claims = [claim("product_status", "launched", "FOUNDER_ATTESTED", true), claim("active_users", "300", "PUBLIC_WEAK")];
    const a = computeValuation(params, { declared_stage: "LAUNCHED", claims, prior_round: null });
    const b = computeValuation(params, { declared_stage: "LAUNCHED", claims: [...claims].reverse(), prior_round: null });
    expect(a).toEqual(b);
    expect(a.stage.effective).toBe("LAUNCHED");
  });
});

describe("effectiveStage", () => {
  it("never exceeds the declared stage", () => {
    const launched = claim("product_status", "launched", "INDEPENDENTLY_VERIFIED", true);
    expect(effectiveStage(params, "PROTOTYPE", [launched]).effective).toBe("PROTOTYPE");
  });

  it("falls back to the highest supported stage", () => {
    const beta = claim("product_status", "beta", "FOUNDER_ATTESTED", true);
    expect(effectiveStage(params, "LAUNCHED", [beta])).toEqual({ declared: "LAUNCHED", effective: "PROTOTYPE", claim_ids: [beta.id] });
  });

  it("ignores contradicted claims", () => {
    const launched = claim("product_status", "launched", "MISSING_OR_CONTRADICTED", true);
    expect(effectiveStage(params, "LAUNCHED", [launched]).effective).toBe("IDEA");
  });

  it("repeatable revenue needs every listed requirement", () => {
    const mrr = claim("mrr_usd", "8000", "INDEPENDENTLY_VERIFIED");
    expect(effectiveStage(params, "REPEATABLE_REVENUE", [mrr]).effective).toBe("EARLY_REVENUE");
    const recurring = claim("recurring_revenue_share_pct", "80", "FOUNDER_ATTESTED");
    expect(effectiveStage(params, "REPEATABLE_REVENUE", [mrr, recurring]).effective).toBe("REPEATABLE_REVENUE");
  });
});

describe("prior-venture traction (metrics-v3)", () => {
  const shipped = (claims: ScoringClaim[]) => computeQualityScores(params, "IDEA", claims).subfactors.find((s) => s.subfactor === "shipped_work")!;

  it("scores shipped_work, bounded by confidence", () => {
    expect(shipped([claim("prior_venture_users", "5000", "FOUNDER_ATTESTED")]).adjusted).toBeCloseTo(0.5875, 12);
    expect(shipped([claim("prior_venture_users", "5000", "PUBLIC_WEAK")]).adjusted).toBeCloseTo(0.6625, 12);
    expect(shipped([claim("prior_venture_revenue_usd", "150000", "PUBLIC_WEAK")]).adjusted).toBeCloseTo(0.825, 12);
  });

  it("no prior traction is neutral, never a penalty", () => {
    expect(shipped([claim("prior_venture_users", "0", "INDEPENDENTLY_VERIFIED")]).adjusted).toBe(0.5);
  });
});

describe("money boundary and invariants", () => {
  it("unit price rounds down exactly", () => {
    expect(unitPriceMicroUsd("135824.99999999")).toBe(135824n);
    expect(unitPriceMicroUsd("135824")).toBe(135824n);
    expect(unitPriceMicroUsd("0.99999999")).toBe(0n);
  });

  it("probabilities sum to 1 for extreme Q and the breakout stays non-zero", () => {
    for (const q of [0, 0.5, 1]) {
      const p = scenarioProbabilities([0.7, 0.2, 0.08, 0.02], [-2, 0, 1, 1.5], q);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(p[3]).toBeGreaterThan(0);
    }
  });

  it("rejects a zero baseline probability and a clamp that excludes 1", () => {
    const zero = structuredClone(seed);
    zero.scenario_parameters.baseline_probabilities.idea = [0.8, 0.2, 0, 0];
    expect(() => modelValueParamsSchema.parse(zero)).toThrow();
    const clamp = structuredClone(seed);
    clamp.demand_parameters.clamp_low = 1.1;
    expect(() => modelValueParamsSchema.parse(clamp)).toThrow();
  });

  it("rejects a stage requirement on an unknown metric", () => {
    const bad = structuredClone(seed);
    bad.normalization_rules.stage_evidence.LAUNCHED = [{ metric: "school_rank", min: "1", min_multiplier: 0.35 }];
    expect(() => parseValuationParams(bad)).toThrow();
  });

  it("model hash ignores key order", () => {
    const reordered = Object.fromEntries(Object.entries(seed).reverse());
    expect(modelHash(reordered)).toBe(modelHash(seed));
    expect(modelHash(seed)).toMatch(/^[a-f0-9]{64}$/);
  });
});
