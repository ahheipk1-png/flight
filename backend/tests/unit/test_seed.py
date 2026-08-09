from __future__ import annotations

from sqlalchemy import select

from app.models.geo import Airport, TravelRegion
from app.services.geo import get_origin_group, resolve_equivalence


async def test_every_destination_region_has_at_least_one_airport(seeded_session):
    regions = (await seeded_session.execute(select(TravelRegion).where(TravelRegion.kind == "destination"))).scalars().all()
    assert len(regions) == 14
    for region in regions:
        airports = (await seeded_session.execute(select(Airport).where(Airport.travel_region_id == region.id))).scalars().all()
        assert airports, f"region {region.code} has no airports"


async def test_toronto_origin_group_defaults_exclude_buf(seeded_session):
    all_candidates = await get_origin_group(seeded_session, "greater_toronto")
    defaults = await get_origin_group(seeded_session, "greater_toronto", only_default=True)

    assert {a.iata for a in all_candidates} == {"YYZ", "YTZ", "YHM", "YKF", "BUF"}
    assert {a.iata for a in defaults} == {"YYZ", "YTZ", "YHM", "YKF"}
    assert "BUF" not in {a.iata for a in defaults}


async def test_equivalence_resolves_both_directions(seeded_session):
    forward = await resolve_equivalence(seeded_session, "YYZ", "YHM")
    backward = await resolve_equivalence(seeded_session, "YHM", "YYZ")

    assert forward is not None
    assert forward.ground_time_minutes == 70
    assert forward.ground_cost_estimate == 35
    assert backward == forward


async def test_equivalence_missing_pair_returns_none(seeded_session):
    # KIX and LHR are never linked -- no cross-continent equivalence exists.
    result = await resolve_equivalence(seeded_session, "KIX", "LHR")
    assert result is None


async def test_same_airport_is_trivially_equivalent(seeded_session):
    result = await resolve_equivalence(seeded_session, "YYZ", "YYZ")
    assert result is not None
    assert result.ground_time_minutes == 0


async def test_seeding_twice_is_idempotent(seeded_session):
    from app.services.geo import seed_database

    counts = await seed_database(seeded_session)
    assert counts == {"travel_regions": 0, "metro_areas": 0, "airports": 0, "airport_equivalence": 0}
