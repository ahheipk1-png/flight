from __future__ import annotations

import datetime as dt

from pydantic import BaseModel


class AirportRef(BaseModel):
    iata: str
    name: str
    city: str
    lat: float
    lon: float


class LegOut(BaseModel):
    from_iata: str
    to_iata: str
    dep_time: dt.datetime
    arr_time: dt.datetime
    carrier: str
    flight_number: str
    duration_min: int


class GroundTransferOut(BaseModel):
    from_iata: str
    to_iata: str
    minutes: int
    cost: float
    currency: str


class ItineraryOut(BaseModel):
    id: str
    origin: AirportRef
    destination: AirportRef
    depart_date: dt.date
    return_date: dt.date
    trip_length: int
    fare: float
    currency: str
    stops: int
    total_duration_min: int
    legs: list[LegOut]
    layovers: list[tuple[str, int]]
    carriers: list[str]
    verified: bool
    ground_transfer: GroundTransferOut | None
    # Manual multi-city only: the intermediate leg endpoints in order (not
    # including the final destination, which is already `destination`
    # above). None for round-trip/one-way. Kept separate from `layovers`,
    # which means same-flight connections, not deliberate city stops.
    city_stops: list[AirportRef] | None = None
    explanations: list[str]
    # Precomputed sort keys so the frontend's ranking tabs re-sort
    # client-side with no refetch (spec: tabs never trigger a new search).
    rank_scores: dict[str, float]
