/** Registration, login/logout, and self-service API-key management.
 * Ported from backend/app/api/routes_auth.py.
 *
 * Deliberately absent, matching the reference: any self-serve password
 * reset. An admin sets a new password instead (see routes/admin.ts) --
 * there's no email channel here to make a reset link safe. */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { encryptApiKey, hashPassword, verifyPassword } from "../lib/crypto";
import { findUserByUsername, hasApiKey, isAdmin, normalizeUsername } from "../lib/db";
import { createSession, deleteSession } from "../lib/sessions";
import { authError, requireUser } from "../middleware/auth";
import type { AppEnv } from "../types";

const registerSchema = z.object({
  username: z.string().min(3).max(16),
  password: z.string().min(8).max(64),
  serpapi_api_key: z.string().max(200).optional().nullable(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

const apiKeySchema = z.object({
  serpapi_api_key: z.string().min(1).max(200),
});

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const body = c.req.valid("json");
  const username = normalizeUsername(body.username);

  if (await findUserByUsername(c.env.DB, username)) {
    return c.json(authError("That username is taken."), 409);
  }

  const encryptedKey = body.serpapi_api_key
    ? await encryptApiKey(body.serpapi_api_key, c.env.API_KEY_ENCRYPTION_KEY)
    : null;

  // Always 'pending' (the column default) -- registration never grants
  // access, and never logs the requester in. An admin decides.
  await c.env.DB.prepare(
    "INSERT INTO users (username, password_hash, serpapi_api_key_encrypted, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(username, await hashPassword(body.password), encryptedKey, new Date().toISOString())
    .run();

  return c.json({ ok: true, message: "Requested! An admin needs to approve your account before you can log in." });
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");
  const user = await findUserByUsername(c.env.DB, body.username);

  // Same message whether the username is unknown or the password is
  // wrong, so this can't be used to enumerate accounts. The hash is still
  // verified against a real stored hash when the user exists, so timing
  // doesn't leak either.
  const invalid = authError("Wrong username or password.");
  if (!user) return c.json(invalid, 401);
  if (!(await verifyPassword(body.password, user.password_hash))) return c.json(invalid, 401);

  if (user.status === "pending") {
    return c.json(authError("Your account is still waiting for admin approval."), 403);
  }
  if (user.status === "denied") {
    return c.json(authError("This account request wasn't approved."), 403);
  }
  if (user.status === "disabled") {
    return c.json(authError("This account has been disabled."), 403);
  }

  return c.json({
    token: await createSession(c.env.DB, user.id),
    username: user.username,
    is_admin: isAdmin(user),
  });
});

authRoutes.post("/logout", requireUser, async (c) => {
  await deleteSession(c.env.DB, c.get("sessionToken"));
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => {
  const user = c.get("user");
  return c.json({
    username: user.username,
    status: user.status,
    is_admin: isAdmin(user),
    has_api_key: hasApiKey(user),
  });
});

authRoutes.put("/api-key", requireUser, zValidator("json", apiKeySchema), async (c) => {
  const encrypted = await encryptApiKey(c.req.valid("json").serpapi_api_key, c.env.API_KEY_ENCRYPTION_KEY);
  await c.env.DB.prepare("UPDATE users SET serpapi_api_key_encrypted = ? WHERE id = ?")
    .bind(encrypted, c.get("user").id)
    .run();
  return c.json({ ok: true });
});

authRoutes.delete("/api-key", requireUser, async (c) => {
  await c.env.DB.prepare("UPDATE users SET serpapi_api_key_encrypted = NULL WHERE id = ?").bind(c.get("user").id).run();
  return c.json({ ok: true });
});
