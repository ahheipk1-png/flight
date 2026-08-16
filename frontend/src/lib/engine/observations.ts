// Browser-local replacement for the backend's two persistence layers:
// the fare_observations table (this user's own price history, feeding
// indicative.ts's tiers 1-2) and the Redis query-result cache. Both live
// in localStorage -- per-device, per-user. The full backend shares these
// across ALL users; here each user only learns from their own searches.
// That loses cross-user dedup/learning (accepted lightweight tradeoff)
// but keeps repeat searches by the same user free and self-improving.

import type { FareOption } from "./types";

const OBS_KEY = "smartflighterObservations";
const CACHE_KEY = "smartflighterFareCache";
// ~150 bytes/row -> well under localStorage quotas at this cap.
const MAX_OBSERVATION_ROWS = 2000;

export interface ObservationRow {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  trip_type: string;
  fare: number;
  observed_at: number; // epoch ms
  // Undefined on rows saved before passenger-aware estimation existed --
  // indicative.ts treats a missing key as the common solo-adult case, so
  // old history keeps working for the case it's actually valid for.
  party_key?: string;
}

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readJson<T>(key: string, fallback: T): T {
  const s = storage();
  if (!s) return fallback;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled -- the engine degrades to
    // baseline-only estimates and uncached live calls, never crashes.
  }
}

export function loadObservations(): ObservationRow[] {
  return readJson<ObservationRow[]>(OBS_KEY, []);
}

export function addObservations(rows: ObservationRow[]): void {
  if (rows.length === 0) return;
  const all = [...loadObservations(), ...rows];
  // Keep the newest rows when over cap.
  all.sort((a, b) => a.observed_at - b.observed_at);
  writeJson(OBS_KEY, all.slice(-MAX_OBSERVATION_ROWS));
}

export function clearObservations(): void {
  storage()?.removeItem(OBS_KEY);
}

// --- TTL'd query-result cache (Redis stand-in) ---

interface CacheEntry {
  options: FareOption[];
  expiresAt: number; // epoch ms
}

type CacheMap = Record<string, CacheEntry>;

export function cacheGet(key: string, now = Date.now()): FareOption[] | null {
  const map = readJson<CacheMap>(CACHE_KEY, {});
  const entry = map[key];
  if (!entry || entry.expiresAt <= now) return null;
  return entry.options;
}

export function cacheSet(key: string, options: FareOption[], ttlMs: number, now = Date.now()): void {
  const map = readJson<CacheMap>(CACHE_KEY, {});
  // Prune expired entries on write so the map can't grow unboundedly.
  for (const [k, entry] of Object.entries(map)) {
    if (entry.expiresAt <= now) delete map[k];
  }
  map[key] = { options, expiresAt: now + ttlMs };
  writeJson(CACHE_KEY, map);
}

export function clearFareCache(): void {
  storage()?.removeItem(CACHE_KEY);
}

// --- Advisory usage counter (the user's own SerpApi quota) ---

const USAGE_KEY = "smartflighterUsage";

interface UsageMap {
  [yyyymm: string]: number;
}

export function recordLiveCall(now = new Date()): void {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const map = readJson<UsageMap>(USAGE_KEY, {});
  map[month] = (map[month] ?? 0) + 1;
  // Keep only the current and previous month.
  const keys = Object.keys(map).sort();
  for (const k of keys.slice(0, -2)) delete map[k];
  writeJson(USAGE_KEY, map);
}

export function liveCallsThisMonth(now = new Date()): number {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return readJson<UsageMap>(USAGE_KEY, {})[month] ?? 0;
}
