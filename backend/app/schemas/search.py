from __future__ import annotations

import datetime as dt

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
    trip_length_min: int = Field(default=10, ge=1)
    trip_length_max: int = Field(default=16, ge=1)

    @model_validator(mode="after")
    def _check_ranges(self) -> "DatePrefs":
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
    def _check_layover_window(self) -> "ConnectionPrefs":
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
