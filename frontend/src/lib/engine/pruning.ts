// Prune the coarse grid to promising neighborhoods, then expand each into
// every origin/metro-airport combination -- port of
// backend/app/search/pruning.py, including its two tie-break rules.
//
// Candidates are grouped by (destination, departDate, tripLength) and
// pruning keeps or drops a GROUP whole -- it never lets one origin survive
// while its group-mates get cut. That pairing is what lets verification
// and ranking compare a primary-origin price against an alt-origin price
// for the exact same trip.

import { COARSE_EXPAND_WINDOW_DAYS, PRUNE_MAX_CANDIDATES, PRUNE_OVERSHOOT_RATIO, PRUNE_TOP_CELLS } from "./constants";
import { addDaysIso } from "./dates";
import { getMetroSiblings } from "./geo";
import { estimate } from "./indicative";
import type { Candidate, CandidateGroup, Cell, EstimateSource, SearchSpace } from "./types";

// Lower = more specific/trustworthy; mirrors indicative.ts's resolution
// order. Used to break price ties so a real deal's exact date anchors the
// expansion window instead of an arbitrary same-priced neighbor (tier 2
// projects a single nearby observation flatly across its whole window).
const SOURCE_RANK: Record<EstimateSource, number> = {
  observation_exact: 0,
  observation_nearest: 1,
  baseline: 2,
};

function groupBestKey(group: CandidateGroup): [number, number] {
  // Price-only min with first-wins ties, exactly like Python's
  // min(candidates, key=price) -- the source-rank tie-break applies to
  // ordering GROUPS against each other, not to picking a group's own
  // best candidate.
  const best = group.candidates.reduce((a, b) => (b.estimatedPrice < a.estimatedPrice ? b : a));
  return [best.estimatedPrice, SOURCE_RANK[best.estimateSource]];
}

export function groupBestPrice(group: CandidateGroup): number {
  return Math.min(...group.candidates.map((c) => c.estimatedPrice));
}

export function pruneAndExpand(space: SearchSpace, coarseCells: Cell[]): CandidateGroup[] {
  if (coarseCells.length === 0) return [];

  // One seed slot per destination (its cheapest coarse date, ties broken
  // by estimate specificity) so one cheap destination can't hog every
  // neighborhood slot.
  const bestPerDestination = new Map<string, Cell>();
  for (const cell of coarseCells) {
    const current = bestPerDestination.get(cell.destination);
    if (
      !current ||
      cell.estimatedPrice < current.estimatedPrice ||
      (cell.estimatedPrice === current.estimatedPrice &&
        SOURCE_RANK[cell.estimateSource] < SOURCE_RANK[current.estimateSource])
    ) {
      bestPerDestination.set(cell.destination, cell);
    }
  }

  const seedCells = [...bestPerDestination.values()]
    .sort((a, b) => a.estimatedPrice - b.estimatedPrice)
    .slice(0, PRUNE_TOP_CELLS);

  const groups = new Map<string, CandidateGroup>();

  for (const seed of seedCells) {
    const siblings = getMetroSiblings(seed.destination);
    const metroIatas = siblings.length > 0 ? siblings.map((a) => a.iata) : [seed.destination];

    const windowDates: string[] = [];
    for (let offset = -COARSE_EXPAND_WINDOW_DAYS; offset <= COARSE_EXPAND_WINDOW_DAYS; offset++) {
      const d = addDaysIso(seed.departDate, offset);
      if (d >= space.departureFrom && d <= space.departureTo) windowDates.push(d);
    }

    for (const destIata of metroIatas) {
      for (const depart of windowDates) {
        for (let tripLength = space.tripLengthMin; tripLength <= space.tripLengthMax; tripLength++) {
          const groupKey = `${destIata}|${depart}|${tripLength}`;
          let group = groups.get(groupKey);
          if (!group) {
            group = { destination: destIata, departDate: depart, tripLength, candidates: [] };
            groups.set(groupKey, group);
          }

          const alreadyPriced = new Set(group.candidates.map((c) => c.origin));
          for (const origin of space.originAirports) {
            if (alreadyPriced.has(origin.iata)) continue; // overlapping seed windows revisit groups
            const returnDate = addDaysIso(depart, tripLength);
            const [price, source] = estimate(origin.iata, destIata, depart, returnDate, space.tripType);
            group.candidates.push({
              origin: origin.iata,
              destination: destIata,
              departDate: depart,
              tripLength,
              estimatedPrice: price,
              estimateSource: source,
            } satisfies Candidate);
          }
        }
      }
    }
  }

  const allGroups = [...groups.values()].sort((a, b) => {
    const [pa, ra] = groupBestKey(a);
    const [pb, rb] = groupBestKey(b);
    return pa - pb || ra - rb;
  });

  // PRUNE_MAX_CANDIDATES budgets total (origin x date x length)
  // candidates; translate into a group cap so the pairing invariant holds.
  const originsInPlay = Math.max(1, space.originAirports.length);
  const maxGroups = Math.max(1, Math.floor(PRUNE_MAX_CANDIDATES / originsInPlay));

  const ceiling = space.maxTotal * PRUNE_OVERSHOOT_RATIO;
  const withinBudget = allGroups.filter((g) => groupBestPrice(g) <= ceiling);
  // A tight ceiling that filters everything would silently starve
  // verification -- fall back to the full price-sorted list instead.
  const survivors = withinBudget.length > 0 ? withinBudget : allGroups;
  return survivors.slice(0, maxGroups);
}
