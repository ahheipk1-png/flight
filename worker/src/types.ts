import type { UserRow } from "./lib/db";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  /** 32 bytes, base64. Set via `wrangler secret put`, never in wrangler.toml. */
  API_KEY_ENCRYPTION_KEY: string;
}

export interface Variables {
  user: UserRow;
  /** The decrypted SerpApi key -- only set by requireApprovedWithKey, only
   * lives for the duration of one request, never returned to the client. */
  apiKey: string;
  sessionToken: string;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
