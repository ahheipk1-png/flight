"""services/indicative.py's tiered fare estimation, with a focus on the
trip_type collision risk called out in this feature's plan: a one-way
price observation must never answer a round-trip estimate() call for the
same route/dates, and vice versa. Prior to this, estimate() had no
dedicated test file at all (only indirect coverage via test_pruning.py).
"""

from __future__ import annotations

import datetime as dt

from app.models.fares import FareObservation
from app.services.indicative import ONE_WAY_FACTOR, estimate

DEPART = dt.date(2026, 9, 5)
RETURN = dt.date(2026, 9, 18)


async def _plant(session, *, trip_type: str, fare: float, depart=DEPART, return_date=RETURN) -> None:
    session.add(
        FareObservation(
            origin="YYZ", destination="HND", departure_date=depart, return_date=return_date,
            trip_length=(return_date - depart).days, trip_type=trip_type,
            cabin="economy", fare=fare, currency="CAD", provider="mock", kind="discovery",
            observed_at=dt.datetime.now(dt.UTC),
        )
    )
    await session.commit()


async def test_exact_tier_is_trip_type_scoped(seeded_session):
    await _plant(seeded_session, trip_type="one_way", fare=300.0, return_date=DEPART)
    await _plant(seeded_session, trip_type="round_trip", fare=1200.0)

    one_way_price, one_way_source = await estimate(
        seeded_session, "YYZ", "HND", DEPART, DEPART, trip_type="one_way"
    )
    round_trip_price, round_trip_source = await estimate(
        seeded_session, "YYZ", "HND", DEPART, RETURN, trip_type="round_trip"
    )

    assert one_way_price == 300.0
    assert one_way_source == "observation_exact"
    assert round_trip_price == 1200.0
    assert round_trip_source == "observation_exact"


async def test_one_way_observation_does_not_answer_a_round_trip_query(seeded_session):
    # Same origin/destination/depart_date -- only trip_type differs. A
    # naive query without the trip_type filter would (wrongly) let this
    # one-way row answer a round-trip lookup for the same dates.
    await _plant(seeded_session, trip_type="one_way", fare=300.0, return_date=DEPART)

    price, source = await estimate(seeded_session, "YYZ", "HND", DEPART, RETURN, trip_type="round_trip")

    assert source != "observation_exact"
    assert price != 300.0


async def test_nearest_window_tier_is_also_trip_type_scoped(seeded_session):
    near_depart = DEPART + dt.timedelta(days=3)
    await _plant(seeded_session, trip_type="one_way", fare=250.0, depart=near_depart, return_date=near_depart)

    # A round-trip query for a nearby date must not pick up the planted
    # one-way observation via the nearest-date-window tier either.
    price, source = await estimate(seeded_session, "YYZ", "HND", DEPART, RETURN, trip_type="round_trip")

    assert source == "baseline"
    assert price != 250.0


async def test_one_way_cold_start_applies_one_way_factor(seeded_session):
    round_trip_price, round_trip_source = await estimate(
        seeded_session, "YYZ", "HND", DEPART, RETURN, trip_type="round_trip"
    )
    one_way_price, one_way_source = await estimate(
        seeded_session, "YYZ", "HND", DEPART, DEPART, trip_type="one_way"
    )

    assert round_trip_source == "baseline"
    assert one_way_source == "baseline"
    assert one_way_price == round(round_trip_price * ONE_WAY_FACTOR, 2)


async def test_one_way_date_ranking_is_preserved_under_the_flat_factor(seeded_session):
    # ONE_WAY_FACTOR is a single constant applied to every date for a given
    # destination -- a monotonic transform, so within-destination date
    # ranking (what search/pruning.py actually needs) must be unaffected.
    cheap_date = dt.date(2026, 3, 15)  # trough of the seasonal sine curve
    expensive_date = dt.date(2026, 6, 15)  # near the peak

    rt_cheap, _ = await estimate(seeded_session, "YYZ", "HND", cheap_date, cheap_date, trip_type="round_trip")
    rt_expensive, _ = await estimate(seeded_session, "YYZ", "HND", expensive_date, expensive_date, trip_type="round_trip")
    ow_cheap, _ = await estimate(seeded_session, "YYZ", "HND", cheap_date, cheap_date, trip_type="one_way")
    ow_expensive, _ = await estimate(seeded_session, "YYZ", "HND", expensive_date, expensive_date, trip_type="one_way")

    assert (rt_cheap < rt_expensive) == (ow_cheap < ow_expensive)
