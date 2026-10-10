import { createHash } from "node:crypto";

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PoolClient } from "pg";

import { canonicalJson } from "../valuation/model-value.js";

const fail = (code: string, message: string, status: 400 | 409) =>
  new HTTPException(status, { res: Response.json({ error: { code, message } }, { status }) });

/** BACKEND_STACK §7: every non-auth POST carries an Idempotency-Key of 8–128 characters. */
export function requireIdempotencyKey(context: Context): string {
  const key = context.req.header("idempotency-key");
  if (!key || key.length < 8 || key.length > 128) throw fail("MISSING_IDEMPOTENCY_KEY", "Send an Idempotency-Key header (8–128 characters).", 400);
  return key;
}

export type IdempotentResult = { status: 200 | 201; body: object };

/**
 * Runs `work` inside the caller's open transaction at most once per (identity, operation, key).
 * Same key + same body replays the stored response; same key + different body is
 * IDEMPOTENCY_CONFLICT (M§11.2). The caller commits; on error the key is rolled back with the work.
 */
export async function onceForKey(
  client: PoolClient,
  scope: { identityId: string; operation: string; key: string; body: unknown },
  work: () => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  const requestHash = createHash("sha256").update(canonicalJson(scope.body)).digest("hex");
  const claimed = await client.query(
    `insert into idempotency_keys (identity_id, operation, key, request_hash) values ($1, $2, $3, $4)
     on conflict do nothing returning key`,
    [scope.identityId, scope.operation, scope.key, requestHash],
  );
  if (claimed.rowCount === 0) {
    const prior = await client.query<{ request_hash: string; response_status: number | null; response_body: object }>(
      `select request_hash, response_status, response_body from idempotency_keys where identity_id = $1 and operation = $2 and key = $3`,
      [scope.identityId, scope.operation, scope.key],
    );
    const row = prior.rows[0];
    if (!row || row.request_hash !== requestHash) throw fail("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was used for a different request.", 409);
    if (row.response_status === null) throw fail("REQUEST_IN_PROGRESS", "The same request is still being processed.", 409);
    return { status: row.response_status as 200 | 201, body: row.response_body };
  }
  const result = await work();
  await client.query(
    `update idempotency_keys set response_status = $4, response_body = $5, completed_at = now()
      where identity_id = $1 and operation = $2 and key = $3`,
    [scope.identityId, scope.operation, scope.key, result.status, JSON.stringify(result.body)],
  );
  return result;
}
