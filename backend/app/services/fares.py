"""Cache + budget orchestration sitting between the search pipeline and a
FareProvider. Distinguishes "discovery" vs "verified" calls, is the only
place that writes fare_observations (which doubles as the indicative-fare
store read by services/indicative.py), and is where a budget-exhausted
live provider degrades gracefully instead of raising.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.fares import ApiCallLog, FareObservation
from app.providers.base import FareLeg, FareOption, FareProvider, FareQuery
from app.providers.budget import BudgetExhausted, BudgetGuard
from app.providers.factory import get_fare_provider
from app.redis import RedisLike, get_redis


def _cache_key(provider_name: str, query: FareQuery) -> str:
    return (
        f"fare:v1:{provider_name}:{query.origin}:{query.destination}:"
        f"{query.depart_date.isoformat()}:{query.return_date.isoformat()}:"
        f"{query.currency}:{query.max_stops}"
    )


def _serialize(options: list[FareOption]) -> str:
    def enc(o: FareOption) -> dict:
        return {
            "price": o.price,
            "currency": o.currency,
            "outbound_legs": [
                {
                    "from_iata": l.from_iata,
                    "to_iata": l.to_iata,
                    "dep_time": l.dep_time.isoformat(),
                    "arr_time": l.arr_time.isoformat(),
                    "carrier": l.carrier,
                    "flight_number": l.flight_number,
                    "duration_min": l.duration_min,
                }
                for l in o.outbound_legs
            ],
            "layovers": list(o.layovers),
            "total_duration_min": o.total_duration_min,
            "stops": o.stops,
            "carriers": list(o.carriers),
            "inbound_detail": o.inbound_detail,
        }

    return json.dumps([enc(o) for o in options])


def _deserialize(payload: str) -> list[FareOption]:
    data = json.loads(payload)
    options: list[FareOption] = []
    for d in data:
        legs = tuple(
            FareLeg(
                from_iata=l["from_iata"],
                to_iata=l["to_iata"],
                dep_time=dt.datetime.fromisoformat(l["dep_time"]),
                arr_time=dt.datetime.fromisoformat(l["arr_time"]),
                carrier=l["carrier"],
                flight_number=l["flight_number"],
                duration_min=l["duration_min"],
            )
            for l in d["outbound_legs"]
        )
        options.append(
            FareOption(
                price=d["price"],
                currency=d["currency"],
                outbound_legs=legs,
                layovers=tuple(tuple(x) for x in d["layovers"]),
                total_duration_min=d["total_duration_min"],
                stops=d["stops"],
                carriers=tuple(d["carriers"]),
                inbound_detail=d["inbound_detail"],
                raw={},
            )
        )
    return options


async def _log_api_call(session: AsyncSession, provider_name: str, key_material: str) -> None:
    row = ApiCallLog(
        provider=provider_name,
        params_hash=hashlib.sha256(key_material.encode()).hexdigest()[:16],
        created_at=dt.datetime.utcnow(),
    )
    session.add(row)
    await session.commit()


async def _record_observations(
    session: AsyncSession, query: FareQuery, options: list[FareOption], provider_name: str, kind: str
) -> None:
    now = dt.datetime.now(dt.UTC)
    trip_length = (query.return_date - query.depart_date).days
    for o in options:
        session.add(
            FareObservation(
                origin=query.origin,
                destination=query.destination,
                departure_date=query.depart_date,
                return_date=query.return_date,
                trip_length=trip_length,
                cabin="economy",
                fare=o.price,
                currency=o.currency,
                seller_id=None,
                provider=provider_name,
                kind=kind,
                observed_at=now,
                extra={"stops": o.stops, "carriers": list(o.carriers), "total_duration_min": o.total_duration_min},
            )
        )
    await session.commit()


async def search_cached(
    session: AsyncSession,
    query: FareQuery,
    *,
    kind: str,  # "discovery" | "verified"
    settings: Settings | None = None,
    redis: RedisLike | None = None,
    provider: FareProvider | None = None,
    force_refresh: bool = False,
) -> tuple[list[FareOption], bool]:
    """Returns (options, degraded). degraded=True means the live budget
    was exhausted and nothing was fetched -- callers (search/verification.py)
    should fall back to services.indicative.estimate() and flag the result
    as unverified rather than surfacing an error.
    """
    settings = settings or get_settings()
    redis = redis or get_redis()
    provider = provider or get_fare_provider(settings)

    key = _cache_key(provider.name, query)

    if not force_refresh:
        cached = await redis.get(key)
        if cached is not None:
            payload = cached.decode() if isinstance(cached, (bytes, bytearray)) else cached
            return _deserialize(payload), False

    if provider.name == "serpapi":
        guard = BudgetGuard(redis, settings)
        try:
            await guard.try_reserve()
        except BudgetExhausted:
            return [], True
        await _log_api_call(session, provider.name, key)

    options = await provider.search_round_trip(query)

    ttl = settings.fare_cache_ttl_verified if kind == "verified" else settings.fare_cache_ttl_discovery
    if not options:
        ttl = settings.fare_cache_ttl_empty
    await redis.set(key, _serialize(options), ex=ttl)

    if options:
        await _record_observations(session, query, options, provider.name, kind)

    return options, False


async def budget_status(settings: Settings | None = None, redis: RedisLike | None = None) -> dict:
    settings = settings or get_settings()
    redis = redis or get_redis()
    return await BudgetGuard(redis, settings).status()
