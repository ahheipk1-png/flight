import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";

// TEST_MIGRATIONS is a miniflare-only binding injected by
// vitest.config.mts, so it isn't part of the wrangler-generated Env type.
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

// Each test file gets its own isolated D1; apply the real migrations to it
// before anything runs.
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
