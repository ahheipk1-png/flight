// Prune the coarse grid to promising neighborhoods, then expand each into
// every date/trip-length combination nearby. With origin and destination
// each collapsed to one already-optimized comma-joined airport group (see
// FareQuery), a "candidate" is just (destination group, date, trip
// length) -- no per-origin-variant pairing is needed anymore.

import { COARSE_EXPAND_WINDOW_DAYS, PRUNE_MAX_CANDIDATES, PRUNE_OVERSHOOT_RATIO, PRUNE_TOP_CELLS } from "./constants";
import { addDaysIso } from "./dates";
import { estimate } from "./indicative";
import type { Candidate, EstimateSource, SearchSpace } from "./types";

// Lower = more specific/trustworthy; mirrors indicative.ts's resolution
// order. A candidate with no signal at all (never priced, no history)
// ranks last -- it's neither promoted nor excluded, just untried.
const SOURCE_RANK: Record<EstimateSource | "none", number> = {
  observation_exact: 0,
  observation_nearest: 1,
  none: 2,
};

function rankOf(c: Pick<Candidate, "estimateSource">): number {
  return SOURCE_RANK[c.estimateSource ?? "none"];
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return 0; // both signal-less -- stable sort keeps input order
  return (a.estimatedPrice as number) - (b.estimatedPrice as number);
}

export function pruneAndExpand(space: SearchSpace, coarse: Candidate[]): Candidate[] {
  if (coarse.length === 0) return [];

  // One seed slot per destination group (its cheapest/most-recent coarse
  // date) so one cheap destination can't hog every neighborhood slot.
  const bestPerDestination = new Map<string, Candidate>();
  for (const c of coarse) {
    const current = bestPerDestination.get(c.destination.key);
    if (!current || compareCandidates(c, current) < 0) {
      bestPerDestination.set(c.destination.key, c);
    }
  }

  const seeds = [...bestPerDestination.values()].sort(compareCandidates).slice(0, PRUNE_TOP_CELLS);

  const seen = new Set<string>();
  const expanded: Candidate[] = [];

  for (const seed of seeds) {
    const windowDates: string[] = [];
    for (let offset = -COARSE_EXPAND_WINDOW_DAYS; offset <= COARSE_EXPAND_WINDOW_DAYS; offset++) {
      const d = addDaysIso(seed.departDate, offset);
      if (d >= space.departureFrom && d <= space.departureTo) windowDates.push(d);
    }

    for (const depart of windowDates) {
      for (let tripLength = space.tripLengthMin; tripLength <= space.tripLengthMax; tripLength++) {
        const key = `${seed.destination.key}|${depart}|${tripLength}`;
        if (seen.has(key)) continue; // overlapping seed windows revisit slots
        seen.add(key);

        const returnDate = addDaysIso(depart, tripLength);
        const [price, source] = estimate(
          space.originGroup,
          seed.destination.joined,
          depart,
          returnDate,
          space.tripType,
          space.passengers,
        );
        expanded.push({ destination: seed.destination, departDate: depart, tripLength, estimatedPrice: price, estimateSource: source });
      }
    }
  }

  expanded.sort(compareCandidates);

  // A budget ceiling only makes sense against a real price signal --
  // signal-less candidates always pass it rather than being excluded on
  // no basis.
  const ceiling = space.maxTotal * PRUNE_OVERSHOOT_RATIO;
  const withinBudget = expanded.filter((c) => c.estimatedPrice === null || c.estimatedPrice <= ceiling);
  // A tight ceiling that filters everything would silently starve
  // verification -- fall back to the full sorted list instead.
  const survivors = withinBudget.length > 0 ? withinBudget : expanded;
  return survivors.slice(0, PRUNE_MAX_CANDIDATES);
}
