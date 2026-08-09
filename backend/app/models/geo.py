"""Geography models -- spec §29 subset needed for MVP 1.

No PostGIS-specific column types are used yet (plain lat/lon floats).
The `postgis` extension is still created in migration 0001 so that a
later GET /api/airports/nearby (radius query, post-MVP-1) is additive
rather than a schema rework.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class TravelRegion(Base):
    __tablename__ = "travel_regions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    # "origin" (currently just Greater Toronto) or "destination"
    kind: Mapped[str] = mapped_column(String(20))

    airports: Mapped[list["Airport"]] = relationship(back_populates="travel_region")


class MetroArea(Base):
    __tablename__ = "metro_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(2))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)

    airports: Mapped[list["Airport"]] = relationship(back_populates="metro_area")


class Airport(Base):
    __tablename__ = "airports"

    id: Mapped[int] = mapped_column(primary_key=True)
    iata: Mapped[str] = mapped_column(String(3), unique=True, index=True)
    icao: Mapped[str | None] = mapped_column(String(4), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    city: Mapped[str] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(2))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    tz: Mapped[str] = mapped_column(String(60))

    metro_area_id: Mapped[int] = mapped_column(ForeignKey("metro_areas.id"))
    travel_region_id: Mapped[int] = mapped_column(ForeignKey("travel_regions.id"))

    is_metro_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_origin_candidate: Mapped[bool] = mapped_column(Boolean, default=False)
    is_origin_default: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    metro_area: Mapped[MetroArea] = relationship(back_populates="airports")
    travel_region: Mapped[TravelRegion] = relationship(back_populates="airports")


class AirportEquivalence(Base):
    """Stored once per unordered pair (airport_a.iata < airport_b.iata).
    Resolve via services.geo.resolve_equivalence(), which checks both
    directions so callers never have to think about storage order.
    """

    __tablename__ = "airport_equivalence"
    __table_args__ = (UniqueConstraint("airport_a_id", "airport_b_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    airport_a_id: Mapped[int] = mapped_column(ForeignKey("airports.id"))
    airport_b_id: Mapped[int] = mapped_column(ForeignKey("airports.id"))
    ground_time_minutes: Mapped[int] = mapped_column()
    ground_cost_estimate: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    same_metro: Mapped[bool] = mapped_column(Boolean, default=False)
    same_travel_region: Mapped[bool] = mapped_column(Boolean, default=False)

    airport_a: Mapped[Airport] = relationship(foreign_keys=[airport_a_id])
    airport_b: Mapped[Airport] = relationship(foreign_keys=[airport_b_id])
