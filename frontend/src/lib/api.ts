import type { MetaResponse, SearchRequestBody, SearchStateResponse } from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(`${res.status} ${res.statusText}: ${body}`, res.status);
  }
  return (await res.json()) as T;
}

export function getMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta", { signal });
}

export function postSearch(body: SearchRequestBody, signal?: AbortSignal): Promise<{ search_id: string }> {
  return request<{ search_id: string }>("/api/search", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
}

export function getSearchState(searchId: string, signal?: AbortSignal): Promise<SearchStateResponse> {
  return request<SearchStateResponse>(`/api/search/${searchId}`, { signal });
}

export { ApiError };
