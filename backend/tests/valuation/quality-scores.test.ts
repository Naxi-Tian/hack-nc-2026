import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeQualityScores, qualityParamsSchema, type ScoringClaim } from "../../src/valuation/quality-scores.js";

const params = qualityParamsSchema.parse(JSON.parse(readFileSync(new URL("../../../db/seeds/valuation-v0.1.json", import.meta.url), "utf8")));
const at = (iso: string) => new Date(iso);
let next = 0;
const claim = (metric_code: string, value: string, status: ScoringClaim["status"], created = "2026-10-01T00:00:00Z"): ScoringClaim => {
  const isText = metric_code === "product_status";
  return { id: `c${(next += 1)}`, metric_code, value_numeric: isText ? null : value, value_text: isText ? value : null, status, created_at: at(created) };
};

describe("valuation-v0.1 parameters", () => {
  it("passes invariant checks (weights sum to 1, every metric has a rubric)", () => {
    expect(params.id).toBe("valuation-v0.1");
  });

  it("rejects parameter sets whose weights do not sum to 1", () => {
    const broken = structuredClone(params);
    broken.stage_weights.IDEA.execution = 0.5;
    expect(qualityParamsSchema.safeParse(broken).success).toBe(false);
  });
});

describe("computeQualityScores", () => {
  it("gives a founder with no evidence the neutral prior everywhere (M§2.3: missing is not negative)", () => {
    const scores = computeQualityScores(params, "IDEA", []);
    expect(scores.composite).toBeCloseTo(0.5, 12);
    expect(scores.subfactors.every((entry) => entry.adjusted === 0.5)).toBe(true);
  });

  it("applies adjusted = c·s + (1−c)·μ with the highest-confidence claim (golden case)", () => {
    const scores = computeQualityScores(params, "PROTOTYPE", [
      claim("product_status", "beta", "FOUNDER_ATTESTED"), // s .75, c .35 → .5875 for shipped_work and product_completeness
      claim("repo_commits_90d", "24", "INDEPENDENTLY_VERIFIED"), // s .5, c 1 → .5
      claim("repo_active_weeks_13w", "8", "INDEPENDENTLY_VERIFIED", "2026-10-02T00:00:00Z"), // s .75, c 1, newer → wins velocity → .75
      claim("active_users", "800", "PUBLIC_WEAK"), // s .5 → .5
      claim("waitlist_signups", "1200", "FOUNDER_ATTESTED"), // loses user_validation to PUBLIC_WEAK
    ]);
    const sub = Object.fromEntries(scores.subfactors.map((entry) => [entry.subfactor, entry.adjusted]));
    expect(sub.shipped_work).toBeCloseTo(0.5875, 12);
    expect(sub.execution_velocity).toBeCloseTo(0.75, 12);
    expect(sub.user_validation).toBeCloseTo(0.5, 12);
    // evidence_quality: 3 of 5 claims have c ≥ .65 → 60% → s .75, c 1.
    expect(sub.evidence_quality).toBeCloseTo(0.75, 12);

    // E = .35·.5875 + .25·.5 + .20·.75 + .10·.5 + .10·.5 = .580625
    expect(scores.categories.execution.score).toBeCloseTo(0.580625, 12);
    // P = .30·.5875 + .25·.5 + .20·.5 + .15·.5 + .10·.75 = .55125
    expect(scores.categories.product.score).toBeCloseTo(0.55125, 12);
    // Q (prototype: .30 E, .25 M, .25 P, .15 T, .05 U) with M = T = U = .5
    expect(scores.composite).toBeCloseTo(0.3 * 0.580625 + 0.25 * 0.5 + 0.25 * 0.55125 + 0.15 * 0.5 + 0.05 * 0.5, 12);
  });

  it("lets prior shipped products add to shipped_work but never erase a launched product (metrics-v2)", () => {
    const shipped = (claims: ScoringClaim[]) =>
      computeQualityScores(params, "PROTOTYPE", claims).subfactors.find((entry) => entry.subfactor === "shipped_work")!;
    // Equal confidence: the higher rubric level wins even though the prior-project claim is newer.
    const both = shipped([
      claim("product_status", "launched", "FOUNDER_ATTESTED"),
      claim("prior_shipped_products", "1", "FOUNDER_ATTESTED", "2026-10-05T00:00:00Z"),
    ]);
    expect(both.metric_code).toBe("product_status");
    expect(both.adjusted).toBeCloseTo(0.35 * 1 + 0.65 * 0.5, 12);
    // A deployed side project alone lifts an idea-stage founder above neutral...
    expect(shipped([claim("prior_shipped_products", "1", "FOUNDER_ATTESTED")]).adjusted).toBeCloseTo(0.35 * 0.75 + 0.65 * 0.5, 12);
    // ...and having none is neutral, never negative (M§2.3).
    expect(shipped([claim("prior_shipped_products", "0", "FOUNDER_ATTESTED")]).adjusted).toBeCloseTo(0.5, 12);
  });

  it("bounds an AI assessment's influence to [0.325, 0.675]", () => {
    const low = computeQualityScores(params, "IDEA", [claim("assessment.pain_urgency", "0", "AI_ASSESSED")]);
    const high = computeQualityScores(params, "IDEA", [claim("assessment.pain_urgency", "1", "AI_ASSESSED")]);
    const pain = (scores: typeof low) => scores.subfactors.find((entry) => entry.subfactor === "pain_urgency")!.adjusted;
    expect(pain(low)).toBeCloseTo(0.325, 12);
    expect(pain(high)).toBeCloseTo(0.675, 12);
  });

  it("lets verified market data outrank an AI assessment of the same sub-factor", () => {
    const scores = computeQualityScores(params, "IDEA", [claim("assessment.growth_or_tailwind", "1", "AI_ASSESSED"), claim("market_growth_pct", "3", "PUBLIC_WEAK")]);
    const tailwind = scores.subfactors.find((entry) => entry.subfactor === "growth_or_tailwind")!;
    expect(tailwind).toMatchObject({ metric_code: "market_growth_pct", s: 0.25, c: 0.65 });
  });

  it("treats contradicted claims as neutral and scores lower-is-better metrics correctly", () => {
    const scores = computeQualityScores(params, "EARLY_REVENUE", [claim("mrr_usd", "50000", "MISSING_OR_CONTRADICTED"), claim("cac_usd", "8", "REVIEWER_VERIFIED")]);
    const sub = Object.fromEntries(scores.subfactors.map((entry) => [entry.subfactor, entry]));
    expect(sub.revenue_or_commitments.adjusted).toBeCloseTo(0.5, 12);
    expect(sub.acquisition_efficiency.adjusted).toBeCloseTo(0.85 * 1 + 0.15 * 0.5, 12);
  });

  it("is deterministic for identical inputs", () => {
    const claims = [claim("mrr_usd", "700", "PUBLIC_WEAK"), claim("loi_count", "3", "PUBLIC_WEAK")];
    expect(computeQualityScores(params, "LAUNCHED", claims)).toEqual(computeQualityScores(params, "LAUNCHED", claims));
  });
});
