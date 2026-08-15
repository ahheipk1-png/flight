/** The three gates, ported 1:1 from the Python reference's FastAPI
 * dependencies (backend/app/api/deps.py): get_current_user,
 * get_current_admin, and get_search_provider. Same order, same status
 * codes, same user-facing messages.
 *
 * Every failure carries `source: "auth"` so the frontend can tell a
 * gating rejection apart from a genuine SerpApi failure -- both otherwise
 * surface as {"error": ...} and would be indistinguishable.
 */

import type { MiddlewareHandler } from "hono";
import { decryptApiKey, EncryptionKeyError } from "../lib/crypto";
import { getSessionUser } from "../lib/sessions";
import { hasApiKey, isAdmin } from "../lib/db";
import type { AppEnv } from "../types";

export function authError(message: string) {
  return { error: message, source: "auth" as const };
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c.req.header("Authorization"));
  if (!token) {
    return c.json(authError("Log in to continue."), 401);
  }
  const user = await getSessionUser(c.env.DB, token);
  if (!user) {
    return c.json(authError("Session expired or invalid -- please log in again."), 401);
  }
  c.set("user", user);
  c.set("sessionToken", token);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAdmin(c.get("user"))) {
    return c.json(authError("Admin access required."), 403);
  }
  await next();
};

/** The search gate. No fallback: every search runs on the caller's OWN
 * stored key, never a site-wide one -- which is the entire point of the
 * accounts system, so each gate fails loudly rather than degrading. */
export const requireApprovedWithKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (user.status !== "approved") {
    return c.json(
      authError("Your account is not approved yet -- an admin needs to approve it before you can search."),
      403,
    );
  }
  if (!hasApiKey(user)) {
    return c.json(
      authError("Add your own SerpApi key in Settings before searching -- there's no shared/default key."),
      400,
    );
  }
  try {
    c.set("apiKey", await decryptApiKey(user.serpapi_api_key_encrypted!, c.env.API_KEY_ENCRYPTION_KEY));
  } catch (err) {
    if (err instanceof EncryptionKeyError) return c.json(authError(err.message), 500);
    throw err;
  }
  await next();
};
