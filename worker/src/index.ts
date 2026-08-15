/**
 * SmartFlighter SerpApi proxy.
 *
 * SerpApi deliberately sends no CORS headers, so a browser cannot call it
 * directly -- this Worker is the minimum server in the "lightweight"
 * (no-backend) deployment. It does exactly one thing: forward a
 * google_flights query to serpapi.com with the CALLER'S OWN key attached
 * (sent per-request in the X-Serpapi-Key header, read from the visitor's
 * localStorage by the frontend). Nothing is stored or logged here; the
 * key exists only for the lifetime of the request.
 *
 * Not an open proxy: only params.engine === "google_flights" is forwarded,
 * and only to SERPAPI_URL, for browsers on ALLOWED_ORIGINS.
 */

interface Env {
  ALLOWED_ORIGINS: string;
}

const SERPAPI_URL = "https://serpapi.com/search";

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-serpapi-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (!origin) {
      // No CORS headers on purpose: a disallowed origin's browser will
      // block the response either way, and curl callers get a plain 403.
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/search") {
      return json({ error: "POST /search only" }, 404, origin);
    }

    const apiKey = request.headers.get("X-Serpapi-Key")?.trim();
    if (!apiKey) {
      return json({ error: "Missing X-Serpapi-Key header" }, 401, origin);
    }

    let params: Record<string, string>;
    try {
      const body = (await request.json()) as { params?: Record<string, unknown> };
      params = Object.fromEntries(
        Object.entries(body.params ?? {}).map(([k, v]) => [k, String(v)]),
      );
    } catch {
      return json({ error: "Body must be JSON: {params: {...}}" }, 400, origin);
    }

    if (params.engine !== "google_flights") {
      return json({ error: "Only engine=google_flights is supported" }, 400, origin);
    }
    // The key comes from the header alone -- never let the body smuggle a
    // different one (or leak into logs via the query string of a reject).
    delete params.api_key;

    const url = new URL(SERPAPI_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("api_key", apiKey);

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    // Pass the body and status through untouched -- the frontend's parser
    // handles SerpApi's own {"error": ...} shape, and quota/auth failures
    // (401/429) must reach it intact to trigger degraded mode.
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  },
};
