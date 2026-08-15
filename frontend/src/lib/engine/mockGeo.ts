// Rough great-circle distance between two seed airports, for the mock
// provider's flight-duration model. Unknown IATAs fall back to YYZ's
// coordinates (same forgiving behavior as the Python mock).

import { AIRPORTS } from "./seed";

const YYZ_FALLBACK: [number, number] = [43.6777, -79.6248];

const coords = new Map<string, [number, number]>(AIRPORTS.map((a) => [a.iata, [a.lat, a.lon]]));

export function estimateDistanceKm(a: string, b: string): number {
  const [lat1, lon1] = coords.get(a) ?? YYZ_FALLBACK;
  const [lat2, lon2] = coords.get(b) ?? YYZ_FALLBACK;
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const x = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlambda / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}
