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
from app.providers.base import FareProvider, MultiCityLeg
from app.schemas.itinerary import AirportRef, GroundTransferOut, ItineraryOut, LegOut
from app.schemas.search import MultiCitySearchRequest, SearchRequest
from app.search.candidates import generate_coarse
from app.search.pruning import prune_and_expand
from app.search.ranking import rank
from app.search.spaces import SearchSpace, parse_request
from app.search.verification import VerifiedItinerary, passes_hard_constraints, verify_top
from app.services import fares as fare_service
from app.services.geo import get_origin_group

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


async def run_multi_city_search(
    session: AsyncSession,
    req: MultiCitySearchRequest,
    settings: Settings | None = None,
    *,
    on_stage: StageCallback | None = None,
    provider: FareProvider | None = None,
) -> dict:
    """Manual multi-city's counterpart to run_search -- deliberately skips
    generate_coarse/prune_and_expand/indicative entirely (see this
    feature's plan doc): there's no flexible date window or destination
    region to discover across, just the N explicit legs the user typed.
    Always departs the resolved primary Toronto origin airport; no
    nearby-airport-savings logic for this mode (see schemas.search's
    MultiCitySearchRequest docstring).
    """
    settings = settings or get_settings()

    async def stage(name: str) -> None:
        if on_stage:
            await on_stage(name)

    await stage("verifying")

    origin_candidates = await get_origin_group(session, "greater_toronto")
    primary = next((a for a in origin_candidates if a.is_origin_default and a.iata == "YYZ"), None)
    if primary is None:
        primary = next((a for a in origin_candidates if a.is_origin_default), origin_candidates[0])

    airport_cache: dict[str, Airport] = {primary.iata: primary}
    leg_airports: list[Airport] = []
    for leg_pref in req.legs:
        airport = await _airport_or_none(session, leg_pref.destination)
        if airport is None:
            raise ValueError(f"Unknown destination airport {leg_pref.destination!r}")
        leg_airports.append(airport)
        airport_cache[airport.iata] = airport

    query_legs: list[MultiCityLeg] = []
    prior_iata = primary.iata
    for leg_pref, airport in zip(req.legs, leg_airports):
        query_legs.append(MultiCityLeg(origin=prior_iata, destination=airport.iata, date=leg_pref.date))
        prior_iata = airport.iata

    options, degraded = await fare_service.search_multi_city_cached(
        session,
        query_legs,
        adults=req.adults,
        currency=req.budget.currency,
        max_stops=req.connections.max_stops,
        settings=settings,
        provider=provider,
    )

    # A minimal SearchSpace covering only the fields passes_hard_constraints
    # and rank() actually read for this path (primary_origin, max_stops,
    # min/max_normal_minutes, max_total, currency) -- the rest (date
    # window, trip length, alt origins, destination regions) don't apply
    # to manual multi-city and are set to inert placeholders, never read
    # downstream of here.
    space = SearchSpace(
        primary_origin=primary,
        origin_airports=[primary],
        alternate_origins=[],
        destination_airports=leg_airports,
        destination_primaries=leg_airports,
        trip_type="round_trip",
        departure_from=req.legs[0].date,
        departure_to=req.legs[-1].date,
        trip_length_min=0,
        trip_length_max=0,
        max_stops=req.connections.max_stops,
        min_normal_minutes=req.connections.min_normal_minutes,
        max_normal_minutes=req.connections.max_normal_minutes,
        max_total=req.budget.max_total,
        currency=req.budget.currency,
        adults=req.adults,
        max_ground_minutes=0,
        min_saving_per_person=0.0,
    )

    verified: list[VerifiedItinerary] = [
        VerifiedItinerary(
            origin=primary.iata,
            destination=leg_airports[-1].iata,
            depart_date=req.legs[0].date,
            return_date=req.legs[-1].date,
            trip_length=0,
            option=option,
            verified=not degraded,
        )
        for option in options
        if passes_hard_constraints(option, space)
    ]

    await stage("ranking")
    ranked = await rank(session, space, verified, settings)

    city_stops = [await _airport_ref(session, a.iata, airport_cache) for a in leg_airports[:-1]]

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

        itineraries.append(
            ItineraryOut(
                id=f"mc-{idx}",
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
                ground_transfer=None,
                city_stops=city_stops,
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
        "candidate_count": len(options),
        "candidate_group_count": 1 if options else 0,
        "coarse_count": 0,
    }


async def _airport_or_none(session: AsyncSession, iata: str) -> Airport | None:
    return (await session.execute(select(Airport).where(Airport.iata == iata))).scalar_one_or_none()
