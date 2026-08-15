/**
 * Password hashing and API-key encryption, using only Web Crypto (the
 * Workers runtime has no argon2/Fernet, which the Python reference used).
 *
 * Two deliberately different primitives, for the same reason as the
 * reference: a password must be UNRECOVERABLE (one-way hash), while the
 * SerpApi key must be RECOVERABLE (the search path needs the real key
 * back), so it gets symmetric encryption instead.
 *
 * This file uses only standard Web Crypto, so it runs unmodified both
 * inside the Worker and under plain Node (>=19) -- scripts/make-admin.mjs
 * imports it directly, which guarantees a hash it writes is byte-for-byte
 * what the Worker's verifyPassword() expects.
 */

// workerd rejects PBKDF2 above exactly 100_000 iterations with
// NotSupportedError, so this is the platform ceiling, not a tuning
// choice. It is below OWASP's current PBKDF2-SHA256 guidance (600k);
// unavoidable here short of shipping a memory-hard WASM hash, which
// would cost more CPU per login and risks the free plan's 10ms/request
// budget. Acceptable for this app's threat model (a small approved
// friend list, no payment data). The stored format records the count, so
// this can be lowered/raised later without invalidating existing hashes.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;
const AES_IV_BYTES = 12; // 96-bit, the AES-GCM standard

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Length-independent, content-constant-time comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deriveHash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    DERIVED_BITS,
  );
  return toHex(new Uint8Array(bits));
}

/** Returns "pbkdf2$<iterations>$<salt hex>$<hash hex>" -- self-describing
 * like argon2's own format, so the iteration count can change later
 * without invalidating already-stored hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltHex, hashHex] = stored.split("$");
  if (algo !== "pbkdf2" || !iterStr || !saltHex || !hashHex) return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const candidate = await deriveHash(password, fromHex(saltHex), iterations);
  return timingSafeEqual(candidate, hashHex);
}

export class EncryptionKeyError extends Error {}

async function importAesKey(base64Key: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (!base64Key) {
    throw new EncryptionKeyError(
      "API_KEY_ENCRYPTION_KEY is not set -- generate one with `openssl rand -base64 32` " +
        "and set it with `wrangler secret put API_KEY_ENCRYPTION_KEY`",
    );
  }
  let raw: Uint8Array;
  try {
    raw = fromBase64(base64Key);
  } catch {
    throw new EncryptionKeyError("API_KEY_ENCRYPTION_KEY is not valid base64");
  }
  if (raw.length !== 32) {
    throw new EncryptionKeyError(`API_KEY_ENCRYPTION_KEY must decode to 32 bytes (got ${raw.length})`);
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [usage]);
}

/** Returns "<iv base64>.<ciphertext base64>". A fresh IV every call --
 * reusing one under the same key would break AES-GCM's guarantees. */
export async function encryptApiKey(rawKey: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, encoder.encode(rawKey));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`;
}

export async function decryptApiKey(stored: string, base64Key: string): Promise<string> {
  const key = await importAesKey(base64Key, "decrypt");
  const [ivB64, ctB64] = stored.split(".");
  if (!ivB64 || !ctB64) throw new EncryptionKeyError("Stored API key is malformed");
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivB64) as BufferSource },
      key,
      fromBase64(ctB64) as BufferSource,
    );
    return decoder.decode(pt);
  } catch {
    // GCM's auth tag failing means either tampering or -- far more
    // likely here -- the encryption key changed since this was saved.
    throw new EncryptionKeyError(
      "Stored API key could not be decrypted -- API_KEY_ENCRYPTION_KEY may have changed since it was saved",
    );
  }
}

/** URL-safe random token, the equivalent of Python's secrets.token_urlsafe(32). */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
