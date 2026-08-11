"""Indicative fare estimation -- the resolution order that lets a
SerpApi-backed deployment (no "anywhere" endpoint) bootstrap flexible
destination discovery from cold start and improve as fare_observations
accumulates.

Resolution order:
  1. A fare_observations row for the exact (origin, destination, depart,
     return) no older than INDICATIVE_MAX_AGE_DAYS.
  2. The nearest-date observation(s) on the same route within
     +/-NEAREST_DATE_WINDOW_DAYS, distance-weighted.
  3. The static data/seed/route_baselines.json floor.

Tiers 1-2 are already origin-airport-specific (fare_observations rows are
keyed on the exact origin). Tier 3 is NOT -- route_baselines.json is keyed
by origin *metro* only, since Toronto-region airports share one metro. If
tier 3 ignored the airport entirely, every origin in the group would look
identical at cold start, which starves either the primary or the
alternates out of search/pruning.py's price-sorted survivor list before
they ever reach verification -- silently breaking the nearby-airport
savings feature (spec §31) on a fresh database. ORIGIN_FACTOR (shared
with the mock provider's simulated market) is applied so cold-start
estimates already reflect known airport-level pricing patterns.

All three tiers are also trip_type-scoped (round_trip vs one_way, see
providers/base.py) -- tiers 1-2 filter fare_observations by it so a
one-way price never answers a round-trip query for the same route/dates
or vice versa, and tier 3 applies ONE_WAY_FACTOR to the (round-trip-only)
baseline table. That flat factor is a known, accepted approximation: real
one-way/round-trip price ratios vary by route (competitive short-haul
routes often price near 50%, some long-haul/legacy-carrier routes well
above it), so a single constant can't capture that variance. It only
matters at cold start, though -- same multiplier applies to every date for
a given destination, so within-destination date ranking (what
search/pruning.py actually needs) is unaffected, and tiers 1-2 self-heal
as real one-way observations accumulate, same as ORIGIN_FACTOR already
does today.
"""

from __future__ import annotations

import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import SEED_DIR
from app.models.fares import FareObservation
from app.providers.base import TripType
from app.providers.mock import ORIGIN_FACTOR

INDICATIVE_MAX_AGE_DAYS = 7
NEAREST_DATE_WINDOW_DAYS = 10
GENERIC_FALLBACK_CAD = 1100.0
# Cold-start-only approximation applied to the round-trip baseline table --
# see module docstring.
ONE_WAY_FACTOR = 0.6

_BASELINES: dict[str, float] | None = None


def _baseline(origin_metro: str, destination: str) -> float | None:
    global _BASELINES
    if _BASELINES is None:
        with (SEED_DIR / "route_baselines.json").open("r", encoding="utf-8") as f:
            data = json.load(f)
        _BASELINES = data.get(origin_metro, {})
    return _BASELINES.get(destination)


async def estimate(
    session: AsyncSession,
    origin: str,
    destination: str,
    depart_date: dt.date,
    return_date: dt.date,
    *,
    trip_type: TripType = "round_trip",
    origin_metro: str = "toronto",
    now: dt.datetime | None = None,
) -> tuple[float, str]:
    """Returns (estimated_cad_price, source), source one of
    "observation_exact" | "observation_nearest" | "baseline".
    """
    now = now or dt.datetime.now(dt.UTC)

    cutoff = now - dt.timedelta(days=INDICATIVE_MAX_AGE_DAYS)
    exact = (
        (
            await session.execute(
                select(FareObservation)
                .where(
                    FareObservation.origin == origin,
                    FareObservation.destination == destination,
                    FareObservation.departure_date == depart_date,
                    FareObservation.return_date == return_date,
                    FareObservation.trip_type == trip_type,
                    FareObservation.observed_at >= cutoff,
                )
                .order_by(FareObservation.observed_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if exact is not None:
        return exact.fare, "observation_exact"

    window_lo = depart_date - dt.timedelta(days=NEAREST_DATE_WINDOW_DAYS)
    window_hi = depart_date + dt.timedelta(days=NEAREST_DATE_WINDOW_DAYS)
    candidates = (
        (
            await session.execute(
                select(FareObservation).where(
                    FareObservation.origin == origin,
                    FareObservation.destination == destination,
                    FareObservation.trip_type == trip_type,
                    FareObservation.departure_date >= window_lo,
                    FareObservation.departure_date <= window_hi,
                )
            )
        )
        .scalars()
        .all()
    )
    if candidates:
        weighted_sum = 0.0
        weight_total = 0.0
        for obs in candidates:
            distance_days = abs((obs.departure_date - depart_date).days)
            weight = 1.0 / (1.0 + distance_days)
            weighted_sum += obs.fare * weight
            weight_total += weight
        if weight_total > 0:
            return round(weighted_sum / weight_total, 2), "observation_nearest"

    origin_factor = ORIGIN_FACTOR.get(origin, 1.0)
    baseline = _baseline(origin_metro, destination)
    base_price = baseline if baseline is not None else GENERIC_FALLBACK_CAD
    price = base_price * origin_factor
    if trip_type == "one_way":
        price *= ONE_WAY_FACTOR
    return round(price, 2), "baseline"
