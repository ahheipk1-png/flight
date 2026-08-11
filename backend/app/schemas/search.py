from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class OriginPrefs(BaseModel):
    region: str = "greater_toronto"
    max_ground_minutes: int = 120
    min_saving_per_person: float = 100.0


class DestinationPrefs(BaseModel):
    regions: list[str] = Field(min_length=1)


class DatePrefs(BaseModel):
    departure_from: dt.date
    departure_to: dt.date
    # ge=0 (not ge=1) so a one-way request can send the trip_length=0
    # sentinel (see search/spaces.py); SearchRequest._check_trip_type
    # below is what actually enforces 0 is only valid for trip_type
    # "one_way" -- these fields alone can't see trip_type to check that.
    trip_length_min: int = Field(default=10, ge=0)
    trip_length_max: int = Field(default=16, ge=0)

    @model_validator(mode="after")
    def _check_ranges(self) -> DatePrefs:
        if self.departure_to < self.departure_from:
            raise ValueError("dates.departure_to must not be before dates.departure_from")
        if self.trip_length_max < self.trip_length_min:
            raise ValueError("dates.trip_length_max must not be less than dates.trip_length_min")
        return self


class BudgetPrefs(BaseModel):
    currency: str = "CAD"
    max_total: float = Field(gt=0)


class ConnectionPrefs(BaseModel):
    max_stops: int = Field(default=1, ge=0)
    min_normal_minutes: int = Field(default=120, ge=0)
    max_normal_minutes: int = Field(default=300, ge=0)

    @model_validator(mode="after")
    def _check_layover_window(self) -> ConnectionPrefs:
        if self.max_normal_minutes < self.min_normal_minutes:
            raise ValueError("connections.max_normal_minutes must not be less than min_normal_minutes")
        return self


class SearchRequest(BaseModel):
    origin: OriginPrefs = Field(default_factory=OriginPrefs)
    destination: DestinationPrefs
    dates: DatePrefs
    budget: BudgetPrefs
    connections: ConnectionPrefs = Field(default_factory=ConnectionPrefs)
    adults: int = Field(default=1, ge=1)
    trip_type: Literal["round_trip", "one_way"] = "round_trip"

    @model_validator(mode="after")
    def _check_trip_type(self) -> SearchRequest:
        # Server-side enforcement of the one-way sentinel convention --
        # never trust the frontend alone to send trip_length 0/0.
        if self.trip_type == "one_way":
            if self.dates.trip_length_min != 0 or self.dates.trip_length_max != 0:
                raise ValueError("dates.trip_length_min/max must both be 0 when trip_type is one_way")
        elif self.dates.trip_length_min < 1:
            raise ValueError("dates.trip_length_min must be at least 1 for a round trip")
        return self


class MultiCityLegPref(BaseModel):
    destination: str = Field(min_length=3, max_length=3)
    date: dt.date


class MultiCitySearchRequest(BaseModel):
    """Deliberately separate from SearchRequest: manual multi-city has no
    single destination or flexible date window to speak of -- the user
    picks every leg explicitly -- so origin.max_ground_minutes/
    min_saving_per_person (nearby-airport-savings) and destination.regions
    don't apply here. Always departs the resolved primary Toronto airport.
    Note: this is unrelated to the spec's own (unbuilt) MVP-3 "multi-city
    stopover generation" concept, which auto-*proposes* a stopover on an
    ordinary round trip rather than taking explicit user-chosen legs.
    """

    legs: list[MultiCityLegPref] = Field(min_length=2, max_length=6)
    budget: BudgetPrefs
    connections: ConnectionPrefs = Field(default_factory=ConnectionPrefs)
    adults: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def _check_leg_dates(self) -> MultiCitySearchRequest:
        dates = [leg.date for leg in self.legs]
        if dates != sorted(dates) or len(set(dates)) != len(dates):
            raise ValueError("legs[].date must be strictly increasing")
        return self
