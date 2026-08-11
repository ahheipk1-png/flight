"""Prune the coarse grid to promising (destination, date, trip-length)
neighborhoods, then expand each into every origin/metro-airport
combination -- spec §27 steps 2-3.

Candidates are grouped by (destination, depart_date, trip_length), and
pruning keeps or drops a GROUP as a whole -- it never lets one origin
survive while its group-mates get cut. That pairing is what lets
verification (verification.py) and ranking (ranking.py) compare a
primary-origin price against an alt-origin price for the exact same
trip; the nearby-airport savings logic (spec §31) has nothing to compare
against if pruning let one side drop independently of the other.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.search.candidates import Cell
from app.search.spaces import SearchSpace
from app.services.geo import get_metro_siblings
from app.services.indicative import estimate

# Lower = more specific/trustworthy. Mirrors services/indicative.py's
# resolution order; used to break coarse-cell price ties (see
# prune_and_expand's best_per_destination comment below).
_SOURCE_RANK = {"observation_exact": 0, "observation_nearest": 1, "baseline": 2}


@dataclass
class Candidate:
    origin: str
    destination: str
    depart_date: dt.date
    trip_length: int
    estimated_price: float
    estimate_source: str

    @property
    def return_date(self) -> dt.date:
        return self.depart_date + dt.timedelta(days=self.trip_length)


@dataclass
class CandidateGroup:
    """Every origin-airport variant of the same (destination, depart_date,
    trip_length) trip, kept together so later stages can always compare
    like-for-like across origins.
    """

    destination: str
    depart_date: dt.date
    trip_length: int
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def _best_candidate(self) -> Candidate:
        return min(self.candidates, key=lambda c: c.estimated_price)

    @property
    def best_price(self) -> float:
        return self._best_candidate.estimated_price

    @property
    def sort_key(self) -> tuple[float, int]:
        """(price, specificity) -- see the module-level tie-break comment
        in prune_and_expand for why price alone isn't enough here.
        """
        best = self._best_candidate
        return (best.estimated_price, _SOURCE_RANK[best.estimate_source])


async def prune_and_expand(
    session: AsyncSession, space: SearchSpace, coarse_cells: list[Cell], settings: Settings
) -> list[CandidateGroup]:
    if not coarse_cells:
        return []

    # One seed slot per destination (its cheapest coarse date), so a
    # single cheap destination can't hog every neighborhood slot.
    #
    # Tie-break by estimate specificity, not just insertion order: tier 2
    # of indicative.estimate() projects a single nearby observation flatly
    # across its whole +/-10-day window (no distance decay when there's
    # only one candidate), so a real deal on one exact date can make
    # several neighboring coarse dates tie at the same price. Preferring
    # the more specific source on ties anchors the seed -- and therefore
    # prune_and_expand's expansion window -- on the actual deal date
    # instead of an arbitrary same-priced neighbor that may be too far
    # away for the window to still reach the real one.
    best_per_destination: dict[str, Cell] = {}
    for cell in coarse_cells:
        current = best_per_destination.get(cell.destination)
        if current is None or (cell.estimated_price, _SOURCE_RANK[cell.estimate_source]) < (
            current.estimated_price, _SOURCE_RANK[current.estimate_source]
        ):
            best_per_destination[cell.destination] = cell

    seed_cells = sorted(best_per_destination.values(), key=lambda c: c.estimated_price)[: settings.prune_top_cells]

    groups: dict[tuple[str, dt.date, int], CandidateGroup] = {}
    metro_cache: dict[str, list[str]] = {}

    for seed in seed_cells:
        if seed.destination not in metro_cache:
            siblings = await get_metro_siblings(session, seed.destination)
            metro_cache[seed.destination] = [a.iata for a in siblings] or [seed.destination]
        metro_iatas = metro_cache[seed.destination]

        window_dates = [
            d
            for offset in range(-settings.coarse_expand_window_days, settings.coarse_expand_window_days + 1)
            if space.departure_from <= (d := seed.depart_date + dt.timedelta(days=offset)) <= space.departure_to
        ]

        for dest_iata in metro_iatas:
            for depart in window_dates:
                for trip_length in range(space.trip_length_min, space.trip_length_max + 1):
                    group_key = (dest_iata, depart, trip_length)
                    group = groups.get(group_key)
                    if group is None:
                        group = CandidateGroup(destination=dest_iata, depart_date=depart, trip_length=trip_length)
                        groups[group_key] = group

                    already_priced = {c.origin for c in group.candidates}
                    for origin in space.origin_airports:
                        if origin.iata in already_priced:
                            continue  # overlapping seed windows can revisit the same group
                        return_date = depart + dt.timedelta(days=trip_length)
                        price, source = await estimate(
                            session, origin.iata, dest_iata, depart, return_date, trip_type=space.trip_type
                        )
                        group.candidates.append(
                            Candidate(
                                origin=origin.iata, destination=dest_iata, depart_date=depart,
                                trip_length=trip_length, estimated_price=price, estimate_source=source,
                            )
                        )

    # Same tie-break rationale as best_per_destination above, one level
    # deeper: with sparse observations, many groups in a window can tie on
    # best_price (tier 2's flat projection again), and price-only sorting
    # would let insertion/date order silently decide which "wins" -- so
    # sort on (price, specificity) instead.
    all_groups = sorted(groups.values(), key=lambda g: g.sort_key)

    # prune_max_candidates is a budget on total (origin x date x length)
    # candidates; translate it into a group cap so the per-group pairing
    # invariant above is preserved all the way through.
    origins_in_play = max(1, len(space.origin_airports))
    max_groups = max(1, settings.prune_max_candidates // origins_in_play)

    ceiling = space.max_total * settings.prune_overshoot_ratio
    within_budget = [g for g in all_groups if g.best_price <= ceiling]
    # A tight ceiling that filters everything out would silently starve
    # verification -- fall back to the full (still price-sorted) list
    # rather than returning nothing.
    survivors = within_budget if within_budget else all_groups
    return survivors[:max_groups]
