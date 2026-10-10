import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";

import type { ProspectoAuth } from "./better-auth.js";
import { campusEmailHash, isCampusEmail } from "./campus-email.js";

export interface IdentityDependencies {
  pool: Pool;
  auth: ProspectoAuth;
  emailHashPepper: string;
  campusDomains: readonly string[];
}

export interface SessionIdentity {
  identityId: string;
}

/**
 * Creates the identity row on the first authenticated request (Better Auth after-hooks run
 * post-commit and can be lost), so this is idempotent and safe to call on every request.
 */
export async function ensureIdentity(
  pool: Pool,
  user: { id: string; email: string; emailVerified: boolean },
  emailHashPepper: string,
): Promise<SessionIdentity> {
  const result = await pool.query<{ id: string }>(
    `insert into identities (auth_user_id, campus_email_hash, verification_status, verified_at)
     values ($1, $2, 'VERIFIED', now())
     on conflict (auth_user_id) do update set auth_user_id = excluded.auth_user_id
     returning id`,
    [user.id, campusEmailHash(user.email, emailHashPepper)],
  );
  const row = result.rows[0];
  if (!row) throw new Error("identity upsert returned no row");
  return { identityId: row.id };
}

/** Resolves the caller's verified campus identity, or rejects with 401/403. */
export async function requireIdentity(
  context: Context,
  { pool, auth, emailHashPepper, campusDomains }: IdentityDependencies,
): Promise<SessionIdentity> {
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    throw new HTTPException(401, { res: Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }) });
  }
  // Defense in depth: every sign-in path already enforces both, but identities must never be
  // minted for an unverified or non-campus address.
  if (!session.user.emailVerified || !isCampusEmail(session.user.email, campusDomains)) {
    throw new HTTPException(403, { res: Response.json({ error: { code: "CAMPUS_EMAIL_REQUIRED" } }, { status: 403 }) });
  }
  return ensureIdentity(pool, session.user, emailHashPepper);
}
