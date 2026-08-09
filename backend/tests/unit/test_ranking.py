"""Direct tests of the nearby-airport savings filter and explanations,
using hand-built VerifiedItinerary fixtures so the assertions aren't
entangled with pruning/verification's own randomness.
"""

from __future__ import annotations

import datetime as dt

from app.config import get_settings
from app.providers.base import FareOption
from app.schemas.search import SearchRequest
from app.search.ranking import rank
from app.search.spaces import parse_request
from app.search.verification import VerifiedItinerary

DEPART, LENGTH = dt.date(2026, 9, 5), 13
RETURN = DEPART + dt.timedelta(days=LENGTH)


def _option(price: float, *, stops: int = 0, layovers=()) -> FareOption:
    return FareOption(
        price=price, currency="CAD", outbound_legs=(), layovers=layovers,
        total_duration_min=600, stops=stops, carriers=("AC",),
    )


def _itinerary(origin: str, destination: str, price: float, *, verified: bool = True, **option_kwargs) -> VerifiedItinerary:
    return VerifiedItinerary(
        origin=origin, destination=destination, depart_date=DEPART, return_date=RETURN,
        trip_length=LENGTH, option=_option(price, **option_kwargs), verified=verified,
    )


async def _space(seeded_session, **origin_overrides):
    body = {
        "origin": {"max_ground_minutes": 120, "min_saving_per_person": 100, **origin_overrides},
        "destination": {"regions": ["japan"]},
        "dates": {"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10)},
        "budget": {"max_total": 1500},
    }
    return await parse_request(seeded_session, SearchRequest(**body))


async def test_alt_origin_below_threshold_is_dropped(seeded_session):
    space = await _space(seeded_session)
    settings = get_settings()
    # YHM equivalence: 70 min / $35 one-way -> $70 round trip ground cost.
    # (1400-1250) - 70 = 80, below the default $100/person threshold.
    itineraries = [_itinerary("YYZ", "KIX", 1400.0), _itinerary("YHM", "KIX", 1250.0)]

    ranked = await rank(seeded_session, space, itineraries, settings)

    origins = {r.verified_itinerary.origin for r in ranked}
    assert origins == {"YYZ"}


async def test_alt_origin_above_threshold_is_kept_with_ground_transfer(seeded_session):
    space = await _space(seeded_session)
    settings = get_settings()
    # YKF equivalence: 60 min / $30 one-way -> $60 round trip ground cost.
    # (1400-1200) - 60 = 140, above the $100/person threshold.
    itineraries = [_itinerary("YYZ", "KIX", 1400.0), _itinerary("YKF", "KIX", 1200.0)]

    ranked = await rank(seeded_session, space, itineraries, settings)

    origins = {r.verified_itinerary.origin for r in ranked}
    assert origins == {"YYZ", "YKF"}

    ykf_result = next(r for r in ranked if r.verified_itinerary.origin == "YKF")
    assert ykf_result.ground_transfer is not None
    assert ykf_result.ground_transfer["net_saving"] == 140.0
    assert any("YKF" in note and "saves" in note for note in ykf_result.explanations)


async def test_alt_origin_without_matching_primary_result_is_dropped(seeded_session):
    space = await _space(seeded_session)
    settings = get_settings()
    # No YYZ result at all for this trip -- nothing to compare against.
    itineraries = [_itinerary("YKF", "KIX", 900.0)]

    ranked = await rank(seeded_session, space, itineraries, settings)
    assert ranked == []


async def test_raising_threshold_drops_a_previously_kept_alternate(seeded_session):
    space = await _space(seeded_session, min_saving_per_person=200)
    settings = get_settings()
    itineraries = [_itinerary("YYZ", "KIX", 1400.0), _itinerary("YKF", "KIX", 1200.0)]  # net saving = 140

    ranked = await rank(seeded_session, space, itineraries, settings)
    assert {r.verified_itinerary.origin for r in ranked} == {"YYZ"}


async def test_primary_origin_itineraries_always_pass_through(seeded_session):
    space = await _space(seeded_session)
    settings = get_settings()
    itineraries = [_itinerary("YYZ", "KIX", 1400.0)]

    ranked = await rank(seeded_session, space, itineraries, settings)
    assert len(ranked) == 1
    assert ranked[0].ground_transfer is None


async def test_cheaper_option_ranks_before_pricier_one_by_best_score(seeded_session):
    space = await _space(seeded_session)
    settings = get_settings()
    itineraries = [
        _itinerary("YYZ", "KIX", 1400.0, stops=0),
        _itinerary("YYZ", "HND", 900.0, stops=0),
    ]

    ranked = await rank(seeded_session, space, itineraries, settings)
    assert ranked[0].verified_itinerary.destination == "HND"


async def test_unverified_itinerary_says_so_in_explanations(seeded_session):
    space = await _space(seeded_session)
    settings = get_settings()
    itineraries = [_itinerary("YYZ", "KIX", 1400.0, verified=False)]

    ranked = await rank(seeded_session, space, itineraries, settings)
    assert any("Indicative" in note for note in ranked[0].explanations)
