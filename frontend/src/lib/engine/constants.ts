// Pipeline tuning constants -- the client-side counterpart of
// backend/app/config.py's Settings fields (same names, same defaults).
// There's no .env layer in the browser build; these are compile-time.

export const COARSE_DATE_STRIDE_DAYS = 4;
export const COARSE_EXPAND_WINDOW_DAYS = 3;
export const PRUNE_TOP_CELLS = 8;
export const PRUNE_MAX_CANDIDATES = 40;
export const PRUNE_OVERSHOOT_RATIO = 1.15;

// Origin and destination are each one already-optimized comma-joined
// airport group per candidate (see FareQuery) -- no per-airport variant
// multiplies the live-call budget anymore, so verify_top_n can just equal
// the live-call cap itself.
export const VERIFY_TOP_N = 20;
export const PER_SEARCH_LIVE_CAP = 20;
export const VERIFY_CONCURRENCY = 4;

export const BEST_SCORE_DURATION_COST_PER_HOUR = 8.0;

// Query-result cache TTLs (ms here, not seconds -- browser timestamps).
export const FARE_CACHE_TTL_VERIFIED_MS = 30 * 60 * 1000;
export const FARE_CACHE_TTL_EMPTY_MS = 60 * 60 * 1000;

export const DEFAULT_CURRENCY = "CAD";

export const PROXY_BASE = process.env.NEXT_PUBLIC_PROXY_BASE ?? "http://localhost:8787";
