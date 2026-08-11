"""passes_hard_constraints's slice-aware branch -- the correctness fix
this feature's plan called out: a deliberate multi-day gap between manual
multi-city legs must never be checked against the same min/max_normal_minutes
window used for same-flight connection comfort, or a real multi-city
result would be wrongly rejected as an "invalid layover".
"""

from __future__ import annotations

import datetime as dt

from app.config import get_settings
from app.providers.base import FareOption, FareSlice
from app.schemas.search import SearchRequest
from app.search.spaces import parse_request
from app.search.verification import passes_hard_constraints


async def _space(seeded_session, **connection_overrides):
    body = {
        "destination": {"regions": ["japan"]},
        "dates": {"departure_from": dt.date(2026, 9, 1), "departure_to": dt.date(2026, 9, 10)},
        "budget": {"max_total": 2000},
        "connections": {"max_stops": 1, "min_normal_minutes": 60, "max_normal_minutes": 300, **connection_overrides},
    }
    return await parse_request(seeded_session, SearchRequest(**body))


def _flat_option(price: float, *, stops: int, layovers) -> FareOption:
    return FareOption(
        price=price, currency="CAD", outbound_legs=(), layovers=layovers,
        total_duration_min=600, stops=stops, carriers=("AC",),
    )


def _multi_city_option(price: float, *, slices: tuple[FareSlice, ...]) -> FareOption:
    return FareOption(
        price=price, currency="CAD", outbound_legs=(), layovers=(),
        total_duration_min=600, stops=sum(sl.stops for sl in slices), carriers=("AC",), slices=slices,
    )


async def test_flat_layover_over_max_is_rejected(seeded_session):
    space = await _space(seeded_session)
    # A same-flight connection of 400 min is outside the 60-300 window.
    option = _flat_option(1000.0, stops=1, layovers=(("ICN", 400),))
    assert not passes_hard_constraints(option, space)


async def test_flat_layover_within_window_passes(seeded_session):
    space = await _space(seeded_session)
    option = _flat_option(1000.0, stops=1, layovers=(("ICN", 150),))
    assert passes_hard_constraints(option, space)


async def test_multi_day_gap_between_slices_is_never_checked_as_a_layover(seeded_session):
    """The core bug this feature's plan flagged: a naive reuse of the flat
    layovers loop would reject this as a 5-day (7200-minute) "layover".
    """
    space = await _space(seeded_session)
    five_day_gap_option = _multi_city_option(
        1500.0,
        slices=(
            FareSlice(legs=(), layovers=(), stops=0, duration_min=600),
            FareSlice(legs=(), layovers=(), stops=0, duration_min=600),
        ),
    )
    assert passes_hard_constraints(five_day_gap_option, space)


async def test_multi_city_still_validates_each_slices_own_layovers(seeded_session):
    space = await _space(seeded_session)
    # Slice 1 has a legitimate same-flight connection that's too long.
    option = _multi_city_option(
        1500.0,
        slices=(
            FareSlice(legs=(), layovers=(("ICN", 400),), stops=1, duration_min=900),
            FareSlice(legs=(), layovers=(), stops=0, duration_min=600),
        ),
    )
    assert not passes_hard_constraints(option, space)


async def test_multi_city_stops_summed_across_slices_against_max_stops(seeded_session):
    space = await _space(seeded_session, max_stops=0)
    option = _multi_city_option(
        1500.0,
        slices=(
            FareSlice(legs=(), layovers=(), stops=0, duration_min=600),
            FareSlice(legs=(), layovers=(("ICN", 150),), stops=1, duration_min=900),
        ),
    )
    assert not passes_hard_constraints(option, space)


async def test_over_budget_option_rejected_regardless_of_shape(seeded_session):
    space = await _space(seeded_session)
    flat = _flat_option(5000.0, stops=0, layovers=())
    multi_city = _multi_city_option(5000.0, slices=(FareSlice(legs=(), layovers=(), stops=0, duration_min=600),))
    assert not passes_hard_constraints(flat, space)
    assert not passes_hard_constraints(multi_city, space)
