from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import httpx
import pytest
import respx

from app.providers.base import FareQuery, MultiCityLeg
from app.providers.serpapi_google_flights import (
    SERPAPI_URL,
    SerpApiError,
    SerpApiFareProvider,
    _parse_leg,
    build_multi_city_option,
    cheapest_multi_city_step,
    parse_response,
)

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


# ---------- one-way ----------


def test_one_way_reuses_parse_response_unchanged():
    # _parse_itinerary never reads query.return_date, so a one-way query
    # (return_date == depart_date, trip_type="one_way") parses through the
    # exact same code path as round trip -- just a different fixture.
    data = _load("one_way_yyz_kix.json")
    options = parse_response(data, _query(return_date=dt.date(2026, 9, 18), trip_type="one_way"))

    assert len(options) == 2
    cheapest = options[0]
    assert cheapest.price == 690
    assert cheapest.stops == 1
    assert cheapest.outbound_legs[0].from_iata == "YYZ"
    assert cheapest.outbound_legs[-1].to_iata == "KIX"


def test_one_way_max_stops_filters_locally():
    data = _load("one_way_yyz_kix.json")
    options = parse_response(data, _query(return_date=dt.date(2026, 9, 18), trip_type="one_way", max_stops=0))
    assert len(options) == 1
    assert options[0].stops == 0


# ---------- manual multi-city ----------
#
# Confirmed via a live capped smoke test that Google Flights' multi-city
# flow is a departure_token CHAIN, not one flat response: the first
# multi_city_json call returns only leg-1 options, and each one's
# departure_token must be resent to reach leg 2's options, and so on until
# a final step whose chosen item carries a booking_token instead. These
# fixtures (multi_city_yyz_ist_bkk_step{1,2}.json) model that two-step
# shape directly, mirroring the real responses observed.


def _multi_city_legs() -> list[MultiCityLeg]:
    return [
        MultiCityLeg(origin="YYZ", destination="IST", date=dt.date(2026, 9, 10)),
        MultiCityLeg(origin="IST", destination="BKK", date=dt.date(2026, 9, 15)),
    ]


def test_cheapest_step_picks_lowest_price_and_carries_its_token():
    data = _load("multi_city_yyz_ist_bkk_step1.json")
    chosen = cheapest_multi_city_step(data)
    assert chosen is not None
    assert chosen["price"] == 1789  # cheaper than the 1899 alternative in the same fixture
    assert chosen["departure_token"] == "opaque-step1-token-abc"


def test_final_step_has_no_departure_token():
    data = _load("multi_city_yyz_ist_bkk_step2.json")
    chosen = cheapest_multi_city_step(data)
    assert chosen is not None
    assert chosen.get("departure_token") is None
    assert chosen["booking_token"] == "opaque-booking-token-xyz"


def test_empty_step_yields_none():
    assert cheapest_multi_city_step({"search_metadata": {"status": "Success"}}) is None


def test_error_payload_raises_serpapi_error_from_a_step():
    with pytest.raises(SerpApiError):
        cheapest_multi_city_step({"error": "Invalid API key."})


def test_build_multi_city_option_assembles_slices_from_both_steps():
    step1 = cheapest_multi_city_step(_load("multi_city_yyz_ist_bkk_step1.json"))
    step2 = cheapest_multi_city_step(_load("multi_city_yyz_ist_bkk_step2.json"))
    collected_legs = [_parse_leg(leg) for leg in step1["flights"]] + [_parse_leg(leg) for leg in step2["flights"]]

    option = build_multi_city_option(collected_legs, step2["price"], _multi_city_legs(), currency="CAD", max_stops=None)

    assert option is not None
    assert option.price == 1789.0
    assert len(option.slices) == 2
    assert option.slices[0].legs[0].from_iata == "YYZ"
    assert option.slices[0].legs[-1].to_iata == "IST"
    assert option.slices[1].legs[0].from_iata == "IST"
    assert option.slices[1].legs[-1].to_iata == "BKK"
    # The multi-day gap between legs must never leak into layovers.
    assert option.layovers == ()
    assert option.stops == 0


def test_build_multi_city_option_returns_none_over_max_stops():
    step1 = cheapest_multi_city_step(_load("multi_city_yyz_ist_bkk_step1.json"))
    step2 = cheapest_multi_city_step(_load("multi_city_yyz_ist_bkk_step2.json"))
    collected_legs = [_parse_leg(leg) for leg in step1["flights"]] + [_parse_leg(leg) for leg in step2["flights"]]

    # Both slices are nonstop in the fixtures, so max_stops=0 still keeps it...
    kept = build_multi_city_option(collected_legs, step2["price"], _multi_city_legs(), currency="CAD", max_stops=0)
    assert kept is not None
    # ...but a impossible-to-satisfy max_stops of -1 must reject it.
    rejected = build_multi_city_option(collected_legs, step2["price"], _multi_city_legs(), currency="CAD", max_stops=-1)
    assert rejected is None


@respx.mock
async def test_search_multi_city_walks_the_departure_token_chain():
    """The one test in this file that isn't a pure-function/fixture test:
    the orchestration in SerpApiFareProvider.search_multi_city (loop count,
    stopping condition, token hand-off between calls) is exactly where the
    original single-flat-response assumption broke in the live smoke test,
    so it's worth mocking httpx (respx, already a declared dev dependency,
    previously unused) to exercise the real chain rather than only its
    pure pieces in isolation.
    """
    step1 = _load("multi_city_yyz_ist_bkk_step1.json")
    step2 = _load("multi_city_yyz_ist_bkk_step2.json")

    def _responder(request: httpx.Request) -> httpx.Response:
        if "departure_token" in request.url.params:
            assert request.url.params["departure_token"] == "opaque-step1-token-abc"
            return httpx.Response(200, json=step2)
        return httpx.Response(200, json=step1)

    respx.get(SERPAPI_URL).mock(side_effect=_responder)

    provider = SerpApiFareProvider("fake-key")
    options = await provider.search_multi_city(_multi_city_legs())

    assert len(options) == 1
    assert options[0].price == 1789.0
    assert len(options[0].slices) == 2
    assert options[0].slices[0].legs[-1].to_iata == "IST"
    assert options[0].slices[1].legs[-1].to_iata == "BKK"


@respx.mock
async def test_search_multi_city_stops_early_if_chain_breaks():
    # step1's chosen item has no departure_token at all -- the chain can't
    # continue to leg 2, so this must come back empty, not a wrong
    # single-leg result mislabeled as the whole trip.
    broken_step1 = json.loads(json.dumps(_load("multi_city_yyz_ist_bkk_step1.json")))
    for item in broken_step1["best_flights"]:
        item.pop("departure_token", None)

    respx.get(SERPAPI_URL).mock(return_value=httpx.Response(200, json=broken_step1))

    provider = SerpApiFareProvider("fake-key")
    options = await provider.search_multi_city(_multi_city_legs())

    assert options == []
