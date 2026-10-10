// Closed vocabulary of evidence metrics (docs/EVIDENCE_RESEARCH.md §3).
// Gemini's response schema uses these codes as an enum and the verifier rejects anything else,
// so prestige or demographic attributes (M§2.3) have no field to land in.
// Rubric thresholds live in model_versions.normalization_rules, never here.

export const METRIC_CATALOG_VERSION = "metrics-v1";

export const SUBFACTORS = {
  execution: ["shipped_work", "relevant_domain_ability", "execution_velocity", "team_coverage", "commitment_evidence"],
  market: ["plausible_market_size", "growth_or_tailwind", "pain_urgency", "reachable_initial_segment"],
  product: ["product_completeness", "user_validation", "differentiation", "defensibility", "evidence_quality"],
  traction: [
    "growth",
    "retention_or_repeat_use",
    "revenue_or_commitments",
    "engagement_or_usage_depth",
    "acquisition_efficiency",
  ],
  economics: [
    "gross_margin_potential",
    "capital_efficiency",
    "payback_or_sales_efficiency",
    "recurring_or_repeat_revenue_quality",
    "runway",
  ],
} as const;

export type Category = keyof typeof SUBFACTORS;
export type Subfactor = (typeof SUBFACTORS)[Category][number];

export const PRODUCT_STATUSES = ["idea", "mockup", "prototype", "beta", "launched"] as const;

export type MetricKind = "decimal" | "integer" | "product_status";

export interface MetricDefinition {
  subfactors: readonly Subfactor[];
  kind: MetricKind;
  unit: string | null;
  min?: string;
  max?: string;
  description: string;
}

export const METRICS = {
  product_status: {
    subfactors: ["shipped_work", "product_completeness"],
    kind: "product_status",
    unit: null,
    description: "Furthest observable product state: idea, mockup, prototype, beta, or launched (publicly usable).",
  },
  relevant_experience_years: {
    subfactors: ["relevant_domain_ability"],
    kind: "decimal",
    unit: "years",
    min: "0",
    max: "60",
    description: "Years of work directly relevant to this startup's domain. Never schools or employer prestige.",
  },
  repo_commits_90d: {
    subfactors: ["execution_velocity"],
    kind: "integer",
    unit: "commits",
    min: "0",
    max: "100000",
    description: "Commits to the project's public repositories in the last 90 days.",
  },
  repo_active_weeks_13w: {
    subfactors: ["execution_velocity"],
    kind: "integer",
    unit: "weeks",
    min: "0",
    max: "13",
    description: "Weeks with at least one commit in the last 13 weeks.",
  },
  team_functions_count: {
    subfactors: ["team_coverage"],
    kind: "integer",
    unit: "functions",
    min: "0",
    max: "7",
    description: "Distinct functions covered by the team (engineering, design, product, sales, marketing, operations, domain).",
  },
  full_time_founders: {
    subfactors: ["commitment_evidence"],
    kind: "integer",
    unit: "people",
    min: "0",
    max: "20",
    description: "Founders working on the startup full time.",
  },
  tam_usd: {
    subfactors: ["plausible_market_size"],
    kind: "decimal",
    unit: "USD",
    min: "0",
    max: "100000000000000",
    description: "Total addressable market in USD per year, from a cited third-party source.",
  },
  market_growth_pct: {
    subfactors: ["growth_or_tailwind"],
    kind: "decimal",
    unit: "percent_per_year",
    min: "-100",
    max: "1000",
    description: "Annual market growth rate (CAGR) in percent, from a cited third-party source.",
  },
  initial_segment_size: {
    subfactors: ["reachable_initial_segment"],
    kind: "integer",
    unit: "customers",
    min: "0",
    max: "10000000000",
    description: "Number of customers in the first segment the startup can realistically reach.",
  },
  customer_interviews_count: {
    subfactors: ["user_validation"],
    kind: "integer",
    unit: "interviews",
    min: "0",
    max: "100000",
    description: "Customer discovery interviews conducted.",
  },
  waitlist_signups: {
    subfactors: ["user_validation"],
    kind: "integer",
    unit: "signups",
    min: "0",
    max: "100000000",
    description: "Waitlist sign-ups.",
  },
  active_users: {
    subfactors: ["user_validation"],
    kind: "integer",
    unit: "users",
    min: "0",
    max: "10000000000",
    description: "Monthly active users.",
  },
  mom_growth_pct: {
    subfactors: ["growth"],
    kind: "decimal",
    unit: "percent_per_month",
    min: "-100",
    max: "10000",
    description: "Month-over-month growth of the primary usage or revenue metric, in percent.",
  },
  retention_m1_pct: {
    subfactors: ["retention_or_repeat_use"],
    kind: "decimal",
    unit: "percent",
    min: "0",
    max: "100",
    description: "Share of users or customers still active one month after starting, in percent.",
  },
  mrr_usd: {
    subfactors: ["revenue_or_commitments"],
    kind: "decimal",
    unit: "USD_per_month",
    min: "0",
    max: "1000000000",
    description: "Monthly recurring (or average monthly) revenue in USD.",
  },
  loi_count: {
    subfactors: ["revenue_or_commitments"],
    kind: "integer",
    unit: "letters",
    min: "0",
    max: "10000",
    description: "Signed letters of intent or paid/unpaid pilots. Weaker than revenue (M§4.3).",
  },
  dau_mau_pct: {
    subfactors: ["engagement_or_usage_depth"],
    kind: "decimal",
    unit: "percent",
    min: "0",
    max: "100",
    description: "Daily active users divided by monthly active users, in percent.",
  },
  cac_usd: {
    subfactors: ["acquisition_efficiency"],
    kind: "decimal",
    unit: "USD",
    min: "0",
    max: "10000000",
    description: "Customer acquisition cost in USD.",
  },
  gross_margin_pct: {
    subfactors: ["gross_margin_potential"],
    kind: "decimal",
    unit: "percent",
    min: "-1000",
    max: "100",
    description: "Gross margin in percent.",
  },
  cac_payback_months: {
    subfactors: ["payback_or_sales_efficiency"],
    kind: "decimal",
    unit: "months",
    min: "0",
    max: "240",
    description: "Months to recover customer acquisition cost.",
  },
  recurring_revenue_share_pct: {
    subfactors: ["recurring_or_repeat_revenue_quality"],
    kind: "decimal",
    unit: "percent",
    min: "0",
    max: "100",
    description: "Share of revenue that is recurring or repeat, in percent.",
  },
  runway_months: {
    subfactors: ["runway"],
    kind: "decimal",
    unit: "months",
    min: "0",
    max: "600",
    description: "Months of runway at the current burn rate.",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricCode = keyof typeof METRICS;
export const METRIC_CODES = Object.keys(METRICS) as MetricCode[];

// Judgment-heavy sub-factors Gemini may assess with citations (decision (b), EVIDENCE_RESEARCH §4).
// Each assessment is stored as an AI_ASSESSED claim under `assessment.<subfactor>`.
export const ASSESSABLE_SUBFACTORS = ["pain_urgency", "differentiation", "defensibility", "growth_or_tailwind"] as const;
export type AssessableSubfactor = (typeof ASSESSABLE_SUBFACTORS)[number];

export const assessmentMetricCode = (subfactor: AssessableSubfactor) => `assessment.${subfactor}` as const;

export function isMetricCode(code: string): code is MetricCode {
  return Object.hasOwn(METRICS, code);
}
