// Indicative fare estimation used ONLY to prioritize which candidates are
// worth a live call -- never shown to the user as a price. Resolution
// order:
//   1. This user's own observation for the exact route/dates/party, <=7
//      days old.
//   2. Nearest-date observations on the same route+party within +/-10
//      days, distance-weighted.
//   3. No signal: candidates keep their original date-stride order
//      instead of being sorted by a fabricated number.
//
// There used to be a third tier here -- a static per-route baseline x
// origin factor. It's gone: with the origin/destination now able to be
// ANY airport in the world (not just the curated Toronto-area set the
// baseline table covered), a synthetic guess for an unseen route would be
// meaningless, and the user explicitly asked for live prices only, never
// guessed ones. Losing the tier only affects the ORDER candidates are
// tried in when this user has no history for the route -- every price
// actually shown always comes from a real SerpApi call (see
// verification.ts); this module never influences what's displayed.

import type { Passengers } from "@/lib/types";
import { loadObservations } from "./observations";
import type { EstimateSource } from "./types";

export const INDICATIVE_MAX_AGE_DAYS = 7;
export const NEAREST_DATE_WINDOW_DAYS = 10;

const DAY_MS = 86_400_000;

function daysApart(aIso: string, bIso: string): number {
  return Math.abs(Math.round((Date.parse(aIso) - Date.parse(bIso)) / DAY_MS));
}

/** Distinguishes a 2-adult observation from a 1-adult one so a party of
 * one can't be estimated from -- or poison the cache for -- a party of
 * four. Old rows saved before this field existed have no party_key; they
 * match only the common 1-adult/no-extras case, not any other party. */
export function partyKey(p: Passengers): string {
  return `${p.adults}-${p.children}-${p.infants_in_seat}-${p.infants_on_lap}`;
}

const SOLO_ADULT_KEY = partyKey({ adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0 });

export function estimate(
  origin: string,
  destination: string,
  departDate: string,
  returnDate: string,
  tripType: string,
  passengers: Passengers,
  opts: { now?: number } = {},
): [number, EstimateSource] | [null, null] {
  const now = opts.now ?? Date.now();
  const key = partyKey(passengers);

  const rows = loadObservations().filter(
    (r) =>
      r.origin === origin &&
      r.destination === destination &&
      r.trip_type === tripType &&
      (r.party_key ?? SOLO_ADULT_KEY) === key,
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

  return [null, null];
}
