import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, EncryptionKeyError, generateToken, hashPassword, verifyPassword } from "../src/lib/crypto";

const KEY = "c21hcnRmbGlnaHRlci10ZXN0LWtleS0zMmJ5dGVzISE=";
const OTHER_KEY = "YW5vdGhlci1rZXktdGhhdC1pcy0zMi1ieXRlcy1sbmc=";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("salts each hash, so identical passwords store differently", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    // ...but both still verify.
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("stores a self-describing format that records the iteration count", async () => {
    const [algo, iterations, salt, hash] = (await hashPassword("x")).split("$");
    expect(algo).toBe("pbkdf2");
    expect(Number(iterations)).toBe(100_000);
    expect(salt).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // 32-byte derived key
  });

  it("rejects malformed stored hashes rather than throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "argon2$1$aa$bb")).toBe(false);
  });
});

describe("API key encryption", () => {
  it("round-trips a key", async () => {
    const encrypted = await encryptApiKey("serpapi-secret-key", KEY);
    expect(encrypted).not.toContain("serpapi-secret-key");
    expect(await decryptApiKey(encrypted, KEY)).toBe("serpapi-secret-key");
  });

  it("uses a fresh IV per call, so the same key encrypts differently each time", async () => {
    const a = await encryptApiKey("same-key", KEY);
    const b = await encryptApiKey("same-key", KEY);
    expect(a).not.toBe(b);
    expect(await decryptApiKey(a, KEY)).toBe("same-key");
    expect(await decryptApiKey(b, KEY)).toBe("same-key");
  });

  it("fails loudly when the encryption key changed since it was saved", async () => {
    const encrypted = await encryptApiKey("serpapi-secret-key", KEY);
    await expect(decryptApiKey(encrypted, OTHER_KEY)).rejects.toThrow(EncryptionKeyError);
  });

  it("rejects a missing or wrong-sized encryption key", async () => {
    await expect(encryptApiKey("k", "")).rejects.toThrow(EncryptionKeyError);
    await expect(encryptApiKey("k", btoa("too-short"))).rejects.toThrow(EncryptionKeyError);
  });
});

describe("session tokens", () => {
  it("generates unique URL-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
