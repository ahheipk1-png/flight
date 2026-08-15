/** Bearer-token sessions in D1. The Python reference kept these in Redis
 * with a native TTL; D1 has no TTL, so expiry is enforced by comparing
 * expires_at on every lookup (correctness) and swept by a daily cron
 * (housekeeping only -- a missed sweep can never authenticate a stale
 * token, it just leaves dead rows around). */

import { generateToken } from "./crypto";
import type { UserRow } from "./db";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Fixed lifetime from creation, not sliding -- matches the reference's
 * Redis TTL, and keeps the hot search path read-only against this table. */
export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await db
    .prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, now.toISOString(), expiresAt.toISOString())
    .run();
  return token;
}

/** Resolves a token straight to its user in one round trip, ignoring
 * expired rows. Returns null for unknown, expired, or orphaned tokens. */
export async function getSessionUser(db: D1Database, token: string): Promise<UserRow | null> {
  return db
    .prepare(
      "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id " +
        "WHERE sessions.token = ? AND sessions.expires_at > ?",
    )
    .bind(token, new Date().toISOString())
    .first<UserRow>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

/** Used when an admin disables/denies an account, so existing sessions
 * don't keep working until they expire on their own. */
export async function deleteSessionsForUser(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function sweepExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
}
