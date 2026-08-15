// Pipeline tuning constants -- the client-side counterpart of
// backend/app/config.py's Settings fields (same names, same defaults).
// There's no .env layer in the browser build; these are compile-time.

export const COARSE_DATE_STRIDE_DAYS = 4;
export const COARSE_EXPAND_WINDOW_DAYS = 3;
export const PRUNE_TOP_CELLS = 6;
export const PRUNE_MAX_CANDIDATES = 40;
export const PRUNE_OVERSHOOT_RATIO = 1.15;

// verify_top_n is sized as ~4 Toronto-group origins x ~4 destination/date
// neighborhoods, because verification pairs every origin variant of a
// trip in one CandidateGroup (see verification.ts).
export const VERIFY_TOP_N = 16;
export const PER_SEARCH_LIVE_CAP = 20;
export const VERIFY_CONCURRENCY = 4;

export const BEST_SCORE_GROUND_COST_WEIGHT = 2.0;
export const BEST_SCORE_DURATION_COST_PER_HOUR = 8.0;

// Query-result cache TTLs (ms here, not seconds -- browser timestamps).
export const FARE_CACHE_TTL_VERIFIED_MS = 30 * 60 * 1000;
export const FARE_CACHE_TTL_EMPTY_MS = 60 * 60 * 1000;

export const DEFAULT_CURRENCY = "CAD";

export const PROXY_BASE = process.env.NEXT_PUBLIC_PROXY_BASE ?? "http://localhost:8787";
