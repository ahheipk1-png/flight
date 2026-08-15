// Coarse candidate grid -- port of backend/app/search/candidates.py.
// Primary origin only, one metro-primary airport per destination metro,
// dates strided every COARSE_DATE_STRIDE_DAYS, midpoint trip length.
// Never the full grid.

import { COARSE_DATE_STRIDE_DAYS } from "./constants";
import { addDaysIso, stridedDates } from "./dates";
import { estimate } from "./indicative";
import type { Cell, SearchSpace } from "./types";

export function generateCoarse(space: SearchSpace): Cell[] {
  const midpointLength = Math.floor((space.tripLengthMin + space.tripLengthMax) / 2);
  const dates = stridedDates(space.departureFrom, space.departureTo, COARSE_DATE_STRIDE_DAYS);

  const cells: Cell[] = [];
  for (const dest of space.destinationPrimaries) {
    for (const depart of dates) {
      const returnDate = addDaysIso(depart, midpointLength);
      const [price, source] = estimate(space.primaryOrigin.iata, dest.iata, depart, returnDate, space.tripType);
      cells.push({
        origin: space.primaryOrigin.iata,
        destination: dest.iata,
        departDate: depart,
        tripLength: midpointLength,
        estimatedPrice: price,
        estimateSource: source,
      });
    }
  }
  return cells;
}
