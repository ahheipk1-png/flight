"""Provider-agnostic fare types and the FareProvider protocol. Every
fare source (mock, SerpApi, and any later addition -- Duffel,
Travelpayouts, ...) speaks this shape so the search pipeline never
branches on which provider is active.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class FareQuery:
    origin: str
    destination: str
    depart_date: dt.date
    return_date: dt.date
    adults: int = 1
    currency: str = "CAD"
    max_stops: int | None = None


@dataclass(frozen=True)
class FareLeg:
    from_iata: str
    to_iata: str
    dep_time: dt.datetime
    arr_time: dt.datetime
    carrier: str
    flight_number: str
    duration_min: int


@dataclass(frozen=True)
class FareOption:
    price: float
    currency: str
    outbound_legs: tuple[FareLeg, ...]
    layovers: tuple[tuple[str, int], ...]  # (airport_iata, minutes)
    total_duration_min: int
    stops: int
    carriers: tuple[str, ...]
    # SerpApi only gives full itinerary detail for the outbound leg without
    # a second (paid) departure_token call; the return is priced but not
    # leg-by-leg. Mock provider always returns "full".
    inbound_detail: str = "indicative"  # "indicative" | "full"
    raw: dict = field(default_factory=dict)


class FareProvider(Protocol):
    name: str

    async def search_round_trip(self, query: FareQuery) -> list[FareOption]: ...
