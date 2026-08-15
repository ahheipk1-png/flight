// Accounts + admin calls against the Cloudflare Worker. Search itself
// does NOT go through here -- the search pipeline runs in the browser
// (lib/engine/) and only its SerpApi calls are proxied, by
// lib/engine/serpapi.ts talking to the same Worker directly.

import { PROXY_BASE } from "./engine/constants";
import type { AdminAccountOut, MeOut, SearchLogEntry, SessionOut } from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${PROXY_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    // The Worker returns {"error": "..."} (and "source": "auth" for gate
    // failures). Surface that message directly rather than a generic
    // "400 Bad Request" -- every gate in the auth flow
    // (pending/denied/no-key/...) relies on its text reaching the user.
    let detail = "";
    try {
      const body = (await res.json()) as { error?: unknown };
      detail = typeof body?.error === "string" ? body.error : "";
    } catch {
      // non-JSON error body -- fall through with an empty detail
    }
    throw new ApiError(detail || `${res.status} ${res.statusText}`, res.status);
  }
  return (await res.json()) as T;
}

export function registerAccount(
  username: string,
  password: string,
  serpapiApiKey?: string,
): Promise<{ ok: boolean; message: string }> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, serpapi_api_key: serpapiApiKey || undefined }),
  });
}

export function login(username: string, password: string): Promise<SessionOut> {
  return request<SessionOut>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function logout(token: string): Promise<{ ok: boolean }> {
  return request("/api/auth/logout", { method: "POST" }, token);
}

export function getMe(token: string): Promise<MeOut> {
  return request<MeOut>("/api/auth/me", {}, token);
}

export function setApiKey(token: string, serpapiApiKey: string): Promise<{ ok: boolean }> {
  return request(
    "/api/auth/api-key",
    { method: "PUT", body: JSON.stringify({ serpapi_api_key: serpapiApiKey }) },
    token,
  );
}

export function clearApiKey(token: string): Promise<{ ok: boolean }> {
  return request("/api/auth/api-key", { method: "DELETE" }, token);
}

// ---------- admin ----------

export function listAccounts(token: string): Promise<AdminAccountOut[]> {
  return request<AdminAccountOut[]>("/api/admin/accounts", {}, token);
}

export function approveAccount(token: string, userId: number): Promise<{ ok: boolean }> {
  return request(`/api/admin/accounts/${userId}/approve`, { method: "POST" }, token);
}

export function denyAccount(token: string, userId: number): Promise<{ ok: boolean }> {
  return request(`/api/admin/accounts/${userId}/deny`, { method: "POST" }, token);
}

export function disableAccount(token: string, userId: number): Promise<{ ok: boolean }> {
  return request(`/api/admin/accounts/${userId}/disable`, { method: "POST" }, token);
}

export function adminSetPassword(token: string, userId: number, newPassword: string): Promise<{ ok: boolean }> {
  return request(
    `/api/admin/accounts/${userId}/set-password`,
    { method: "POST", body: JSON.stringify({ new_password: newPassword }) },
    token,
  );
}

export function adminSetApiKey(token: string, userId: number, serpapiApiKey: string): Promise<{ ok: boolean }> {
  return request(
    `/api/admin/accounts/${userId}/set-api-key`,
    { method: "POST", body: JSON.stringify({ serpapi_api_key: serpapiApiKey }) },
    token,
  );
}

export function adminClearApiKey(token: string, userId: number): Promise<{ ok: boolean }> {
  return request(`/api/admin/accounts/${userId}/api-key`, { method: "DELETE" }, token);
}

export function listAccountSearches(token: string, userId: number): Promise<SearchLogEntry[]> {
  return request<SearchLogEntry[]>(`/api/admin/accounts/${userId}/searches`, {}, token);
}

export { ApiError };
