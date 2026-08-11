from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from app.providers.base import FareQuery
from app.providers.duffel import DuffelError, _parse_iso8601_duration_min, parse_response

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "duffel"


def _load(name: str) -> dict:
    with (FIXTURES / name).open("r", encoding="utf-8") as f:
        return json.load(f)


def _query(**overrides) -> FareQuery:
    base = dict(origin="YYZ", destination="KIX", depart_date=dt.date(2026, 9, 18), return_date=dt.date(2026, 10, 2))
    base.update(overrides)
    return FareQuery(**base)


def test_parses_legs_layovers_and_price_from_offers():
    data = _load("round_trip_yyz_kix.json")
    options = parse_response(data, _query())

    assert len(options) == 2

    cheapest = options[0]
    assert cheapest.price == 1150.0
    assert cheapest.currency == "CAD"
    assert cheapest.stops == 1
    assert cheapest.layovers == (("ICN", 110),)
    assert cheapest.total_duration_min == 18 * 60 + 5
    assert cheapest.outbound_legs[0].from_iata == "YYZ"
    assert cheapest.outbound_legs[0].carrier == "KE"
    assert cheapest.outbound_legs[0].flight_number == "KE071"
    assert cheapest.outbound_legs[-1].to_iata == "KIX"
    assert cheapest.inbound_detail == "full"  # Duffel prices a real round trip, unlike SerpApi's indicative return

    nonstop = options[1]
    assert nonstop.stops == 0
    assert nonstop.price == 1389.0
    assert nonstop.layovers == ()
    assert nonstop.carriers == ("TK",)
    assert nonstop.outbound_legs[0].flight_number == "TK196"


def test_results_sorted_by_price_ascending():
    data = _load("round_trip_yyz_kix.json")
    options = parse_response(data, _query())
    prices = [o.price for o in options]
    assert prices == sorted(prices)


def test_max_stops_filters_locally():
    data = _load("round_trip_yyz_kix.json")
    options = parse_response(data, _query(max_stops=0))
    assert len(options) == 1
    assert options[0].stops == 0


def test_error_payload_raises_duffel_error():
    with pytest.raises(DuffelError):
        parse_response({"errors": [{"title": "Invalid token"}]}, _query())


def test_empty_offers_yields_no_options():
    assert parse_response({"data": {"offers": []}}, _query()) == []


def test_missing_data_key_yields_no_options_not_a_crash():
    assert parse_response({}, _query()) == []


@pytest.mark.parametrize(
    "value,expected_minutes",
    [
        ("PT15H30M", 15 * 60 + 30),
        ("PT45M", 45),
        ("PT2H", 120),
        (None, 0),
        ("", 0),
        ("not-a-duration", 0),
    ],
)
def test_parse_iso8601_duration(value, expected_minutes):
    assert _parse_iso8601_duration_min(value) == expected_minutes
