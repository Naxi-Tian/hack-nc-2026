import { Hono } from "hono";

import { requireIdentity, type IdentityDependencies } from "../auth/identity.js";

/**
 * Better Auth owns /api/auth/* (campus email codes, sessions, sign-out):
 *   POST /api/auth/email-otp/send-verification-otp  { email, type: "sign-in" }
 *   POST /api/auth/sign-in/email-otp                { email, otp }
 *   GET  /api/auth/get-session, POST /api/auth/sign-out
 * GET /api/me adds the Prospecto identity on top of the session.
 */
export function createAuthRouter(dependencies: IdentityDependencies): Hono {
  const router = new Hono();

  router.all("/auth/*", (context) => dependencies.auth.handler(context.req.raw));

  router.get("/me", async (context) => {
    const { identityId } = await requireIdentity(context, dependencies);
    const wallets = await dependencies.pool.query<{ address: string; is_primary: boolean }>(
      `select address, is_primary
         from wallets
        where identity_id = $1 and revoked_at is null
        order by created_at`,
      [identityId],
    );
    return context.json({
      identityId,
      verified: true,
      wallets: wallets.rows.map((wallet) => ({ address: wallet.address, isPrimary: wallet.is_primary })),
    });
  });

  return router;
}
