// Valuation I/O (BACKEND_STACK §5, M§9.3): loads the model version and a project's current
// claims, runs the pure model (model-value.ts), and records score + valuation snapshots that
// share one valuation_run_id. Snapshots are append-only; identical inputs reuse the latest one.
import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  canonicalJson,
  computeValuation,
  modelHash,
  parseValuationParams,
  type PriorRound,
  type Valuation,
  type ValuationParams,
} from "./model-value.js";
import { STAGES, type ClaimStatus, type ScoringClaim, type Stage } from "./quality-scores.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Used until a version is ACTIVE; DRAFT results are labeled as such in every response. */
export const DEFAULT_MODEL_VERSION_ID = "valuation-v0.1";

export class ValuationServiceError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "MODEL_UNAVAILABLE",
    readonly httpStatus: 404 | 503,
    message: string,
  ) {
    super(message);
  }
}

export interface LoadedModel {
  params: ValuationParams;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  modelHash: string;
}

interface ModelRow {
  id: string;
  status: LoadedModel["status"];
  model_hash: string | null;
  stage_weights: unknown;
  factor_weights: unknown;
  normalization_rules: unknown;
  scenario_parameters: unknown;
  demand_parameters: unknown;
}

/** The hashed parameter set: everything that determines a valuation. */
export function modelDocument(row: Omit<ModelRow, "status" | "model_hash">) {
  return {
    id: row.id,
    stage_weights: row.stage_weights,
    factor_weights: row.factor_weights,
    normalization_rules: row.normalization_rules,
    scenario_parameters: row.scenario_parameters,
    demand_parameters: row.demand_parameters,
  };
}

/** The ACTIVE version, else the default DRAFT. Refuses parameters that no longer match their hash. */
export async function loadModel(pool: Pool, fallbackId = DEFAULT_MODEL_VERSION_ID): Promise<LoadedModel> {
  const { rows } = await pool.query<ModelRow>(
    `select id, status, model_hash, stage_weights, factor_weights, normalization_rules, scenario_parameters, demand_parameters
       from model_versions
      where status = 'ACTIVE' or id = $1
      order by (status = 'ACTIVE') desc
      limit 1`,
    [fallbackId],
  );
  const row = rows[0];
  if (!row || row.status === "RETIRED") {
    throw new ValuationServiceError("MODEL_UNAVAILABLE", 503, "No valuation model is loaded. Run: npm run db:model-sql (see docs/BACKEND_STACK.md §5.7).");
  }
  const document = modelDocument(row);
  const hash = modelHash(document);
  if (row.model_hash !== hash) {
    throw new ValuationServiceError("MODEL_UNAVAILABLE", 503, `Model ${row.id} parameters do not match their stored hash; reload the seed.`);
  }
  return { params: parseValuationParams(document), status: row.status, modelHash: hash };
}

interface ClaimRow {
  id: string;
  metric_code: string;
  value_numeric: string | null;
  value_text: string | null;
  status: ClaimStatus;
  content_hash: string;
  created_at: Date;
}

/** Current claims: not superseded, with their latest verification status. */
export async function loadCurrentClaims(pool: Pool, projectId: string): Promise<ClaimRow[]> {
  const { rows } = await pool.query<ClaimRow>(
    `select c.id, c.metric_code, c.value_numeric::text as value_numeric, c.value_text, s.status::text as status,
            c.content_hash, c.created_at
       from evidence_claims c
       join evidence_claim_current_status s on s.claim_id = c.id
      where c.project_id = $1
        and not exists (select 1 from evidence_claims newer where newer.supersedes_claim_id = c.id)
      order by c.id`,
    [projectId],
  );
  return rows;
}

/**
 * M§4.9: demand from the project's latest FINALIZED round. Founder, team, and flagged identities
 * are excluded before computing (BACKEND_STACK §5.5). Null before the first round settles.
 */
export async function loadPriorRound(pool: Pool, projectId: string): Promise<{ roundId: string; prior: PriorRound } | null> {
  const round = await pool.query<{ id: string; target: string; implied: string }>(
    `select r.id, r.target_amount_micro_usd::text as target, v.round_implied_value::text as implied
       from rounds r
       join valuation_snapshots v on v.id = r.valuation_snapshot_id and v.calculated_at = r.valuation_calculated_at
      where r.project_id = $1 and r.status = 'FINALIZED' and v.round_implied_value is not null
      order by r.round_number desc
      limit 1`,
    [projectId],
  );
  const row = round.rows[0];
  if (!row) return null;
  const buyers = await pool.query<{ accepted: string }>(
    `select sum(s.accepted_amount_micro_usd)::text as accepted
       from subscriptions s
       join identities i on i.id = s.identity_id
      where s.round_id = $1 and s.status = 'FINALIZED' and i.risk_flags = '[]'::jsonb
        and s.identity_id not in (select founder_identity_id from projects where id = $2
                                  union select identity_id from project_members where project_id = $2)
      group by s.identity_id
      order by s.identity_id`,
    [row.id, projectId],
  );
  const allocations = buyers.rows.map((buyer) => BigInt(buyer.accepted));
  return {
    roundId: row.id,
    prior: {
      round_implied_value: row.implied,
      accepted_micro_usd: allocations.reduce((sum, a) => sum + a, 0n),
      target_micro_usd: BigInt(row.target),
      buyer_allocations_micro_usd: allocations,
    },
  };
}

/** BACKEND_STACK §14: sha256 of the canonical JSON array of sorted claim content hashes. */
export function evidenceRoot(contentHashes: string[]): string {
  return sha256(JSON.stringify([...contentHashes].sort()));
}

export interface ValuationPreview {
  modelVersion: { id: string; status: LoadedModel["status"] };
  modelHash: string;
  evidenceRoot: string;
  stage: Valuation["stage"];
  scores: { execution: number; market: number; product: number; traction: number; economics: number; composite: number };
  values: {
    currentOperating: string;
    fundamentalScenario: string;
    modelReference: string;
    demandMultiplier: number;
    roundImplied: string;
    unitPrice: string;
    unitPriceMicroUsd: string;
  };
  explanationInputs: {
    demand: Valuation["demand"];
    priorRound: Record<string, unknown> | null;
    scenarios: Valuation["scenarios"];
    alpha: number;
    operating: Valuation["operating"];
    subfactors: Valuation["scores"]["subfactors"];
    categories: Valuation["scores"]["categories"];
    claimCount: number;
  };
  snapshot: { id: string; valuationRunId: string; calculatedAt: string; reused: boolean };
}

const microToUsd = (micro: string) => {
  const padded = micro.padStart(7, "0");
  return `${padded.slice(0, -6)}.${padded.slice(-6)}`;
};

/**
 * Computes the project's valuation from its current claims and the latest finalized round's demand,
 * and records snapshots (M§9.3). Before any round settles the demand multiplier is 1 (BACKEND_STACK §5.5).
 */
export async function previewValuation(pool: Pool, projectId: string): Promise<ValuationPreview> {
  const project = await pool.query<{ stage: Stage }>(`select stage::text as stage from projects where id = $1`, [projectId]);
  const declared = project.rows[0]?.stage;
  if (!declared || !(STAGES as readonly string[]).includes(declared)) throw new ValuationServiceError("NOT_FOUND", 404, "Project not found.");

  const model = await loadModel(pool);
  const rows = await loadCurrentClaims(pool, projectId);
  const claims: ScoringClaim[] = rows.map(({ content_hash: _hash, ...claim }) => claim);
  const prior = await loadPriorRound(pool, projectId);
  const valuation = computeValuation(model.params, { declared_stage: declared, claims, prior_round: prior?.prior ?? null });
  const priorSummary = prior
    ? {
        round_id: prior.roundId,
        round_implied_value: prior.prior.round_implied_value,
        accepted_micro_usd: String(prior.prior.accepted_micro_usd),
        target_micro_usd: String(prior.prior.target_micro_usd),
        eligible_buyers: prior.prior.buyer_allocations_micro_usd.length,
      }
    : null;

  const root = evidenceRoot(rows.map((row) => row.content_hash));
  const inputHash = sha256(
    canonicalJson({
      model_hash: model.modelHash,
      declared_stage: declared,
      claims: rows.map((row) => [row.id, row.status, row.content_hash]),
      prior_round: priorSummary,
    }),
  );

  const scores = {
    execution: valuation.scores.categories.execution.score,
    market: valuation.scores.categories.market.score,
    product: valuation.scores.categories.product.score,
    traction: valuation.scores.categories.traction.score,
    economics: valuation.scores.categories.economics.score,
    composite: valuation.scores.composite,
  };
  const explanationInputs = {
    demand: valuation.demand,
    priorRound: priorSummary,
    scenarios: valuation.scenarios,
    alpha: valuation.alpha,
    operating: valuation.operating,
    subfactors: valuation.scores.subfactors,
    categories: valuation.scores.categories,
    claimCount: rows.length,
  };

  const snapshot = await recordSnapshot(pool, { projectId, model, valuation, scores, explanationInputs, inputHash, evidenceRoot: root, prior: priorSummary });
  return {
    modelVersion: { id: model.params.id, status: model.status },
    modelHash: model.modelHash,
    evidenceRoot: root,
    stage: valuation.stage,
    scores,
    values: {
      currentOperating: valuation.values.current_operating,
      fundamentalScenario: valuation.values.fundamental_scenario,
      modelReference: valuation.values.model_reference,
      demandMultiplier: valuation.demand.multiplier,
      roundImplied: valuation.values.round_implied,
      unitPrice: microToUsd(valuation.unit_price_micro_usd),
      unitPriceMicroUsd: valuation.unit_price_micro_usd,
    },
    explanationInputs,
    snapshot,
  };
}

async function recordSnapshot(
  pool: Pool,
  input: {
    projectId: string;
    model: LoadedModel;
    valuation: Valuation;
    scores: ValuationPreview["scores"];
    explanationInputs: ValuationPreview["explanationInputs"];
    inputHash: string;
    evidenceRoot: string;
    prior: { round_id: string } | null;
  },
): Promise<ValuationPreview["snapshot"]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Serialize previews per project so two clicks cannot record the same inputs twice.
    await client.query(`select pg_advisory_xact_lock(hashtext('valuation:' || $1))`, [input.projectId]);
    const latest = await client.query<{ id: string; valuation_run_id: string; calculated_at: Date; input_hash: string }>(
      `select id, valuation_run_id, calculated_at, input_hash from valuation_snapshots
        where project_id = $1 order by calculated_at desc limit 1`,
      [input.projectId],
    );
    if (latest.rows[0]?.input_hash === input.inputHash) {
      await client.query("commit");
      const row = latest.rows[0];
      return { id: row.id, valuationRunId: row.valuation_run_id, calculatedAt: row.calculated_at.toISOString(), reused: true };
    }

    const { valuation, scores } = input;
    const runId = randomUUID();
    const score7 = (value: number) => value.toFixed(7);
    await client.query(
      `insert into score_snapshots
         (valuation_run_id, project_id, model_version_id, effective_stage, execution_score, market_score, product_score,
          traction_score, economics_score, composite_score, input_hash, factor_contributions)
       values ($1, $2, $3, $4::project_stage, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        runId,
        input.projectId,
        valuation.model_version_id,
        valuation.stage.effective,
        score7(scores.execution),
        score7(scores.market),
        score7(scores.product),
        score7(scores.traction),
        score7(scores.economics),
        score7(scores.composite),
        input.inputHash,
        JSON.stringify({ categories: valuation.scores.categories, subfactors: valuation.scores.subfactors }),
      ],
    );
    const inserted = await client.query<{ id: string; calculated_at: Date }>(
      `insert into valuation_snapshots
         (valuation_run_id, project_id, model_version_id, model_hash, declared_stage, effective_stage,
          current_operating_value, scenario_value, model_reference_value, demand_score, demand_multiplier,
          round_implied_value, reference_units, unit_price_micro_usd, scenario_details, assumptions, input_hash, evidence_root,
          prior_round_id)
       values ($1, $2, $3, $4, $5::project_stage, $6::project_stage, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       returning id, calculated_at`,
      [
        runId,
        input.projectId,
        valuation.model_version_id,
        input.model.modelHash,
        valuation.stage.declared,
        valuation.stage.effective,
        valuation.values.current_operating,
        valuation.values.fundamental_scenario,
        valuation.values.model_reference,
        valuation.demand.score,
        valuation.demand.multiplier,
        valuation.values.round_implied,
        valuation.reference_units,
        valuation.unit_price_micro_usd,
        JSON.stringify(valuation.scenarios),
        JSON.stringify({
          model_status: input.model.status,
          alpha: valuation.alpha,
          operating: valuation.operating,
          demand: valuation.demand,
          stage: valuation.stage,
          prior_round: input.prior,
          notes: ["current_net_cash = 0: no net-cash metric yet", "default_sector envelopes: no per-sector parameters yet"],
        }),
        input.inputHash,
        input.evidenceRoot,
        input.prior?.round_id ?? null,
      ],
    );
    await client.query("commit");
    const row = inserted.rows[0];
    return { id: row.id, valuationRunId: runId, calculatedAt: row.calculated_at.toISOString(), reused: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
