"""services/fares.py's cache-key/caching/audit discipline, with a focus
on the collision this feature's plan flagged: before trip_type was added
to _cache_key, a one-way and round-trip FareQuery with identical
origin/destination/dates would collide on the same Redis key.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select

from app.db import session_scope
from app.models.fares import ApiCallLog, FareObservation
from app.providers.base import FareOption, FareQuery, MultiCityLeg
from app.providers.mock import mock_provider
from app.services.fares import _cache_key, _multi_city_cache_key, search_cached, search_multi_city_cached

DEPART = dt.date(2026, 9, 18)
RETURN = dt.date(2026, 10, 2)


class _FakeProvider:
    """Mimics a real (non-mock) provider so search_multi_city_cached's
    ApiCallLog audit path -- which the mock provider deliberately never
    triggers -- is actually exercised.
    """

    name = "duffel"

    async def search_multi_city(self, legs, *, adults=1, currency="CAD", max_stops=None):
        return [
            FareOption(
                price=999.0, currency=currency, outbound_legs=(), layovers=(),
                total_duration_min=0, stops=0, carriers=(),
            )
        ]


def test_cache_key_differs_between_one_way_and_round_trip_for_identical_dates():
    round_trip_query = FareQuery("YYZ", "KIX", DEPART, RETURN, trip_type="round_trip")
    one_way_query = FareQuery("YYZ", "KIX", DEPART, RETURN, trip_type="one_way")

    assert _cache_key("mock", round_trip_query) != _cache_key("mock", one_way_query)


def test_multi_city_cache_key_differs_by_leg_order():
    legs_a = [MultiCityLeg("YYZ", "IST", dt.date(2026, 9, 10)), MultiCityLeg("IST", "BKK", dt.date(2026, 9, 15))]
    legs_b = [MultiCityLeg("YYZ", "BKK", dt.date(2026, 9, 10)), MultiCityLeg("BKK", "IST", dt.date(2026, 9, 15))]

    assert _multi_city_cache_key("mock", legs_a, currency="CAD", max_stops=None) != _multi_city_cache_key(
        "mock", legs_b, currency="CAD", max_stops=None
    )


async def test_one_way_query_dispatches_to_search_one_way_not_round_trip(seeded_session):
    query = FareQuery("YYZ", "KIX", DEPART, DEPART, trip_type="one_way")
    round_trip_query = FareQuery("YYZ", "KIX", DEPART, RETURN, trip_type="round_trip")

    one_way_options, degraded = await search_cached(seeded_session, query, kind="verified", provider=mock_provider)
    round_trip_options, _ = await search_cached(seeded_session, round_trip_query, kind="verified", provider=mock_provider)

    assert not degraded
    assert one_way_options and round_trip_options
    # mock's one-way formula has no nights factor and a < 1 price multiplier
    # -- the two paths must produce genuinely different results, proving
    # search_one_way (not search_round_trip) was actually called.
    assert one_way_options[0].price != round_trip_options[0].price
    assert one_way_options[0].slices == ()


async def test_one_way_and_round_trip_do_not_share_a_cache_entry(seeded_session):
    query = FareQuery("YYZ", "KIX", DEPART, RETURN, trip_type="round_trip")
    one_way_query = FareQuery("YYZ", "KIX", DEPART, RETURN, trip_type="one_way")

    round_trip_options, _ = await search_cached(seeded_session, query, kind="verified", provider=mock_provider)
    one_way_options, _ = await search_cached(seeded_session, one_way_query, kind="verified", provider=mock_provider)

    assert round_trip_options[0].price != one_way_options[0].price


async def test_multi_city_search_is_cached_on_repeat_call(seeded_session):
    legs = [MultiCityLeg("YYZ", "IST", dt.date(2026, 9, 10)), MultiCityLeg("IST", "BKK", dt.date(2026, 9, 15))]

    first, degraded1 = await search_multi_city_cached(seeded_session, legs, provider=mock_provider)
    second, degraded2 = await search_multi_city_cached(seeded_session, legs, provider=mock_provider)

    assert not degraded1 and not degraded2
    assert [o.price for o in first] == [o.price for o in second]


async def test_multi_city_search_writes_no_fare_observations(seeded_session):
    # Deliberate: fare_observations backs services/indicative.py's
    # cold-start estimation, which manual multi-city never goes through.
    legs = [MultiCityLeg("YYZ", "IST", dt.date(2026, 9, 10)), MultiCityLeg("IST", "BKK", dt.date(2026, 9, 15))]
    await search_multi_city_cached(seeded_session, legs, provider=mock_provider)

    rows = (await seeded_session.execute(select(FareObservation))).scalars().all()
    assert rows == []


async def test_multi_city_search_is_audit_logged():
    # mock provider never hits ApiCallLog (see search_cached's own
    # `if provider.name != "mock"` gate) -- _FakeProvider proves the
    # multi-city path logs the same way a real provider call would.
    legs = [MultiCityLeg("YYZ", "IST", dt.date(2026, 9, 10)), MultiCityLeg("IST", "BKK", dt.date(2026, 9, 15))]
    async with session_scope() as session:
        await search_multi_city_cached(session, legs, provider=_FakeProvider())
        rows = (await session.execute(select(ApiCallLog).where(ApiCallLog.provider == "duffel"))).scalars().all()
        assert len(rows) == 1
