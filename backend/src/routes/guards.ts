import type { Context } from "hono";

/**
 * BACKEND_STACK §7: non-GET requests must come from PUBLIC_ORIGIN. Session cookies ride along on
 * cross-site requests, so this is the CSRF control for routes outside Better Auth.
 */
export function rejectForeignOrigin(context: Context, publicOrigin: string): Response | null {
  if (context.req.header("origin") === new URL(publicOrigin).origin) return null;
  return context.json({ error: { code: "INVALID_ORIGIN", message: "Requests must come from the Prospecto site." } }, 403);
}
