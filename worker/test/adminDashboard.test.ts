/** The admin-dashboard additions: per-user search logging/counts/history
 * and the API-key override. */

import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { hashPassword } from "../src/lib/crypto";
import { summarizeParams } from "../src/lib/searchLog";

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

async function login(username: string, password: string) {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  return ((await res.json()) as { token: string }).token;
}

async function seedAdmin(username = "admin") {
  await env.DB.prepare(
    "INSERT INTO users (username, password_hash, status, is_admin, created_at) VALUES (?, ?, 'approved', 1, ?)",
  )
    .bind(username, await hashPassword("adminpass123"), new Date().toISOString())
    .run();
  return login(username, "adminpass123");
}

async function seedApprovedUser(username: string, withKey = true) {
  await req("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password: "password123", serpapi_api_key: withKey ? "their-key" : null }),
  });
  const row = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: number }>();
  await env.DB.prepare("UPDATE users SET status = 'approved' WHERE id = ?").bind(row!.id).run();
  return { id: row!.id, token: await login(username, "password123") };
}

function stubSerpApi() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ best_flights: [] }), { status: 200 }));
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM search_log").run();
  await env.DB.prepare("DELETE FROM sessions").run();
  await env.DB.prepare("DELETE FROM users").run();
});

describe("search logging", () => {
  it("records each proxied call with the caller's route summary", async () => {
    const { id, token } = await seedApprovedUser("searcher");
    const fetchSpy = stubSerpApi();
    try {
      await authed("/search", token, {
        method: "POST",
        body: JSON.stringify({
          params: {
            engine: "google_flights",
            type: "1",
            departure_id: "YYZ",
            arrival_id: "KIX",
            outbound_date: "2026-09-18",
            return_date: "2026-10-02",
          },
        }),
      });
      await authed("/search", token, {
        method: "POST",
        body: JSON.stringify({
          params: { engine: "google_flights", type: "2", departure_id: "YYZ", arrival_id: "HKG", outbound_date: "2026-09-20" },
        }),
      });
    } finally {
      fetchSpy.mockRestore();
    }

    const rows = await env.DB.prepare("SELECT * FROM search_log WHERE user_id = ? ORDER BY id").bind(id).all();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({ trip_type: "1", departure_id: "YYZ", arrival_id: "KIX" });
    expect(rows.results[1]).toMatchObject({ trip_type: "2", arrival_id: "HKG", return_date: null });
  });

  it("summarizes multi-city params from multi_city_json", () => {
    const summary = summarizeParams({
      engine: "google_flights",
      type: "3",
      multi_city_json: JSON.stringify([
        { departure_id: "YYZ", arrival_id: "IST", date: "2026-09-10" },
        { departure_id: "IST", arrival_id: "BKK", date: "2026-09-15" },
      ]),
    });
    expect(summary).toEqual({
      trip_type: "3",
      departure_id: "YYZ",
      arrival_id: "BKK",
      outbound_date: "2026-09-10",
      return_date: "2026-09-15",
    });
  });

  it("exposes counts on the accounts list and history per account, admin-only", async () => {
    const adminToken = await seedAdmin();
    const { id, token } = await seedApprovedUser("counted");
    const fetchSpy = stubSerpApi();
    try {
      for (let i = 0; i < 3; i++) {
        await authed("/search", token, {
          method: "POST",
          body: JSON.stringify({
            params: { engine: "google_flights", type: "1", departure_id: "YYZ", arrival_id: "KIX" },
          }),
        });
      }
    } finally {
      fetchSpy.mockRestore();
    }

    const list = (await (await authed("/api/admin/accounts", adminToken)).json()) as {
      username: string;
      search_count: number;
    }[];
    expect(list.find((a) => a.username === "counted")?.search_count).toBe(3);
    expect(list.find((a) => a.username === "admin")?.search_count).toBe(0);

    const history = (await (
      await authed(`/api/admin/accounts/${id}/searches`, adminToken)
    ).json()) as { departure_id: string }[];
    expect(history).toHaveLength(3);
    expect(history[0].departure_id).toBe("YYZ");

    // A non-admin cannot read anyone's history (requireAdmin wraps all
    // /api/admin routes).
    expect((await authed(`/api/admin/accounts/${id}/searches`, token)).status).toBe(403);
  });
});

describe("admin API-key override", () => {
  it("sets a key that then authorizes that user's searches", async () => {
    const adminToken = await seedAdmin();
    const { id, token } = await seedApprovedUser("keyless", false);

    // Blocked before: approved but no key.
    const before = await authed("/search", token, {
      method: "POST",
      body: JSON.stringify({ params: { engine: "google_flights" } }),
    });
    expect(before.status).toBe(400);

    const set = await authed(`/api/admin/accounts/${id}/set-api-key`, adminToken, {
      method: "POST",
      body: JSON.stringify({ serpapi_api_key: "admin-provided-key" }),
    });
    expect(set.status).toBe(200);

    const fetchSpy = stubSerpApi();
    try {
      const after = await authed("/search", token, {
        method: "POST",
        body: JSON.stringify({ params: { engine: "google_flights" } }),
      });
      expect(after.status).toBe(200);
      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("api_key")).toBe("admin-provided-key");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("can clear a user's key, and 404s on unknown accounts", async () => {
    const adminToken = await seedAdmin();
    const { id } = await seedApprovedUser("hadkey", true);

    expect((await authed(`/api/admin/accounts/${id}/api-key`, adminToken, { method: "DELETE" })).status).toBe(200);
    const row = await env.DB.prepare("SELECT serpapi_api_key_encrypted FROM users WHERE id = ?")
      .bind(id)
      .first<{ serpapi_api_key_encrypted: string | null }>();
    expect(row?.serpapi_api_key_encrypted).toBeNull();

    expect(
      (
        await authed("/api/admin/accounts/9999/set-api-key", adminToken, {
          method: "POST",
          body: JSON.stringify({ serpapi_api_key: "x" }),
        })
      ).status,
    ).toBe(404);
  });
});
