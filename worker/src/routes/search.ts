/** The SerpApi proxy. SerpApi sends no CORS headers, so a browser can't
 * call it directly -- this is why the Worker exists at all.
 *
 * The key now comes from the caller's own stored, decrypted account key
 * (requireApprovedWithKey), NOT from a client-supplied header. The old
 * X-Serpapi-Key path was removed outright rather than kept as a fallback:
 * leaving it would let anyone bypass the whole approval gate by sending
 * their own key directly.
 *
 * Not an open proxy: only engine=google_flights is forwarded, only to
 * SERPAPI_URL, only for approved accounts. */

import { Hono } from "hono";
import { logSearchCall } from "../lib/searchLog";
import type { AppEnv } from "../types";

const SERPAPI_URL = "https://serpapi.com/search";

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.post("/", async (c) => {
  let params: Record<string, string>;
  try {
    const body = (await c.req.json()) as { params?: Record<string, unknown> };
    params = Object.fromEntries(Object.entries(body.params ?? {}).map(([k, v]) => [k, String(v)]));
  } catch {
    return c.json({ error: "Body must be JSON: {params: {...}}" }, 400);
  }

  if (params.engine !== "google_flights") {
    return c.json({ error: "Only engine=google_flights is supported" }, 400);
  }
  // The key is attached server-side below -- never let the body smuggle one in.
  delete params.api_key;

  // Log before forwarding (each proxied call is one paid SerpApi call) --
  // same before-the-call discipline as the Python reference's
  // api_call_log. Feeds the admin dashboard's per-user counts/history.
  await logSearchCall(c.env.DB, c.get("user").id, params);

  const url = new URL(SERPAPI_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", c.get("apiKey"));

  const upstream = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });

  // Pass body and status through untouched: the frontend's parser handles
  // SerpApi's own {"error": ...} shape, and quota/auth failures (401/429)
  // must reach it intact to trigger degraded mode.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
});
