// Indicative fare estimation -- client-side port of
// backend/app/services/indicative.py. Resolution order:
//   1. This user's own observation for the exact route/dates, <=7 days old.
//   2. Nearest-date observations on the same route within +/-10 days,
//      distance-weighted.
//   3. The static route_baselines.json floor x ORIGIN_FACTOR
//      (x ONE_WAY_FACTOR for one-way).
//
// Every tier is trip_type-scoped: a one-way price never answers a
// round-trip query for the same route/dates, and vice versa.
//
// Differences from the backend, by design of the lightweight build:
// tiers 1-2 read only THIS user's localStorage history (no cross-user
// sharing), so cold start leans on tier 3 more often. ONE_WAY_FACTOR is
// a flat cold-start approximation (real one-way/round-trip ratios vary
// by route); it applies uniformly across dates for a destination, so the
// within-destination date ranking pruning needs is unaffected, and tiers
// 1-2 self-correct as the user's own one-way history accumulates.

import { loadObservations } from "./observations";
import { ROUTE_BASELINES } from "./seed";
import type { EngineTripType, EstimateSource } from "./types";

export const INDICATIVE_MAX_AGE_DAYS = 7;
export const NEAREST_DATE_WINDOW_DAYS = 10;
export const GENERIC_FALLBACK_CAD = 1100.0;
export const ONE_WAY_FACTOR = 0.6;

// Relative pricing pull per Toronto-region origin airport -- duplicated
// from the backend's mock.py/indicative.py market-simulation constants so
// cold-start estimates differentiate origins (without this, pruning's
// price-sorted survivor list starves either the primary or the
// alternates before verification ever sees them).
export const ORIGIN_FACTOR: Record<string, number> = {
  YYZ: 1.0,
  YTZ: 1.05,
  YHM: 0.88,
  YKF: 0.95,
  BUF: 0.75,
};

const DAY_MS = 86_400_000;

function daysApart(aIso: string, bIso: string): number {
  return Math.abs(Math.round((Date.parse(aIso) - Date.parse(bIso)) / DAY_MS));
}

export function estimate(
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
  tripType: EngineTripType,
  opts: { originMetro?: string; now?: number } = {},
): [number, EstimateSource] {
  const now = opts.now ?? Date.now();
  const originMetro = opts.originMetro ?? "toronto";

  const rows = loadObservations().filter(
    (r) => r.origin === origin && r.destination === destination && r.trip_type === tripType,
  );

  const cutoff = now - INDICATIVE_MAX_AGE_DAYS * DAY_MS;
  const exact = rows
    .filter((r) => r.departure_date === departDate && r.return_date === returnDate && r.observed_at >= cutoff)
    .sort((a, b) => b.observed_at - a.observed_at)[0];
  if (exact) return [exact.fare, "observation_exact"];

  const nearby = rows.filter((r) => daysApart(r.departure_date, departDate) <= NEAREST_DATE_WINDOW_DAYS);
  if (nearby.length > 0) {
    let weightedSum = 0;
    let weightTotal = 0;
    for (const obs of nearby) {
      const weight = 1 / (1 + daysApart(obs.departure_date, departDate));
      weightedSum += obs.fare * weight;
      weightTotal += weight;
    }
    if (weightTotal > 0) {
      return [Math.round((weightedSum / weightTotal) * 100) / 100, "observation_nearest"];
    }
  }

  const originFactor = ORIGIN_FACTOR[origin] ?? 1.0;
  const tripFactor = tripType === "one_way" ? ONE_WAY_FACTOR : 1.0;
  const baseline = ROUTE_BASELINES[originMetro]?.[destination];
  const base = baseline ?? GENERIC_FALLBACK_CAD;
  return [Math.round(base * originFactor * tripFactor * 100) / 100, "baseline"];
}
