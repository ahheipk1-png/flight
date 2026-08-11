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
from app.providers.base import FareLeg, FareOption, FareProvider, FareQuery, FareSlice, MultiCityLeg
from app.providers.budget import BudgetExhausted, BudgetGuard
from app.providers.factory import get_fare_provider
from app.redis import RedisLike, get_redis


def _cache_key(provider_name: str, query: FareQuery) -> str:
    return (
        f"fare:v1:{provider_name}:{query.trip_type}:{query.origin}:{query.destination}:"
        f"{query.depart_date.isoformat()}:{query.return_date.isoformat()}:"
        f"{query.currency}:{query.max_stops}"
    )


def _multi_city_cache_key(
    provider_name: str, legs: list[MultiCityLeg], *, currency: str, max_stops: int | None
) -> str:
    leg_material = "|".join(f"{leg.origin}:{leg.destination}:{leg.date.isoformat()}" for leg in legs)
    digest = hashlib.sha256(leg_material.encode()).hexdigest()[:16]
    return f"fare:v1:{provider_name}:multi_city:{digest}:{currency}:{max_stops}"


def _enc_legs(legs: tuple[FareLeg, ...]) -> list[dict]:
    return [
        {
            "from_iata": l.from_iata,
            "to_iata": l.to_iata,
            "dep_time": l.dep_time.isoformat(),
            "arr_time": l.arr_time.isoformat(),
            "carrier": l.carrier,
            "flight_number": l.flight_number,
            "duration_min": l.duration_min,
        }
        for l in legs
    ]


def _dec_legs(data: list[dict]) -> tuple[FareLeg, ...]:
    return tuple(
        FareLeg(
            from_iata=l["from_iata"],
            to_iata=l["to_iata"],
            dep_time=dt.datetime.fromisoformat(l["dep_time"]),
            arr_time=dt.datetime.fromisoformat(l["arr_time"]),
            carrier=l["carrier"],
            flight_number=l["flight_number"],
            duration_min=l["duration_min"],
        )
        for l in data
    )


def _serialize(options: list[FareOption]) -> str:
    def enc(o: FareOption) -> dict:
        return {
            "price": o.price,
            "currency": o.currency,
            "outbound_legs": _enc_legs(o.outbound_legs),
            "layovers": list(o.layovers),
            "total_duration_min": o.total_duration_min,
            "stops": o.stops,
            "carriers": list(o.carriers),
            "inbound_detail": o.inbound_detail,
            "slices": [
                {
                    "legs": _enc_legs(sl.legs),
                    "layovers": list(sl.layovers),
                    "stops": sl.stops,
                    "duration_min": sl.duration_min,
                }
                for sl in o.slices
            ],
        }

    return json.dumps([enc(o) for o in options])


def _deserialize(payload: str) -> list[FareOption]:
    data = json.loads(payload)
    options: list[FareOption] = []
    for d in data:
        options.append(
            FareOption(
                price=d["price"],
                currency=d["currency"],
                outbound_legs=_dec_legs(d["outbound_legs"]),
                layovers=tuple(tuple(x) for x in d["layovers"]),
                total_duration_min=d["total_duration_min"],
                stops=d["stops"],
                carriers=tuple(d["carriers"]),
                inbound_detail=d["inbound_detail"],
                raw={},
                slices=tuple(
                    FareSlice(
                        legs=_dec_legs(sl["legs"]),
                        layovers=tuple(tuple(x) for x in sl["layovers"]),
                        stops=sl["stops"],
                        duration_min=sl["duration_min"],
                    )
                    for sl in d.get("slices", [])
                ),
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
                trip_type=query.trip_type,
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

    An explicitly-passed `provider` (the normal path now -- every real
    /api/search call passes the caller's own per-user provider, built from
    their stored key; see api/deps.py) skips the site-wide BudgetGuard
    entirely: that guard exists to protect the SITE OWNER's spend on the
    site's own default provider, and doesn't apply to a user spending
    their own key/quota. It still applies when no provider is passed (the
    CLI `probe` command and any other site-wide-default caller), and the
    call is still cache-checked and audit-logged either way.
    """
    settings = settings or get_settings()
    redis = redis or get_redis()
    explicit_provider = provider is not None
    provider = provider or get_fare_provider(settings)

    key = _cache_key(provider.name, query)

    if not force_refresh:
        cached = await redis.get(key)
        if cached is not None:
            payload = cached.decode() if isinstance(cached, (bytes, bytearray)) else cached
            return _deserialize(payload), False

    if provider.name != "mock":
        if not explicit_provider:
            guard = BudgetGuard.for_provider(provider.name, redis, settings)
            try:
                await guard.try_reserve()
            except BudgetExhausted:
                return [], True
        await _log_api_call(session, provider.name, key)

    options = (
        await provider.search_one_way(query)
        if query.trip_type == "one_way"
        else await provider.search_round_trip(query)
    )

    ttl = settings.fare_cache_ttl_verified if kind == "verified" else settings.fare_cache_ttl_discovery
    if not options:
        ttl = settings.fare_cache_ttl_empty
    await redis.set(key, _serialize(options), ex=ttl)

    if options:
        await _record_observations(session, query, options, provider.name, kind)

    return options, False


async def search_multi_city_cached(
    session: AsyncSession,
    legs: list[MultiCityLeg],
    *,
    adults: int = 1,
    currency: str = "CAD",
    max_stops: int | None = None,
    settings: Settings | None = None,
    redis: RedisLike | None = None,
    provider: FareProvider | None = None,
) -> tuple[list[FareOption], bool]:
    """Manual multi-city's counterpart to search_cached -- same Redis TTL +
    ApiCallLog audit discipline, adapted for an ordered leg list instead of
    a single FareQuery (there's no single origin/destination/date pair to
    key on). Deliberately does NOT write fare_observations: that table
    backs services/indicative.py's cold-start estimation for the flexible
    round-trip/one-way pipeline, which manual multi-city never goes
    through (search/pipeline.py's run_multi_city_search calls this
    directly, skipping generate_coarse/prune_and_expand entirely).

    Returns (options, degraded) -- same meaning as search_cached.
    """
    settings = settings or get_settings()
    redis = redis or get_redis()
    explicit_provider = provider is not None
    provider = provider or get_fare_provider(settings)

    key = _multi_city_cache_key(provider.name, legs, currency=currency, max_stops=max_stops)

    cached = await redis.get(key)
    if cached is not None:
        payload = cached.decode() if isinstance(cached, (bytes, bytearray)) else cached
        return _deserialize(payload), False

    if provider.name != "mock":
        if not explicit_provider:
            guard = BudgetGuard.for_provider(provider.name, redis, settings)
            try:
                await guard.try_reserve()
            except BudgetExhausted:
                return [], True
        await _log_api_call(session, provider.name, key)

    options = await provider.search_multi_city(legs, adults=adults, currency=currency, max_stops=max_stops)

    ttl = settings.fare_cache_ttl_verified
    if not options:
        ttl = settings.fare_cache_ttl_empty
    await redis.set(key, _serialize(options), ex=ttl)

    return options, False


async def budget_status(settings: Settings | None = None, redis: RedisLike | None = None) -> dict:
    settings = settings or get_settings()
    redis = redis or get_redis()
    return await BudgetGuard.for_provider(settings.effective_fare_provider, redis, settings).status()
