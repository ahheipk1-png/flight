from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from app.providers.base import FareQuery
from app.providers.serpapi_google_flights import SerpApiError, parse_response

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "serpapi"


def _load(name: str) -> dict:
    with (FIXTURES / name).open("r", encoding="utf-8") as f:
        return json.load(f)


def _query(**overrides) -> FareQuery:
    base = dict(origin="YYZ", destination="KIX", depart_date=dt.date(2026, 9, 18), return_date=dt.date(2026, 10, 2))
    base.update(overrides)
    return FareQuery(**base)


def test_parses_legs_layovers_and_price_from_best_and_other():
    data = _load("round_trip_yyz_kix.json")
    options = parse_response(data, _query())

    assert len(options) == 2  # one from best_flights, one from other_flights

    cheapest = options[0]
    assert cheapest.price == 1187
    assert cheapest.stops == 1
    assert cheapest.layovers == (("ICN", 110),)
    assert cheapest.total_duration_min == 1055
    assert cheapest.outbound_legs[0].from_iata == "YYZ"
    assert cheapest.outbound_legs[0].carrier == "KE"
    assert cheapest.outbound_legs[-1].to_iata == "KIX"
    assert cheapest.inbound_detail == "indicative"  # return leg detail is never fetched (spec risk note)

    nonstop = options[1]
    assert nonstop.stops == 0
    assert nonstop.price == 1389
    assert nonstop.carriers == ("TK",)


def test_results_sorted_by_price_ascending():
    data = _load("round_trip_yyz_kix.json")
    options = parse_response(data, _query())
    prices = [o.price for o in options]
    assert prices == sorted(prices)


def test_max_stops_filters_locally_not_via_provider_param():
    data = _load("round_trip_yyz_kix.json")
    options = parse_response(data, _query(max_stops=0))
    assert len(options) == 1
    assert options[0].stops == 0


def test_error_payload_raises_serpapi_error():
    with pytest.raises(SerpApiError):
        parse_response({"error": "Invalid API key."}, _query())


def test_empty_response_yields_no_options():
    assert parse_response({"search_metadata": {"status": "Success"}}, _query()) == []
