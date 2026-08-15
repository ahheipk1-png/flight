/** The gating matrix, ported case-by-case from the Python reference's
 * backend/tests/unit/test_auth_gating.py -- same scenarios, same expected
 * status codes, now against the D1/Hono implementation. */

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { hashPassword } from "../src/lib/crypto";

const ORIGIN = "http://localhost:3000";

function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", ORIGIN);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return app.fetch(new Request(`https://worker.test${path}`, { ...init, headers }), env);
}

function authed(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return req(path, { ...init, headers });
}

async function register(username: string, password = "password123", apiKey?: string) {
  return req("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, serpapi_api_key: apiKey ?? null }),
  });
}

async function login(username: string, password = "password123") {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  return { res, body: (await res.json()) as { token?: string; error?: string } };
}

/** Seeds an admin directly, the way scripts/make-admin.mjs does -- there's
 * deliberately no in-app path to create the first one. */
async function seedAdmin(username = "admin", password = "adminpass123") {
  await env.DB.prepare(
    "INSERT INTO users (username, password_hash, status, is_admin, created_at) VALUES (?, ?, 'approved', 1, ?)",
  )
    .bind(username, await hashPassword(password), new Date().toISOString())
    .run();
  const { body } = await login(username, password);
  return body.token!;
}

async function userIdOf(username: string): Promise<number> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: number }>();
  return row!.id;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM search_log").run();
  await env.DB.prepare("DELETE FROM sessions").run();
  await env.DB.prepare("DELETE FROM users").run();
});

describe("CORS gate", () => {
  it("rejects a request with no Origin outright", async () => {
    const res = await app.fetch(new Request("https://worker.test/api/auth/me"), env);
    expect(res.status).toBe(403);
  });

  it("rejects a disallowed origin with a bare 403 and no CORS headers", async () => {
    const res = await app.fetch(
      new Request("https://worker.test/api/auth/me", { headers: { Origin: "https://evil.example" } }),
      env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers preflight for an allowed origin", async () => {
    const res = await req("/api/auth/login", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("authorization");
  });
});

describe("registration", () => {
  it("creates a pending account and does NOT log the requester in", async () => {
    const res = await register("alice");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body).not.toHaveProperty("token");

    const row = await env.DB.prepare("SELECT status, is_admin FROM users WHERE username = 'alice'").first<{
      status: string;
      is_admin: number;
    }>();
    expect(row?.status).toBe("pending");
    expect(row?.is_admin).toBe(0);
  });

  it("stores a supplied API key encrypted, not in plaintext", async () => {
    await register("bob", "password123", "my-serpapi-key");
    const row = await env.DB.prepare(
      "SELECT serpapi_api_key_encrypted FROM users WHERE username = 'bob'",
    ).first<{ serpapi_api_key_encrypted: string }>();
    expect(row?.serpapi_api_key_encrypted).toBeTruthy();
    expect(row?.serpapi_api_key_encrypted).not.toContain("my-serpapi-key");
  });

  it("normalizes usernames and rejects duplicates case-insensitively", async () => {
    await register("Carol");
    const row = await env.DB.prepare("SELECT username FROM users").first<{ username: string }>();
    expect(row?.username).toBe("carol");

    const dup = await register("  CAROL  ");
    expect(dup.status).toBe(409);
  });

  it("validates username and password lengths", async () => {
    expect((await register("ab")).status).toBe(400); // too short
    expect((await register("valid", "short")).status).toBe(400);
  });
});

describe("login", () => {
  it("refuses a pending account", async () => {
    await register("dave");
    const { res } = await login("dave");
    expect(res.status).toBe(403);
  });

  it("gives the same error for a wrong password and an unknown user", async () => {
    await register("erin");
    const wrongPassword = await login("erin", "not-the-password");
    const unknownUser = await login("nobody", "whatever");
    expect(wrongPassword.res.status).toBe(401);
    expect(unknownUser.res.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownUser.body.error);
  });

  it("succeeds once approved, and returns a working session token", async () => {
    const adminToken = await seedAdmin();
    await register("frank");
    await authed(`/api/admin/accounts/${await userIdOf("frank")}/approve`, adminToken, { method: "POST" });

    const { res, body } = await login("frank");
    expect(res.status).toBe(200);
    expect(body.token).toBeTruthy();

    const me = await authed("/api/auth/me", body.token!);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ username: "frank", status: "approved", is_admin: false });
  });

  it("refuses denied and disabled accounts", async () => {
    const adminToken = await seedAdmin();
    await register("greg");
    await register("hana");
    await authed(`/api/admin/accounts/${await userIdOf("greg")}/deny`, adminToken, { method: "POST" });
    await authed(`/api/admin/accounts/${await userIdOf("hana")}/disable`, adminToken, { method: "POST" });

    expect((await login("greg")).res.status).toBe(403);
    expect((await login("hana")).res.status).toBe(403);
  });
});

describe("sessions", () => {
  it("rejects missing, malformed, and unknown bearer tokens", async () => {
    expect((await req("/api/auth/me")).status).toBe(401);
    expect((await req("/api/auth/me", { headers: { Authorization: "Basic xyz" } })).status).toBe(401);
    expect((await authed("/api/auth/me", "not-a-real-token")).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const token = await seedAdmin();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), token)
      .run();
    expect((await authed("/api/auth/me", token)).status).toBe(401);
  });

  it("invalidates the token on logout", async () => {
    const token = await seedAdmin();
    expect((await authed("/api/auth/logout", token, { method: "POST" })).status).toBe(200);
    expect((await authed("/api/auth/me", token)).status).toBe(401);
  });

  it("revokes existing sessions when an account is disabled", async () => {
    const adminToken = await seedAdmin();
    await register("ivan");
    const ivanId = await userIdOf("ivan");
    await authed(`/api/admin/accounts/${ivanId}/approve`, adminToken, { method: "POST" });
    const ivanToken = (await login("ivan")).body.token!;
    expect((await authed("/api/auth/me", ivanToken)).status).toBe(200);

    await authed(`/api/admin/accounts/${ivanId}/disable`, adminToken, { method: "POST" });
    expect((await authed("/api/auth/me", ivanToken)).status).toBe(401);
  });
});

describe("admin routes", () => {
  it("refuses non-admins and anonymous callers", async () => {
    const adminToken = await seedAdmin();
    await register("jane");
    await authed(`/api/admin/accounts/${await userIdOf("jane")}/approve`, adminToken, { method: "POST" });
    const janeToken = (await login("jane")).body.token!;

    expect((await authed("/api/admin/accounts", janeToken)).status).toBe(403);
    expect((await req("/api/admin/accounts")).status).toBe(401);
  });

  it("lists accounts with pending first", async () => {
    const adminToken = await seedAdmin();
    await register("kyle");
    const res = await authed("/api/admin/accounts", adminToken);
    const accounts = (await res.json()) as { username: string; status: string; has_api_key: boolean }[];
    expect(accounts[0]).toMatchObject({ username: "kyle", status: "pending" });
    expect(accounts.some((a) => a.username === "admin" && a.status === "approved")).toBe(true);
    // The encrypted key itself must never be exposed, only whether one exists.
    expect(accounts[0]).not.toHaveProperty("serpapi_api_key_encrypted");
  });

  it("can set a password, which forces a re-login", async () => {
    const adminToken = await seedAdmin();
    await register("lily");
    const lilyId = await userIdOf("lily");
    await authed(`/api/admin/accounts/${lilyId}/approve`, adminToken, { method: "POST" });
    const oldToken = (await login("lily")).body.token!;

    const res = await authed(`/api/admin/accounts/${lilyId}/set-password`, adminToken, {
      method: "POST",
      body: JSON.stringify({ new_password: "brand-new-password" }),
    });
    expect(res.status).toBe(200);

    expect((await authed("/api/auth/me", oldToken)).status).toBe(401); // old session revoked
    expect((await login("lily", "password123")).res.status).toBe(401); // old password dead
    expect((await login("lily", "brand-new-password")).res.status).toBe(200);
  });

  it("404s on an unknown account id", async () => {
    const adminToken = await seedAdmin();
    expect((await authed("/api/admin/accounts/9999/approve", adminToken, { method: "POST" })).status).toBe(404);
  });
});

describe("api key management", () => {
  it("lets a user set and clear their own key", async () => {
    const adminToken = await seedAdmin();
    await register("mike");
    await authed(`/api/admin/accounts/${await userIdOf("mike")}/approve`, adminToken, { method: "POST" });
    const token = (await login("mike")).body.token!;

    expect(((await (await authed("/api/auth/me", token)).json()) as { has_api_key: boolean }).has_api_key).toBe(false);

    await authed("/api/auth/api-key", token, {
      method: "PUT",
      body: JSON.stringify({ serpapi_api_key: "the-key" }),
    });
    expect(((await (await authed("/api/auth/me", token)).json()) as { has_api_key: boolean }).has_api_key).toBe(true);

    await authed("/api/auth/api-key", token, { method: "DELETE" });
    expect(((await (await authed("/api/auth/me", token)).json()) as { has_api_key: boolean }).has_api_key).toBe(false);
  });
});

describe("/search gating", () => {
  const searchBody = JSON.stringify({ params: { engine: "google_flights", departure_id: "YYZ" } });

  async function approvedUser(username: string, withKey: boolean) {
    const adminToken = await seedAdmin(`admin-${username}`);
    await register(username, "password123", withKey ? "real-serpapi-key" : undefined);
    await authed(`/api/admin/accounts/${await userIdOf(username)}/approve`, adminToken, { method: "POST" });
    return (await login(username)).body.token!;
  }

  it("rejects an anonymous search", async () => {
    const res = await req("/search", { method: "POST", body: searchBody });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { source: string }).source).toBe("auth");
  });

  it("rejects a pending user even when they supplied a key", async () => {
    await seedAdmin();
    await register("nina", "password123", "real-serpapi-key");
    // Not approved -- but log in is impossible while pending, so assert
    // via a directly-created session that the search gate ALSO blocks it.
    const ninaId = await userIdOf("nina");
    await env.DB.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind("pending-token", ninaId, new Date().toISOString(), new Date(Date.now() + 60_000).toISOString())
      .run();

    const res = await authed("/search", "pending-token", { method: "POST", body: searchBody });
    expect(res.status).toBe(403);
  });

  it("rejects an approved user with no key", async () => {
    const token = await approvedUser("olive", false);
    const res = await authed("/search", token, { method: "POST", body: searchBody });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { source: string }).source).toBe("auth");
  });

  it("ignores a client-supplied X-Serpapi-Key -- the bypass is gone", async () => {
    const res = await req("/search", {
      method: "POST",
      body: searchBody,
      headers: { "X-Serpapi-Key": "smuggled-key" },
    });
    expect(res.status).toBe(401);
  });

  it("forwards with the user's own decrypted key once approved and keyed", async () => {
    const token = await approvedUser("pete", true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ best_flights: [] }), { status: 200 }));

    try {
      const res = await authed("/search", token, { method: "POST", body: searchBody });
      expect(res.status).toBe(200);

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.origin + calledUrl.pathname).toBe("https://serpapi.com/search");
      expect(calledUrl.searchParams.get("api_key")).toBe("real-serpapi-key");
      expect(calledUrl.searchParams.get("engine")).toBe("google_flights");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses a non-google_flights engine (not an open proxy)", async () => {
    const token = await approvedUser("quinn", true);
    const res = await authed("/search", token, {
      method: "POST",
      body: JSON.stringify({ params: { engine: "google" } }),
    });
    expect(res.status).toBe(400);
  });

  it("never lets the request body smuggle its own api_key", async () => {
    const token = await approvedUser("rosa", true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ best_flights: [] }), { status: 200 }));

    try {
      await authed("/search", token, {
        method: "POST",
        body: JSON.stringify({ params: { engine: "google_flights", api_key: "smuggled" } }),
      });
      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("api_key")).toBe("real-serpapi-key");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
