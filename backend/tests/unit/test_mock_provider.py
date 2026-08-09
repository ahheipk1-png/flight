from __future__ import annotations

import datetime as dt

from app.providers.base import FareQuery
from app.providers.mock import ORIGIN_FACTOR, MockFareProvider

provider = MockFareProvider()


async def test_same_query_is_byte_for_byte_deterministic():
    query = FareQuery(origin="YYZ", destination="KIX", depart_date=dt.date(2026, 9, 18), return_date=dt.date(2026, 10, 2))
    first = await provider.search_round_trip(query)
    second = await provider.search_round_trip(query)

    assert [o.price for o in first] == [o.price for o in second]
    assert [o.stops for o in first] == [o.stops for o in second]
    assert [o.total_duration_min for o in first] == [o.total_duration_min for o in second]
    assert [o.carriers for o in first] == [o.carriers for o in second]
    assert [o.layovers for o in first] == [o.layovers for o in second]


async def test_different_dates_change_price():
    q1 = FareQuery(origin="YYZ", destination="KIX", depart_date=dt.date(2026, 9, 18), return_date=dt.date(2026, 10, 2))
    q2 = FareQuery(origin="YYZ", destination="KIX", depart_date=dt.date(2026, 11, 5), return_date=dt.date(2026, 11, 19))
    p1 = (await provider.search_round_trip(q1))[0].price
    p2 = (await provider.search_round_trip(q2))[0].price
    assert p1 != p2


async def test_max_stops_zero_excludes_connections():
    query = FareQuery(
        origin="YYZ", destination="KIX", depart_date=dt.date(2026, 9, 18), return_date=dt.date(2026, 10, 2), max_stops=0
    )
    options = await provider.search_round_trip(query)
    assert options
    assert all(o.stops == 0 for o in options)


async def test_options_are_sorted_by_price_ascending():
    query = FareQuery(origin="YYZ", destination="TPE", depart_date=dt.date(2026, 9, 20), return_date=dt.date(2026, 10, 4))
    options = await provider.search_round_trip(query)
    prices = [o.price for o in options]
    assert prices == sorted(prices)


async def test_origin_factor_ordering_makes_buf_and_yhm_the_cheap_pulls():
    # This is the mechanism the nearby-airport savings logic (spec §31)
    # relies on: secondary airports must be able to pull the price down.
    assert ORIGIN_FACTOR["BUF"] < ORIGIN_FACTOR["YHM"] < ORIGIN_FACTOR["YKF"] < ORIGIN_FACTOR["YYZ"] < ORIGIN_FACTOR["YTZ"]


async def test_secondary_airport_average_price_is_below_yyz():
    # Statistical sanity check across many dates -- individual dates can go
    # either way once noise is added, but the average must reflect the
    # origin_factor gap. See test above for the deterministic mechanism.
    depart_dates = [dt.date(2026, 9, 1) + dt.timedelta(days=7 * i) for i in range(12)]
    yyz_total = yhm_total = 0.0
    for depart in depart_dates:
        ret = depart + dt.timedelta(days=14)
        yyz_total += (await provider.search_round_trip(FareQuery("YYZ", "TPE", depart, ret)))[0].price
        yhm_total += (await provider.search_round_trip(FareQuery("YHM", "TPE", depart, ret)))[0].price
    assert yhm_total < yyz_total


async def test_adults_multiplies_price_linearly():
    # Each call rounds its own full-precision result once, independently,
    # so two vs. one*2 can legitimately differ by a rounding cent -- assert
    # near-equality, not bit-exact equality.
    depart, ret = dt.date(2026, 9, 18), dt.date(2026, 10, 2)
    one = (await provider.search_round_trip(FareQuery("YYZ", "KIX", depart, ret, adults=1)))[0].price
    two = (await provider.search_round_trip(FareQuery("YYZ", "KIX", depart, ret, adults=2)))[0].price
    assert abs(two - one * 2) < 0.02
