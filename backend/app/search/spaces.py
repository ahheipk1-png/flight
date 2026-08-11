"""SearchSpace resolution: turn a SearchRequest into concrete origin
airports, destination airports, and date/length ranges -- spec §26 step 1.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.geo import Airport
from app.providers.base import TripType
from app.schemas.search import SearchRequest
from app.services.geo import get_destination_airports, get_origin_group, resolve_equivalence


@dataclass
class SearchSpace:
    primary_origin: Airport
    origin_airports: list[Airport]  # primary + eligible alternates (within max_ground_minutes)
    alternate_origins: list[Airport]
    destination_airports: list[Airport]  # every airport across the requested regions
    destination_primaries: list[Airport]  # metro-primary only, for the coarse pass
    trip_type: TripType
    departure_from: dt.date
    departure_to: dt.date
    trip_length_min: int
    trip_length_max: int
    max_stops: int
    min_normal_minutes: int
    max_normal_minutes: int
    max_total: float
    currency: str
    adults: int
    max_ground_minutes: int
    min_saving_per_person: float


async def parse_request(session: AsyncSession, req: SearchRequest) -> SearchSpace:
    origin_candidates = await get_origin_group(session, req.origin.region)
    if not origin_candidates:
        raise ValueError(f"No origin airports configured for region {req.origin.region!r}")

    primary = next((a for a in origin_candidates if a.is_origin_default and a.iata == "YYZ"), None)
    if primary is None:
        primary = next((a for a in origin_candidates if a.is_origin_default), origin_candidates[0])

    alternates: list[Airport] = []
    for airport in origin_candidates:
        if airport.id == primary.id:
            continue
        equiv = await resolve_equivalence(session, primary.iata, airport.iata)
        # An alternate with no equivalence row, or one whose ground time
        # exceeds the requested tolerance, is dropped here -- this is also
        # where BUF gets excluded at the default 120-minute setting.
        if equiv is not None and equiv.ground_time_minutes <= req.origin.max_ground_minutes:
            alternates.append(airport)

    destination_all = await get_destination_airports(session, req.destination.regions)
    if not destination_all:
        raise ValueError(f"No destination airports found for regions {req.destination.regions!r}")
    destination_primaries = await get_destination_airports(session, req.destination.regions, primary_only=True)

    return SearchSpace(
        primary_origin=primary,
        origin_airports=[primary, *alternates],
        alternate_origins=alternates,
        destination_airports=destination_all,
        destination_primaries=destination_primaries,
        trip_type=req.trip_type,
        departure_from=req.dates.departure_from,
        departure_to=req.dates.departure_to,
        trip_length_min=req.dates.trip_length_min,
        trip_length_max=req.dates.trip_length_max,
        max_stops=req.connections.max_stops,
        min_normal_minutes=req.connections.min_normal_minutes,
        max_normal_minutes=req.connections.max_normal_minutes,
        max_total=req.budget.max_total,
        currency=req.budget.currency,
        adults=req.adults,
        max_ground_minutes=req.origin.max_ground_minutes,
        min_saving_per_person=req.origin.min_saving_per_person,
    )
