/** Ported from the pre-Hono hand-rolled implementation rather than
 * switching to hono/cors, to preserve one intentional behavior: a
 * disallowed origin gets a bare 403 with NO CORS headers, so a curl
 * caller sees a clean rejection. hono/cors only omits the header and
 * leaves the browser to enforce the block, which would let a
 * disallowed-origin request still receive a normal 200 body. */

import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin");
  const allowed = c.env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (!origin || !allowed.includes(origin)) {
    return c.text("Forbidden", 403);
  }

  if (c.req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  await next();

  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    c.res.headers.set(k, v);
  }
};
