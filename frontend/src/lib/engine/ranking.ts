// Ranked, explained results. Explanations are emitted as {key, params}
// i18n specs instead of prebuilt English strings, so the results screen
// renders them in the viewer's language.
//
// There used to be a nearby-airport-savings pass here (comparing a
// primary-origin price against an alternate-origin price for the same
// trip and only keeping the alternate if it saved enough net of ground
// transfer). That's gone: origin is now a single comma-joined airport
// group per search (see FareQuery), so SerpApi itself already picked
// whichever airport in the group was cheapest -- there's no separate
// "alternate origin result" left to compare or explain.

import type { ExplanationSpec } from "@/lib/types";
import { BEST_SCORE_DURATION_COST_PER_HOUR } from "./constants";
import type { SearchSpace, VerifiedItinerary } from "./types";

export interface RankedItinerary {
  verifiedItinerary: VerifiedItinerary;
  bestScore: number;
  explanations: ExplanationSpec[];
}

function explanationsFor(it: VerifiedItinerary, space: SearchSpace, typicalPrice: number | undefined): ExplanationSpec[] {
  const notes: ExplanationSpec[] = [];

  if (typicalPrice !== undefined && it.option.price < typicalPrice) {
    notes.push({
      key: "results.expl.belowTypical",
      params: { currency: space.currency, amount: Math.round(typicalPrice - it.option.price) },
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

function bestScore(it: VerifiedItinerary): number {
  const durationHours = it.option.total_duration_min / 60;
  return it.option.price + BEST_SCORE_DURATION_COST_PER_HOUR * durationHours;
}

export function rank(space: SearchSpace, itineraries: VerifiedItinerary[]): RankedItinerary[] {
  // "Typical fare" = median of this search's own results per destination
  // (explicitly a within-search comparison, not a market claim).
  const byDest = new Map<string, number[]>();
  for (const it of itineraries) {
    const prices = byDest.get(it.destination.key) ?? [];
    prices.push(it.option.price);
    byDest.set(it.destination.key, prices);
  }
  const typical = new Map<string, number>();
  for (const [dest, prices] of byDest) {
    typical.set(dest, [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)]);
  }

  const ranked: RankedItinerary[] = itineraries.map((it) => ({
    verifiedItinerary: it,
    bestScore: bestScore(it),
    explanations: explanationsFor(it, space, typical.get(it.destination.key)),
  }));

  ranked.sort((a, b) => a.bestScore - b.bestScore);
  return ranked;
}
