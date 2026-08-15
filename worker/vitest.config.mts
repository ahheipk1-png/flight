import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Applied to each test file's isolated D1 instance by test/setup.ts, so
// tests run against the REAL migrations -- no separate test schema to
// drift out of sync.
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Test-only 32-byte base64 key; the real one is a Worker secret
          // and never appears in the repo.
          API_KEY_ENCRYPTION_KEY: "c21hcnRmbGlnaHRlci10ZXN0LWtleS0zMmJ5dGVzISE=",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
