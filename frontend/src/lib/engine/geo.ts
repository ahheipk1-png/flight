// Geography lookups over the bundled seed -- the client-side counterpart
// of backend/app/services/geo.py, minus the database.

import type { AirportMeta } from "@/lib/types";
import { AIRPORTS, EQUIVALENCES } from "./seed";

export interface EquivalenceInfo {
  ground_time_minutes: number;
  ground_cost_estimate: number;
  currency: string;
  same_metro: boolean;
  same_travel_region: boolean;
}

const airportByIata = new Map<string, AirportMeta>(AIRPORTS.map((a) => [a.iata, a]));

// The backend stores each unordered pair once, normalized on DB row id;
// here the canonical key is the sorted IATA pair instead -- same
// bidirectional semantics, no database dependence.
const equivalenceByPair = new Map<string, EquivalenceInfo>(
  EQUIVALENCES.map((e) => [
    [e.a, e.b].sort().join("|"),
    {
      ground_time_minutes: e.ground_time_minutes,
      ground_cost_estimate: e.ground_cost_estimate,
      currency: e.currency,
      same_metro: e.same_metro,
      same_travel_region: e.same_travel_region,
    },
  ]),
);

export function getAirport(iata: string): AirportMeta | undefined {
  return airportByIata.get(iata);
}

export function resolveEquivalence(iataA: string, iataB: string): EquivalenceInfo | null {
  if (iataA === iataB) {
    return { ground_time_minutes: 0, ground_cost_estimate: 0, currency: "CAD", same_metro: true, same_travel_region: true };
  }
  return equivalenceByPair.get([iataA, iataB].sort().join("|")) ?? null;
}

export function getOriginGroup(regionCode = "greater_toronto"): AirportMeta[] {
  return AIRPORTS.filter((a) => a.region === regionCode && a.is_origin_candidate);
}

export function getDestinationAirports(regionCodes: string[], opts: { primaryOnly?: boolean } = {}): AirportMeta[] {
  const codes = new Set(regionCodes);
  return AIRPORTS.filter((a) => codes.has(a.region) && (!opts.primaryOnly || a.is_metro_primary));
}

/** All airports sharing the given airport's metro -- includes the input
 * airport itself, [] for an unknown iata (matches the backend). */
export function getMetroSiblings(iata: string): AirportMeta[] {
  const airport = airportByIata.get(iata);
  if (!airport) return [];
  return AIRPORTS.filter((a) => a.metro === airport.metro);
}
