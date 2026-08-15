/**
 * Creates (or promotes) an approved admin account. There is deliberately
 * no in-app path to do this: registration always produces a 'pending'
 * account, and only an admin can approve one, so the first admin has to
 * come from outside -- mirroring the Python reference's `cli make-admin`
 * and its explicit "no hardcoded default admin" stance.
 *
 * Imports hashPassword from the Worker's own src/lib/crypto.ts (pure Web
 * Crypto, so it runs unmodified under Node >= 19) -- which guarantees the
 * hash written here is exactly what the Worker's verifyPassword expects.
 *
 * Usage:
 *   node scripts/make-admin.mjs <username> [--local]
 *   node scripts/make-admin.mjs <username> --password-stdin < password.txt
 *
 * Prompts for the password (hidden) by default; never takes it as an
 * argument, so it can't end up in shell history. --password-stdin reads
 * it from stdin instead, for non-interactive/automated use.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { hashPassword } from "../src/lib/crypto.ts";

const username = process.argv[2]?.trim().toLowerCase();
const isLocal = process.argv.includes("--local");
const fromStdin = process.argv.includes("--password-stdin");

if (!username) {
  console.error("Usage: node scripts/make-admin.mjs <username> [--local] [--password-stdin]");
  process.exit(1);
}
if (username.length < 3 || username.length > 16) {
  console.error("Username must be 3-16 characters.");
  process.exit(1);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo while typing the password.
    const onData = (char) => {
      if (["\n", "\r", ""].includes(char.toString())) process.stdin.removeListener("data", onData);
      else process.stdout.write("\x1b[2K\x1b[200D" + question + "*".repeat(rl.line.length));
    };
    process.stdin.on("data", onData);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

let password;
if (fromStdin) {
  password = await readStdin();
} else {
  password = await promptHidden("Password (8+ chars): ");
  const confirm = await promptHidden("Confirm password: ");
  if (password !== confirm) {
    console.error("Passwords did not match.");
    process.exit(1);
  }
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const now = new Date().toISOString();

// ON CONFLICT so re-running promotes/repairs an existing account rather
// than failing -- same behavior as the reference's make-admin.
const sql = `
INSERT INTO users (username, password_hash, status, is_admin, created_at, decided_at)
VALUES ('${username}', '${passwordHash}', 'approved', 1, '${now}', '${now}')
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  status = 'approved',
  is_admin = 1,
  decided_at = excluded.decided_at;
`;

// Written to a temp file rather than passed with --command: the hash
// contains '$' characters that a shell would try to expand.
const dir = mkdtempSync(join(tmpdir(), "smartflighter-admin-"));
const sqlPath = join(dir, "make-admin.sql");
try {
  writeFileSync(sqlPath, sql, "utf8");
  const args = ["wrangler", "d1", "execute", "smartflighter-db", isLocal ? "--local" : "--remote", "--file", sqlPath, "-y"];
  // npx.cmd directly rather than shell:true -- shell mode concatenates
  // args unescaped, which Node now warns about.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`\nAdmin account ready: ${username} (${isLocal ? "local" : "remote"} database)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
