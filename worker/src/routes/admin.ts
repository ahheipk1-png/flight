/** Account review. Ported from backend/app/api/routes_admin.py.
 * Every route here sits behind requireUser + requireAdmin (wired in
 * index.ts), so these handlers can assume an admin caller. */

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { encryptApiKey, hashPassword } from "../lib/crypto";
import { findUserById, hasApiKey, isAdmin, type UserRow } from "../lib/db";
import { recentSearches } from "../lib/searchLog";
import { deleteSessionsForUser } from "../lib/sessions";
import { authError } from "../middleware/auth";
import type { AppEnv } from "../types";

const setPasswordSchema = z.object({
  new_password: z.string().min(8).max(64),
});

const setApiKeySchema = z.object({
  serpapi_api_key: z.string().min(1).max(200),
});

type AccountRow = UserRow & { search_count: number };

function accountOut(user: AccountRow) {
  return {
    id: user.id,
    username: user.username,
    status: user.status,
    is_admin: isAdmin(user),
    has_api_key: hasApiKey(user),
    created_at: user.created_at,
    decided_at: user.decided_at,
    // Paid SerpApi calls within the log's retention window (90 days) --
    // one UI search fans out into several of these.
    search_count: user.search_count,
  };
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get("/accounts", async (c) => {
  // Pending first (that's the queue an admin is here to clear), then
  // newest first within each group.
  const { results } = await c.env.DB.prepare(
    "SELECT users.*, COUNT(search_log.id) AS search_count FROM users " +
      "LEFT JOIN search_log ON search_log.user_id = users.id " +
      "GROUP BY users.id " +
      "ORDER BY CASE users.status WHEN 'pending' THEN 0 ELSE 1 END, users.created_at DESC",
  ).all<AccountRow>();
  return c.json(results.map(accountOut));
});

adminRoutes.get("/accounts/:id/searches", async (c) => {
  const id = Number(c.req.param("id"));
  const target = await findUserById(c.env.DB, id);
  if (!target) return c.json(authError("No such account."), 404);
  return c.json(await recentSearches(c.env.DB, id));
});

/** approve/deny/disable differ only in the status they set, and whether
 * existing sessions get revoked. */
function decisionRoute(status: "approved" | "denied" | "disabled") {
  return async (c: Context<AppEnv>) => {
    const id = Number(c.req.param("id"));
    const target = await findUserById(c.env.DB, id);
    if (!target) return c.json(authError("No such account."), 404);

    await c.env.DB.prepare("UPDATE users SET status = ?, decided_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), id)
      .run();

    // Revoking access has to take effect now, not whenever their session
    // happens to expire.
    if (status !== "approved") await deleteSessionsForUser(c.env.DB, id);

    return c.json({ ok: true });
  };
}

adminRoutes.post("/accounts/:id/approve", decisionRoute("approved"));
adminRoutes.post("/accounts/:id/deny", decisionRoute("denied"));
adminRoutes.post("/accounts/:id/disable", decisionRoute("disabled"));

/** Admin override of a user's stored SerpApi key -- e.g. to fix a key a
 * friend pasted wrong, or to lend them access. Same encryption path as
 * the self-service route; the plaintext never lands anywhere. */
adminRoutes.post("/accounts/:id/set-api-key", zValidator("json", setApiKeySchema), async (c) => {
  const id = Number(c.req.param("id"));
  const target = await findUserById(c.env.DB, id);
  if (!target) return c.json(authError("No such account."), 404);

  const encrypted = await encryptApiKey(c.req.valid("json").serpapi_api_key, c.env.API_KEY_ENCRYPTION_KEY);
  await c.env.DB.prepare("UPDATE users SET serpapi_api_key_encrypted = ? WHERE id = ?").bind(encrypted, id).run();
  return c.json({ ok: true });
});

adminRoutes.delete("/accounts/:id/api-key", async (c) => {
  const id = Number(c.req.param("id"));
  const target = await findUserById(c.env.DB, id);
  if (!target) return c.json(authError("No such account."), 404);

  await c.env.DB.prepare("UPDATE users SET serpapi_api_key_encrypted = NULL WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

adminRoutes.post("/accounts/:id/set-password", zValidator("json", setPasswordSchema), async (c) => {
  const id = Number(c.req.param("id"));
  const target = await findUserById(c.env.DB, id);
  if (!target) return c.json(authError("No such account."), 404);

  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(await hashPassword(c.req.valid("json").new_password), id)
    .run();
  // Force a re-login with the new password everywhere.
  await deleteSessionsForUser(c.env.DB, id);

  return c.json({ ok: true });
});
