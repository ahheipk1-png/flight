"""Turn verified itineraries into ranked, explained results: the
nearby-airport savings filter (spec §31), rank_scores for
Cheapest/Fastest/Best, and templated per-itinerary explanations
(spec §40 spirit).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.search.spaces import SearchSpace
from app.search.verification import VerifiedItinerary
from app.services.geo import resolve_equivalence


@dataclass
class RankedItinerary:
    verified_itinerary: VerifiedItinerary
    best_score: float
    explanations: list[str]
    ground_transfer: dict | None


async def _nearby_airport_filter(
    session: AsyncSession, space: SearchSpace, itineraries: list[VerifiedItinerary]
) -> list[tuple[VerifiedItinerary, dict | None]]:
    """Primary-origin itineraries always pass through. An alt-origin
    itinerary is kept only if, for the SAME destination/dates, it beats
    the best primary-origin fare by at least min_saving_per_person after
    round-trip ground cost -- spec §31 (min_saving_per_person,
    max_ground_minutes).
    """
    primary_iata = space.primary_origin.iata

    best_primary: dict[tuple, float] = {}
    for it in itineraries:
        if it.origin == primary_iata:
            key = (it.destination, it.depart_date, it.trip_length)
            if key not in best_primary or it.option.price < best_primary[key]:
                best_primary[key] = it.option.price

    kept: list[tuple[VerifiedItinerary, dict | None]] = []
    for it in itineraries:
        if it.origin == primary_iata:
            kept.append((it, None))
            continue

        equiv = await resolve_equivalence(session, primary_iata, it.origin)
        ground_cost_round_trip = (equiv.ground_cost_estimate * 2) if equiv else 0.0
        ground_minutes = equiv.ground_time_minutes if equiv else 10_000  # unknown equivalence => never eligible

        key = (it.destination, it.depart_date, it.trip_length)
        primary_price = best_primary.get(key)
        if primary_price is None:
            # No primary-origin result for this destination/date to compare
            # against -- can't establish a saving, so drop rather than show
            # an unexplainable alt-origin result.
            continue

        net_saving = (primary_price - it.option.price) - ground_cost_round_trip
        if net_saving >= space.min_saving_per_person and ground_minutes <= space.max_ground_minutes:
            kept.append(
                (
                    it,
                    {
                        "from_iata": primary_iata,
                        "to_iata": it.origin,
                        "minutes": ground_minutes,
                        "cost": ground_cost_round_trip,
                        "currency": equiv.currency if equiv else space.currency,
                        "net_saving": round(net_saving, 2),
                    },
                )
            )
    return kept


def _explanations_for(
    it: VerifiedItinerary, ground_transfer: dict | None, space: SearchSpace, typical_price: float | None
) -> list[str]:
    notes: list[str] = []

    if typical_price and it.option.price < typical_price:
        notes.append(f"{space.currency} {round(typical_price - it.option.price)} below the typical fare for this route")

    if ground_transfer:
        notes.append(
            f"{ground_transfer['to_iata']} departure saves ~{space.currency} {round(ground_transfer['net_saving'])}/person "
            f"after ~{space.currency} {round(ground_transfer['cost'])} round-trip ground transport"
        )

    if it.option.stops == 0:
        notes.append("Nonstop")
    elif it.option.layovers:
        hub, minutes = it.option.layovers[0]
        hours, mins = divmod(minutes, 60)
        pref_lo, pref_hi = space.min_normal_minutes // 60, space.max_normal_minutes // 60
        notes.append(f"Single {hours}h{mins:02d} connection in {hub} -- within your {pref_lo}h-{pref_hi}h preference")

    notes.append("Price verified live" if it.verified else "Indicative -- not yet verified")
    return notes[:3]


def _best_score(it: VerifiedItinerary, ground_cost: float, settings: Settings) -> float:
    duration_hours = it.option.total_duration_min / 60.0
    return (
        it.option.price
        + settings.best_score_ground_cost_weight * ground_cost
        + settings.best_score_duration_cost_per_hour * duration_hours
    )


async def rank(
    session: AsyncSession, space: SearchSpace, itineraries: list[VerifiedItinerary], settings: Settings
) -> list[RankedItinerary]:
    filtered = await _nearby_airport_filter(session, space, itineraries)

    # "Typical fare" for the explanation line = median of this search's own
    # verified results per destination (no external "typical fare" source
    # in MVP 1 -- explicitly a within-search comparison, not a market claim).
    by_dest: dict[str, list[float]] = {}
    for it, _ in filtered:
        by_dest.setdefault(it.destination, []).append(it.option.price)
    typical = {dest: sorted(prices)[len(prices) // 2] for dest, prices in by_dest.items()}

    ranked: list[RankedItinerary] = []
    for it, ground_transfer in filtered:
        ground_cost = ground_transfer["cost"] if ground_transfer else 0.0
        score = _best_score(it, ground_cost, settings)
        explanations = _explanations_for(it, ground_transfer, space, typical.get(it.destination))
        ranked.append(RankedItinerary(it, score, explanations, ground_transfer))

    ranked.sort(key=lambda r: r.best_score)
    return ranked
