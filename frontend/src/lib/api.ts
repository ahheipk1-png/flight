import type {
  AdminAccountOut,
  MeOut,
  MetaResponse,
  SearchRequestBody,
  SearchStateResponse,
  SessionOut,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    // FastAPI's HTTPException body is {"detail": "..."} -- surface that
    // message directly rather than a generic "400 Bad Request", since
    // every gate in the auth flow (pending/denied/no-key/etc.) relies on
    // its detail string actually reaching the user.
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : "";
    } catch {
      // non-JSON error body -- fall through with an empty detail
    }
    throw new ApiError(detail || `${res.status} ${res.statusText}`, res.status);
  }
  return (await res.json()) as T;
}

export function getMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta", { signal });
}

export function postSearch(body: SearchRequestBody, token: string, signal?: AbortSignal): Promise<{ search_id: string }> {
  return request<{ search_id: string }>("/api/search", { method: "POST", body: JSON.stringify(body), signal }, token);
}

export function getSearchState(searchId: string, token: string, signal?: AbortSignal): Promise<SearchStateResponse> {
  return request<SearchStateResponse>(`/api/search/${searchId}`, { signal }, token);
}

// ---------- auth ----------

export function registerAccount(username: string, password: string, serpapiApiKey?: string): Promise<{ ok: boolean; message: string }> {
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
  return request("/api/auth/api-key", { method: "PUT", body: JSON.stringify({ serpapi_api_key: serpapiApiKey }) }, token);
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
  return request(`/api/admin/accounts/${userId}/set-password`, { method: "POST", body: JSON.stringify({ new_password: newPassword }) }, token);
}

export { ApiError };
