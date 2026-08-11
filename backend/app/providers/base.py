"""Provider-agnostic fare types and the FareProvider protocol. Every
fare source (mock, SerpApi, and any later addition -- Duffel,
Travelpayouts, ...) speaks this shape so the search pipeline never
branches on which provider is active.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Literal, Protocol

TripType = Literal["round_trip", "one_way"]


@dataclass(frozen=True)
class FareQuery:
    origin: str
    destination: str
    depart_date: dt.date
    return_date: dt.date
    adults: int = 1
    currency: str = "CAD"
    max_stops: int | None = None
    # Appended with a default so existing positional call sites
    # (FareQuery("YYZ", "TPE", depart, ret)) keep working unchanged.
    # "one_way" queries still carry return_date == depart_date (see
    # search/spaces.py) -- trip_type is what disambiguates that sentinel
    # from a genuine same-day round trip; never infer one_way from date
    # equality.
    trip_type: TripType = "round_trip"


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
class FareSlice:
    """One leg of a manual multi-city itinerary -- e.g. YYZ->IST is one
    slice, IST->BKK the next. Each slice's own connections are validated
    against the connection-comfort window (verification.py) same as any
    round-trip option; the deliberate gap BETWEEN slices (a multi-day city
    stop) never enters that check -- it's a different concept from a
    same-flight layover, not a same-flight layover that happens to be long.
    """

    legs: tuple[FareLeg, ...]
    layovers: tuple[tuple[str, int], ...]
    stops: int
    duration_min: int


@dataclass(frozen=True)
class MultiCityLeg:
    origin: str
    destination: str
    date: dt.date


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
    # Populated only by search_multi_city, one entry per user-chosen leg;
    # empty for round-trip/one-way, where outbound_legs/layovers/stops
    # above are already the whole story. See FareSlice for why this can't
    # just reuse layovers.
    slices: tuple[FareSlice, ...] = ()


class FareProvider(Protocol):
    name: str

    async def search_round_trip(self, query: FareQuery) -> list[FareOption]: ...
    async def search_one_way(self, query: FareQuery) -> list[FareOption]: ...
    async def search_multi_city(
        self,
        legs: list[MultiCityLeg],
        *,
        adults: int = 1,
        currency: str = "CAD",
        max_stops: int | None = None,
    ) -> list[FareOption]: ...
