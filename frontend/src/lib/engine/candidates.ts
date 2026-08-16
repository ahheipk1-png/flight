// Coarse candidate grid: one slot per (destination group, strided date),
// midpoint trip length. Never the full grid -- pruning.ts expands a
// window around whichever slots look most promising.

import { COARSE_DATE_STRIDE_DAYS } from "./constants";
import { addDaysIso, stridedDates } from "./dates";
import { estimate } from "./indicative";
import type { Candidate, SearchSpace } from "./types";

export function generateCoarse(space: SearchSpace): Candidate[] {
  const midpointLength = Math.floor((space.tripLengthMin + space.tripLengthMax) / 2);
  const dates = stridedDates(space.departureFrom, space.departureTo, COARSE_DATE_STRIDE_DAYS);

  const candidates: Candidate[] = [];
  for (const dest of space.destinationGroups) {
    for (const depart of dates) {
      const returnDate = addDaysIso(depart, midpointLength);
      const [price, source] = estimate(space.originGroup, dest.joined, depart, returnDate, space.tripType, space.passengers);
      candidates.push({
        destination: dest,
        departDate: depart,
        tripLength: midpointLength,
        estimatedPrice: price,
        estimateSource: source,
      });
    }
  }
  return candidates;
}
