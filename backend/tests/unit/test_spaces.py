from __future__ import annotations

import datetime as dt

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
