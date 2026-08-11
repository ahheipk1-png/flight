"""Fare/observation models -- spec §29. fare_observations doubles as the
indicative-fare store (services/indicative.py reads from it before
falling back to the static route_baselines.json floor).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FareObservation(Base):
    __tablename__ = "fare_observations"
    __table_args__ = (
        Index("ix_fare_obs_route_dates", "origin", "destination", "departure_date", "return_date"),
        Index("ix_fare_obs_route_recency", "origin", "destination", "observed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    origin: Mapped[str] = mapped_column(String(3), index=True)
    destination: Mapped[str] = mapped_column(String(3), index=True)
    departure_date: Mapped[dt.date]
    return_date: Mapped[dt.date]
    trip_length: Mapped[int] = mapped_column(Integer)
    # "round_trip" | "one_way". One-way rows store return_date ==
    # departure_date (trip_length 0) as a sentinel -- this column is what
    # keeps that from being confused with a genuine same-day round trip
    # when services/indicative.py looks up price history.
    trip_type: Mapped[str] = mapped_column(String(20), default="round_trip")
    cabin: Mapped[str] = mapped_column(String(20), default="economy")
    fare: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    seller_id: Mapped[str | None] = mapped_column(String(120), nullable=True)  # no FK (spec §29)
    provider: Mapped[str] = mapped_column(String(20))  # "mock" | "serpapi"
    kind: Mapped[str] = mapped_column(String(20))  # "discovery" | "verified"
    observed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    # Generic JSON (portable across SQLite/Postgres); carriers, layovers,
    # price_insights, etc. Swap to postgresql.JSONB once fully on Postgres.
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class ApiCallLog(Base):
    """Durable audit trail backing the budget guard (providers/budget.py).
    Redis counters are the fast path; this table is what a human checks.
    """

    __tablename__ = "api_call_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))
    params_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
