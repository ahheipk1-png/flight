from __future__ import annotations

from pydantic import BaseModel


class TravelRegionOut(BaseModel):
    code: str
    name: str
    kind: str


class MetroAreaOut(BaseModel):
    code: str
    name: str
    country: str
    lat: float
    lon: float


class AirportOut(BaseModel):
    iata: str
    icao: str | None
    name: str
    city: str
    country: str
    lat: float
    lon: float
    tz: str
    metro: str
    region: str
    is_metro_primary: bool
    is_origin_candidate: bool
    is_origin_default: bool


class MetaResponse(BaseModel):
    travel_regions: list[TravelRegionOut]
    metro_areas: list[MetroAreaOut]
    airports: list[AirportOut]
    origin_group: list[str]  # IATA codes with is_origin_candidate=true (Greater Toronto)
