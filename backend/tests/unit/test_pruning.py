"""Covers the correctness gap found while building M3: at cold start,
indicative.estimate()'s tier-3 baseline must be origin-aware (not just
origin-metro-aware), and pruning must keep every origin variant of a trip
together as a group -- otherwise the nearby-airport savings comparison
(spec §31) has nothing to compare against once verification narrows the
field. See services/indicative.py's module docstring for the full story.
"""

from __future__ import annotations

import datetime as dt

from app.config import get_settings
from app.models.fares import FareObservation
from app.schemas.search import SearchRequest
from app.search.candidates import generate_coarse
from app.search.pruning import prune_and_expand
from app.search.spaces import parse_request


def _request(**overrides) -> SearchRequest:
    body = {
        "destination": {"regions": ["japan"]},
        "dates": {"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10)},
        "budget": {"max_total": 1500},
    }
    body.update(overrides)
    return SearchRequest(**body)


async def test_coarse_grid_matches_expected_cell_count(seeded_session):
    # region=japan -> 2 metro-primary destinations (HND, KIX); a 10-day
    # window with a 4-day stride -> dates 09-01, 09-05, 09-09 = 3 dates.
    space = await parse_request(seeded_session, _request())
    settings = get_settings()
    cells = await generate_coarse(seeded_session, space, settings)
    assert len(cells) == 2 * 3
    assert {c.destination for c in cells} == {"HND", "KIX"}


async def test_every_group_shares_trip_but_varies_origin(seeded_session):
    space = await parse_request(seeded_session, _request())
    settings = get_settings()
    coarse = await generate_coarse(seeded_session, space, settings)
    groups = await prune_and_expand(seeded_session, space, coarse, settings)

    assert groups, "expected at least one surviving candidate group"
    for group in groups:
        origins = [c.origin for c in group.candidates]
        assert len(origins) == len(set(origins)), "a group must not price the same origin twice"
        assert set(origins) == {"YYZ", "YTZ", "YHM", "YKF"}, "every group must carry all eligible origins together"
        for c in group.candidates:
            assert c.destination == group.destination
            assert c.depart_date == group.depart_date
            assert c.trip_length == group.trip_length


async def test_cold_start_origin_ordering_matches_origin_factor(seeded_session):
    # No fare_observations exist yet, so every group falls through to the
    # (now origin-aware) tier-3 baseline. Cheapest-to-priciest should
    # follow ORIGIN_FACTOR: YHM(0.88) < YKF(0.95) < YYZ(1.00) < YTZ(1.05).
    space = await parse_request(seeded_session, _request())
    settings = get_settings()
    coarse = await generate_coarse(seeded_session, space, settings)
    groups = await prune_and_expand(seeded_session, space, coarse, settings)

    for group in groups:
        ordered = sorted(group.candidates, key=lambda c: c.estimated_price)
        assert [c.origin for c in ordered] == ["YHM", "YKF", "YYZ", "YTZ"]
        assert all(c.estimate_source == "baseline" for c in group.candidates)


async def test_planted_deal_is_found_and_stays_attributed_to_its_origin(seeded_session):
    depart, length = dt.date(2026, 9, 5), 13  # midpoint of the default 10-16 range
    ret = depart + dt.timedelta(days=length)
    seeded_session.add(
        FareObservation(
            origin="YYZ", destination="HND", departure_date=depart, return_date=ret, trip_length=length,
            cabin="economy", fare=100.0, currency="CAD", provider="mock", kind="discovery",
            observed_at=dt.datetime.now(dt.UTC),
        )
    )
    await seeded_session.commit()

    space = await parse_request(seeded_session, _request())
    settings = get_settings()
    coarse = await generate_coarse(seeded_session, space, settings)

    # The planted deal must win the HND coarse cell for this date.
    hnd_cell = next(c for c in coarse if c.destination == "HND" and c.depart_date == depart)
    assert hnd_cell.estimated_price == 100.0
    assert hnd_cell.estimate_source == "observation_exact"

    groups = await prune_and_expand(seeded_session, space, coarse, settings)
    target = next(g for g in groups if g.destination == "HND" and g.depart_date == depart and g.trip_length == length)

    yyz_candidate = next(c for c in target.candidates if c.origin == "YYZ")
    assert yyz_candidate.estimated_price == 100.0
    assert yyz_candidate.estimate_source == "observation_exact"

    # The deal is specific to YYZ on this exact date -- group-mates on the
    # same trip must NOT inherit it; they still price off the baseline.
    other = next(c for c in target.candidates if c.origin == "YHM")
    assert other.estimated_price > 100.0
    assert other.estimate_source == "baseline"

    # And it must be among the very cheapest groups overall (top seed).
    assert groups[0].destination == "HND" and groups[0].depart_date == depart
