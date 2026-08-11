from __future__ import annotations

import datetime as dt

from app.providers.base import FareQuery, MultiCityLeg
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


# ---------- one-way ----------


def _one_way_query(**overrides) -> FareQuery:
    base = dict(
        origin="YYZ", destination="KIX", depart_date=dt.date(2026, 9, 18), return_date=dt.date(2026, 9, 18),
        trip_type="one_way",
    )
    base.update(overrides)
    return FareQuery(**base)


async def test_one_way_is_deterministic():
    query = _one_way_query()
    first = await provider.search_one_way(query)
    second = await provider.search_one_way(query)
    assert [o.price for o in first] == [o.price for o in second]


async def test_one_way_options_have_no_slices_and_are_cheaper_than_round_trip():
    # A one-way fare should land well below the round-trip price for the
    # same route/depart-date pair -- not just "different", genuinely lower,
    # since ONE_WAY_PRICE_FACTOR < 1 and there's no return leg to price in.
    one_way = (await provider.search_one_way(_one_way_query()))[0]
    round_trip = (
        await provider.search_round_trip(
            FareQuery("YYZ", "KIX", dt.date(2026, 9, 18), dt.date(2026, 10, 2))
        )
    )[0]
    assert one_way.slices == ()
    assert one_way.price < round_trip.price


async def test_one_way_max_stops_zero_excludes_connections():
    options = await provider.search_one_way(_one_way_query(max_stops=0))
    assert options
    assert all(o.stops == 0 for o in options)


async def test_one_way_options_sorted_by_price():
    options = await provider.search_one_way(_one_way_query(destination="TPE"))
    prices = [o.price for o in options]
    assert prices == sorted(prices)


# ---------- manual multi-city ----------


def _legs(*pairs: tuple[str, str, dt.date]) -> list[MultiCityLeg]:
    return [MultiCityLeg(origin=o, destination=d, date=date) for o, d, date in pairs]


async def test_multi_city_returns_exactly_one_combined_option():
    legs = _legs(("YYZ", "IST", dt.date(2026, 9, 10)), ("IST", "BKK", dt.date(2026, 9, 15)))
    options = await provider.search_multi_city(legs)
    assert len(options) == 1


async def test_multi_city_is_deterministic():
    legs = _legs(("YYZ", "IST", dt.date(2026, 9, 10)), ("IST", "BKK", dt.date(2026, 9, 15)))
    first = (await provider.search_multi_city(legs))[0]
    second = (await provider.search_multi_city(legs))[0]
    assert first.price == second.price
    assert first.slices == second.slices


async def test_more_legs_costs_more():
    # Not bit-exact-equal to a sum of independent search_one_way() calls --
    # the per-leg RNG is consumed in a different sequence inside
    # search_multi_city than inside a standalone search_one_way call, so
    # prices legitimately differ slightly -- but adding a third leg must
    # still increase the total meaningfully, since it's strictly more
    # flying priced off the same per-leg formula.
    two_leg = (await provider.search_multi_city(_legs(("YYZ", "IST", dt.date(2026, 9, 10)), ("IST", "BKK", dt.date(2026, 9, 15)))))[0]
    three_leg = (
        await provider.search_multi_city(
            _legs(
                ("YYZ", "IST", dt.date(2026, 9, 10)),
                ("IST", "BKK", dt.date(2026, 9, 15)),
                ("BKK", "SIN", dt.date(2026, 9, 20)),
            )
        )
    )[0]
    assert three_leg.price > two_leg.price


async def test_multi_city_slices_stay_separate_from_layovers_for_long_gaps():
    # The whole point of FareSlice: a multi-day gap between IST and BKK
    # legs must never show up as a single connection-duration violation --
    # each slice's own layovers (same-flight connections only) are what
    # verification.passes_hard_constraints actually checks per-slice.
    legs = _legs(("YYZ", "IST", dt.date(2026, 9, 10)), ("IST", "BKK", dt.date(2026, 9, 15)))
    combined = (await provider.search_multi_city(legs))[0]
    for sl in combined.slices:
        for _iata, minutes in sl.layovers:
            assert minutes < 24 * 60, "a same-flight layover should never span a full day in mock data"


async def test_multi_city_three_legs_builds_three_slices():
    legs = _legs(
        ("YYZ", "IST", dt.date(2026, 9, 10)),
        ("IST", "BKK", dt.date(2026, 9, 15)),
        ("BKK", "SIN", dt.date(2026, 9, 20)),
    )
    combined = (await provider.search_multi_city(legs))[0]
    assert len(combined.slices) == 3
    assert combined.outbound_legs[0].from_iata == "YYZ"
    assert combined.outbound_legs[-1].to_iata == "SIN"
