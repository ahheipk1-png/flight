from __future__ import annotations

import datetime as dt

import pytest
from pydantic import ValidationError

from app.schemas.search import SearchRequest
from app.search.spaces import parse_request


def _base_request(**overrides) -> SearchRequest:
    body = {
        "destination": {"regions": ["japan"]},
        "dates": {"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10)},
        "budget": {"max_total": 1500},
    }
    body.update(overrides)
    return SearchRequest(**body)


async def test_default_max_ground_minutes_excludes_buf(seeded_session):
    space = await parse_request(seeded_session, _base_request())
    assert space.primary_origin.iata == "YYZ"
    assert {a.iata for a in space.origin_airports} == {"YYZ", "YTZ", "YHM", "YKF"}
    assert "BUF" not in {a.iata for a in space.alternate_origins}


async def test_raising_max_ground_minutes_includes_buf(seeded_session):
    space = await parse_request(seeded_session, _base_request(origin={"max_ground_minutes": 200}))
    assert "BUF" in {a.iata for a in space.origin_airports}


async def test_tightening_max_ground_minutes_excludes_more_alternates(seeded_session):
    # YHM's ground time is 70 min (see data/seed/airport_equivalence.json) --
    # a 60-minute cap should drop it too, leaving only YYZ/YTZ/YKF.
    space = await parse_request(seeded_session, _base_request(origin={"max_ground_minutes": 60}))
    assert {a.iata for a in space.origin_airports} == {"YYZ", "YTZ", "YKF"}


async def test_destination_primaries_are_metro_primary_only(seeded_session):
    space = await parse_request(seeded_session, _base_request())
    assert {a.iata for a in space.destination_primaries} == {"HND", "KIX"}
    assert {a.iata for a in space.destination_airports} == {"HND", "NRT", "KIX", "ITM", "UKB"}


async def test_multiple_regions_union_destination_airports(seeded_session):
    space = await parse_request(seeded_session, _base_request(destination={"regions": ["taiwan", "hong_kong"]}))
    assert {a.iata for a in space.destination_airports} == {"TPE", "HKG"}


async def test_trip_type_defaults_to_round_trip(seeded_session):
    space = await parse_request(seeded_session, _base_request())
    assert space.trip_type == "round_trip"


async def test_trip_type_one_way_passes_through(seeded_session):
    req = _base_request(
        dates={"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10), "trip_length_min": 0, "trip_length_max": 0},
        trip_type="one_way",
    )
    space = await parse_request(seeded_session, req)
    assert space.trip_type == "one_way"
    assert space.trip_length_min == 0
    assert space.trip_length_max == 0


def test_one_way_with_nonzero_trip_length_is_rejected():
    # Server-side enforcement of the sentinel convention -- never trust
    # the frontend alone to send trip_length 0/0 for a one-way request.
    with pytest.raises(ValidationError):
        _base_request(
            dates={"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10), "trip_length_min": 5, "trip_length_max": 5},
            trip_type="one_way",
        )


def test_round_trip_with_zero_trip_length_is_rejected():
    # The 0/0 sentinel is reserved for one_way -- a round trip must not be
    # able to collide with it.
    with pytest.raises(ValidationError):
        _base_request(
            dates={"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10), "trip_length_min": 0, "trip_length_max": 0},
            trip_type="round_trip",
        )
