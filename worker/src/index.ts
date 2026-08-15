/**
 * SmartFlighter's Worker: the app's only server.
 *
 * Two jobs:
 *   1. Accounts (D1) -- registration, admin approval, sessions, and each
 *      user's own encrypted SerpApi key. See routes/{auth,admin}.ts.
 *   2. The SerpApi proxy -- SerpApi blocks browser CORS by design, so
 *      searches route through here, where the caller's own stored key is
 *      attached server-side. See routes/search.ts.
 *
 * Everything else (the actual flight-search pipeline) runs client-side in
 * the browser -- see frontend/src/lib/engine/.
 */

import { Hono } from "hono";
import { cors } from "./middleware/cors";
import { requireAdmin, requireApprovedWithKey, requireUser } from "./middleware/auth";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { searchRoutes } from "./routes/search";
import { sweepOldSearchLogs } from "./lib/searchLog";
import { sweepExpiredSessions } from "./lib/sessions";
import type { AppEnv, Env } from "./types";

const app = new Hono<AppEnv>();

app.use("*", cors);

app.route("/api/auth", authRoutes);
app.use("/api/admin/*", requireUser, requireAdmin);
app.route("/api/admin", adminRoutes);
app.use("/search", requireUser, requireApprovedWithKey);
app.route("/search", searchRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,

  /** Housekeeping only -- session expiry is enforced on every lookup, so
   * a missed run can never authenticate a stale token; the search-log
   * sweep just bounds the table to its 90-day retention window. */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await sweepExpiredSessions(env.DB);
    await sweepOldSearchLogs(env.DB);
  },
};
