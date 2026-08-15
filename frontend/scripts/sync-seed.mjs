// Copies the repo's canonical seed data (data/seed/) into the engine's
// bundled copies (src/lib/engine/seed/). data/seed/ stays the single
// source of truth shared with the Python backend; the copies are
// committed so tsc/vitest work without running this, and this script
// (wired to npm predev/prebuild) keeps them from drifting.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "data", "seed");
const target = join(here, "..", "src", "lib", "engine", "seed");

mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (name.endsWith(".json")) copyFileSync(join(source, name), join(target, name));
}
console.log(`sync-seed: copied seed JSON from ${source}`);
