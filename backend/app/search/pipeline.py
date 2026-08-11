"""Orchestrates spec §26's pipeline end to end and builds the response
shape the frontend needs (itineraries + map-geometry inputs + explanations).
The optional on_stage callback lets jobs.py narrate progress into Redis
without duplicating this flow.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.geo import Airport
from app.providers.base import FareProvider
from app.schemas.itinerary import AirportRef, GroundTransferOut, ItineraryOut, LegOut
from app.schemas.search import SearchRequest
from app.search.candidates import generate_coarse
from app.search.pruning import prune_and_expand
from app.search.ranking import rank
from app.search.spaces import parse_request
from app.search.verification import verify_top

StageCallback = Callable[[str], Awaitable[None]]


async def _airport_ref(session: AsyncSession, iata: str, cache: dict[str, Airport]) -> AirportRef:
    if iata not in cache:
        airport = (await session.execute(select(Airport).where(Airport.iata == iata))).scalar_one()
        cache[iata] = airport
    a = cache[iata]
    return AirportRef(iata=a.iata, name=a.name, city=a.city, lat=a.lat, lon=a.lon)


async def run_search(
    session: AsyncSession,
    req: SearchRequest,
    settings: Settings | None = None,
    *,
    on_stage: StageCallback | None = None,
    provider: FareProvider | None = None,
) -> dict:
    settings = settings or get_settings()

    async def stage(name: str) -> None:
        if on_stage:
            await on_stage(name)

    await stage("generating")
    space = await parse_request(session, req)
    coarse = await generate_coarse(session, space, settings)

    await stage("pruning")
    candidate_groups = await prune_and_expand(session, space, coarse, settings)

    await stage("verifying")
    verified, degraded = await verify_top(session, space, candidate_groups, settings, provider=provider)

    await stage("ranking")
    ranked = await rank(session, space, verified, settings)

    airport_cache: dict[str, Airport] = {}
    itineraries: list[ItineraryOut] = []
    for idx, r in enumerate(ranked):
        it = r.verified_itinerary
        origin_ref = await _airport_ref(session, it.origin, airport_cache)
        dest_ref = await _airport_ref(session, it.destination, airport_cache)

        legs = [
            LegOut(
                from_iata=l.from_iata, to_iata=l.to_iata, dep_time=l.dep_time, arr_time=l.arr_time,
                carrier=l.carrier, flight_number=l.flight_number, duration_min=l.duration_min,
            )
            for l in it.option.outbound_legs
        ]

        ground = None
        if r.ground_transfer:
            gt = r.ground_transfer
            ground = GroundTransferOut(
                from_iata=gt["from_iata"], to_iata=gt["to_iata"], minutes=gt["minutes"],
                cost=gt["cost"], currency=gt["currency"],
            )

        itineraries.append(
            ItineraryOut(
                id=f"it-{idx}",
                origin=origin_ref,
                destination=dest_ref,
                depart_date=it.depart_date,
                return_date=it.return_date,
                trip_length=it.trip_length,
                fare=it.option.price,
                currency=it.option.currency,
                stops=it.option.stops,
                total_duration_min=it.option.total_duration_min,
                legs=legs,
                layovers=list(it.option.layovers),
                carriers=list(it.option.carriers),
                verified=it.verified,
                ground_transfer=ground,
                explanations=r.explanations,
                rank_scores={
                    "cheapest": it.option.price,
                    "fastest": float(it.option.total_duration_min),
                    "best": r.best_score,
                },
            )
        )

    return {
        "itineraries": itineraries,
        "degraded": degraded,
        "candidate_count": sum(len(g.candidates) for g in candidate_groups),
        "candidate_group_count": len(candidate_groups),
        "coarse_count": len(coarse),
    }
