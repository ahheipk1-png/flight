// Ranked, explained results -- port of backend/app/search/ranking.py.
// One deliberate upgrade over the Python original: explanations are
// emitted as {key, params} i18n specs instead of prebuilt English
// strings, so the results screen renders them in the viewer's language
// (this was the one surface the server-rendered version couldn't
// translate).

import type { ExplanationSpec } from "@/lib/types";
import { BEST_SCORE_DURATION_COST_PER_HOUR, BEST_SCORE_GROUND_COST_WEIGHT } from "./constants";
import { resolveEquivalence } from "./geo";
import type { SearchSpace, VerifiedItinerary } from "./types";

export interface GroundTransfer {
  from_iata: string;
  to_iata: string;
  minutes: number;
  cost: number;
  currency: string;
  net_saving: number;
}

export interface RankedItinerary {
  verifiedItinerary: VerifiedItinerary;
  bestScore: number;
  explanations: ExplanationSpec[];
  groundTransfer: GroundTransfer | null;
}

/** Primary-origin itineraries always pass. An alt-origin itinerary is
 * kept only if, for the SAME destination/dates, it beats the best
 * primary-origin fare by at least minSavingPerPerson after round-trip
 * ground cost. (For multi-city every origin IS the primary, so this is a
 * no-op passthrough there.) */
function nearbyAirportFilter(
  space: SearchSpace,
  itineraries: VerifiedItinerary[],
): [VerifiedItinerary, GroundTransfer | null][] {
  const primaryIata = space.primaryOrigin.iata;

  const bestPrimary = new Map<string, number>();
  for (const it of itineraries) {
    if (it.origin !== primaryIata) continue;
    const key = `${it.destination}|${it.departDate}|${it.tripLength}`;
    const current = bestPrimary.get(key);
    if (current === undefined || it.option.price < current) bestPrimary.set(key, it.option.price);
  }

  const kept: [VerifiedItinerary, GroundTransfer | null][] = [];
  for (const it of itineraries) {
    if (it.origin === primaryIata) {
      kept.push([it, null]);
      continue;
    }

    const equiv = resolveEquivalence(primaryIata, it.origin);
    const groundCostRoundTrip = equiv ? equiv.ground_cost_estimate * 2 : 0;
    const groundMinutes = equiv ? equiv.ground_time_minutes : 10_000; // unknown equivalence => never eligible

    const primaryPrice = bestPrimary.get(`${it.destination}|${it.departDate}|${it.tripLength}`);
    // No primary-origin result for the same trip => can't establish a
    // saving, so drop rather than show an unexplainable alt-origin result.
    if (primaryPrice === undefined) continue;

    const netSaving = primaryPrice - it.option.price - groundCostRoundTrip;
    if (netSaving >= space.minSavingPerPerson && groundMinutes <= space.maxGroundMinutes) {
      kept.push([
        it,
        {
          from_iata: primaryIata,
          to_iata: it.origin,
          minutes: groundMinutes,
          cost: groundCostRoundTrip,
          currency: equiv?.currency ?? space.currency,
          net_saving: Math.round(netSaving * 100) / 100,
        },
      ]);
    }
  }
  return kept;
}

function explanationsFor(
  it: VerifiedItinerary,
  groundTransfer: GroundTransfer | null,
  space: SearchSpace,
  typicalPrice: number | undefined,
): ExplanationSpec[] {
  const notes: ExplanationSpec[] = [];

  if (typicalPrice !== undefined && it.option.price < typicalPrice) {
    notes.push({
      key: "results.expl.belowTypical",
      params: { currency: space.currency, amount: Math.round(typicalPrice - it.option.price) },
    });
  }

  if (groundTransfer) {
    notes.push({
      key: "results.expl.nearbySaving",
      params: {
        airport: groundTransfer.to_iata,
        currency: space.currency,
        saving: Math.round(groundTransfer.net_saving),
        cost: Math.round(groundTransfer.cost),
      },
    });
  }

  if (it.option.stops === 0) {
    notes.push({ key: "results.nonstop" });
  } else if (it.option.layovers.length > 0) {
    const [hub, minutes] = it.option.layovers[0];
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    notes.push({
      key: "results.expl.singleConnection",
      params: {
        duration: `${hours}h${String(mins).padStart(2, "0")}`,
        hub,
        lo: Math.floor(space.minNormalMinutes / 60),
        hi: Math.floor(space.maxNormalMinutes / 60),
      },
    });
  }

  notes.push({ key: it.verified ? "results.expl.verifiedLive" : "results.expl.indicative" });
  return notes.slice(0, 3);
}

function bestScore(it: VerifiedItinerary, groundCost: number): number {
  const durationHours = it.option.total_duration_min / 60;
  return it.option.price + BEST_SCORE_GROUND_COST_WEIGHT * groundCost + BEST_SCORE_DURATION_COST_PER_HOUR * durationHours;
}

export function rank(space: SearchSpace, itineraries: VerifiedItinerary[]): RankedItinerary[] {
  const filtered = nearbyAirportFilter(space, itineraries);

  // "Typical fare" = median of this search's own results per destination
  // (explicitly a within-search comparison, not a market claim).
  const byDest = new Map<string, number[]>();
  for (const [it] of filtered) {
    const prices = byDest.get(it.destination) ?? [];
    prices.push(it.option.price);
    byDest.set(it.destination, prices);
  }
  const typical = new Map<string, number>();
  for (const [dest, prices] of byDest) {
    typical.set(dest, [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)]);
  }

  const ranked: RankedItinerary[] = filtered.map(([it, groundTransfer]) => ({
    verifiedItinerary: it,
    bestScore: bestScore(it, groundTransfer?.cost ?? 0),
    explanations: explanationsFor(it, groundTransfer, space, typical.get(it.destination)),
    groundTransfer,
  }));

  ranked.sort((a, b) => a.bestScore - b.bestScore);
  return ranked;
}
