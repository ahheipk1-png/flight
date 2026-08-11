"""SerpApi Google Flights client. This is the ONE module that talks to a
paid, real-world API -- all response-shape assumptions are isolated here
and exercised only against recorded JSON fixtures in tests (see
tests/fixtures/serpapi/), never live. The capped M6 live smoke test is
what validates these assumptions against reality before any real volume.

Known limitations (see plan §"Risks"):
  - The first call (no departure_token) returns OUTBOUND itineraries only;
    `price` at this stage is Google Flights' full round-trip total. Getting
    return-leg detail costs a second, paid call with `departure_token` --
    deliberately not spent in MVP 1. Every FareOption from this provider is
    therefore inbound_detail="indicative".
  - We do not send SerpApi's `stops` filter param (its exact bucket
    semantics are unverified without a live account); connection min/max
    filtering is applied locally and deterministically on parsed
    `layovers[].duration` instead, per spec intent.
  - search_one_way (type=2) reuses parse_response as-is: _parse_itinerary
    never reads query.return_date, so nothing about the parsing path
    actually assumes a round trip.
  - search_multi_city (type=3) is CONFIRMED (via a live capped smoke test,
    2-leg case) to NOT return one flat response the way the initial
    unverified design assumed. Google Flights' multi-city flow mirrors its
    round-trip departure_token pattern above, generalized to N-1 extra
    calls: the first multi_city_json call returns ONLY leg-1 options; each
    chosen option carries a departure_token that must be resent (alongside
    the *same* multi_city_json params) to reach leg 2's options, and so on
    until the final leg, whose chosen item carries a booking_token instead
    of a further departure_token. search_multi_city greedily picks the
    cheapest option at each step (not exhaustive across legs -- avoids a
    combinatorial fan-out) and uses the FINAL step's price as the
    itinerary total. That last part is a live-observed-once inference, not
    fully proven: in the one 2-leg case tested, every leg-2 candidate's
    price already equalled leg-1's chosen price exactly, suggesting the
    total is fixed once the first leg's fare bucket is picked -- but this
    hasn't been confirmed across more legs, routes, or cabins. Re-verify
    before relying on this for real volume beyond a 2-3 leg trip.
"""

from __future__ import annotations

import datetime as dt
import json

import httpx

from app.providers.base import FareLeg, FareOption, FareProvider, FareQuery, FareSlice, MultiCityLeg

SERPAPI_URL = "https://serpapi.com/search"


class SerpApiError(RuntimeError):
    pass


def _carrier_code(flight_number: str | None, airline: str | None) -> str:
    if flight_number:
        prefix = flight_number.strip().split(" ")[0]
        if prefix:
            return prefix.upper()
    return (airline or "??")[:2].upper()


def _parse_time(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.min
    # SerpApi format: "YYYY-MM-DD HH:MM"
    return dt.datetime.strptime(value, "%Y-%m-%d %H:%M")


def _parse_leg(leg: dict) -> FareLeg:
    dep = leg.get("departure_airport") or {}
    arr = leg.get("arrival_airport") or {}
    flight_number = leg.get("flight_number")
    return FareLeg(
        from_iata=dep.get("id", ""),
        to_iata=arr.get("id", ""),
        dep_time=_parse_time(dep.get("time")),
        arr_time=_parse_time(arr.get("time")),
        carrier=_carrier_code(flight_number, leg.get("airline")),
        flight_number=flight_number or "",
        duration_min=int(leg.get("duration") or 0),
    )


def _parse_itinerary(item: dict, currency: str) -> FareOption | None:
    raw_legs = item.get("flights") or []
    if not raw_legs:
        return None

    legs = [_parse_leg(leg) for leg in raw_legs]

    raw_layovers = item.get("layovers") or []
    layovers = tuple((lo.get("id", ""), int(lo.get("duration") or 0)) for lo in raw_layovers)

    price = item.get("price")
    if price is None:
        return None

    total_duration = item.get("total_duration")
    if total_duration is None:
        total_duration = sum(l.duration_min for l in legs) + sum(m for _, m in layovers)

    carriers = tuple(dict.fromkeys(l.carrier for l in legs))  # de-dup, preserve order

    return FareOption(
        price=float(price),
        currency=currency,
        outbound_legs=tuple(legs),
        layovers=layovers,
        total_duration_min=int(total_duration),
        stops=len(layovers),
        carriers=carriers,
        inbound_detail="indicative",
        raw=item,
    )


def parse_response(data: dict, query: FareQuery) -> list[FareOption]:
    """Pure function, no I/O -- this is what the fixture-based tests target."""
    if "error" in data:
        raise SerpApiError(str(data["error"]))

    items = [*(data.get("best_flights") or []), *(data.get("other_flights") or [])]
    options: list[FareOption] = []
    for item in items:
        option = _parse_itinerary(item, query.currency)
        if option is None:
            continue
        if query.max_stops is not None and option.stops > query.max_stops:
            continue
        options.append(option)

    options.sort(key=lambda o: o.price)
    return options


def _partition_into_slices(all_legs: list[FareLeg], requested_legs: list[MultiCityLeg]) -> list[FareSlice]:
    """`all_legs` is the concatenation of every step's chosen flights (see
    module docstring's departure_token chain) -- one contiguous run per
    requested leg, in order. Reconstructs slice boundaries by walking the
    legs until each one's arrival matches the destination requested for
    that leg (handles a same-flight connection landing at an intermediate
    hub before the leg's real destination).
    """
    slices: list[FareSlice] = []
    remaining = list(all_legs)
    for leg in requested_legs:
        slice_legs: list[FareLeg] = []
        while remaining:
            next_leg = remaining.pop(0)
            slice_legs.append(next_leg)
            if next_leg.to_iata == leg.destination:
                break
        if not slice_legs:
            continue
        layovers = tuple(
            (prev.to_iata, max(round((nxt.dep_time - prev.arr_time).total_seconds() / 60), 0))
            for prev, nxt in zip(slice_legs, slice_legs[1:])
        )
        duration = sum(l.duration_min for l in slice_legs) + sum(m for _, m in layovers)
        slices.append(
            FareSlice(legs=tuple(slice_legs), layovers=layovers, stops=len(slice_legs) - 1, duration_min=duration)
        )
    return slices


def cheapest_multi_city_step(data: dict) -> dict | None:
    """Pure function, no I/O -- this is what the fixture-based tests
    target. Picks the cheapest best_flights/other_flights item from ONE
    step of the departure_token chain (see module docstring); returns None
    if this step has no options at all. The caller (search_multi_city)
    reads the chosen item's `flights`, `price`, and `departure_token`
    (absent on the final step) to decide whether/how to continue.
    """
    if "error" in data:
        raise SerpApiError(str(data["error"]))
    items = [*(data.get("best_flights") or []), *(data.get("other_flights") or [])]
    if not items:
        return None
    return min(items, key=lambda item: item.get("price", float("inf")))


def build_multi_city_option(
    collected_legs: list[FareLeg], final_price: float, requested_legs: list[MultiCityLeg], *, currency: str, max_stops: int | None
) -> FareOption | None:
    """Pure function, no I/O -- assembles the single combined FareOption
    from every step's collected legs once the departure_token chain is
    complete. Returns None if any slice exceeds max_stops.
    """
    slices = _partition_into_slices(collected_legs, requested_legs)
    if max_stops is not None and any(sl.stops > max_stops for sl in slices):
        return None
    carriers = tuple(dict.fromkeys(l.carrier for l in collected_legs))
    # Inter-slice gaps (deliberate city stops) never enter this tuple --
    # only each slice's own same-flight connections do.
    flat_layovers = tuple(lo for sl in slices for lo in sl.layovers)
    return FareOption(
        price=float(final_price),
        currency=currency,
        outbound_legs=tuple(collected_legs),
        layovers=flat_layovers,
        total_duration_min=sum(sl.duration_min for sl in slices),
        stops=sum(sl.stops for sl in slices),
        carriers=carriers,
        inbound_detail="indicative",
        slices=tuple(slices),
    )


class SerpApiFareProvider:
    name = "serpapi"

    def __init__(self, api_key: str, *, timeout: float = 20.0):
        self._api_key = api_key
        self._timeout = timeout

    def _params(self, query: FareQuery) -> dict:
        return {
            "engine": "google_flights",
            "departure_id": query.origin,
            "arrival_id": query.destination,
            "outbound_date": query.depart_date.isoformat(),
            "return_date": query.return_date.isoformat(),
            "currency": query.currency,
            "adults": query.adults,
            "type": "1",  # round trip
            "gl": "ca",
            "hl": "en",
            "api_key": self._api_key,
        }

    def _one_way_params(self, query: FareQuery) -> dict:
        return {
            "engine": "google_flights",
            "departure_id": query.origin,
            "arrival_id": query.destination,
            "outbound_date": query.depart_date.isoformat(),
            "currency": query.currency,
            "adults": query.adults,
            "type": "2",  # one-way
            "gl": "ca",
            "hl": "en",
            "api_key": self._api_key,
        }

    def _multi_city_params(self, legs: list[MultiCityLeg], *, adults: int, currency: str) -> dict:
        multi_city_json = json.dumps(
            [{"departure_id": leg.origin, "arrival_id": leg.destination, "date": leg.date.isoformat()} for leg in legs]
        )
        return {
            "engine": "google_flights",
            "type": "3",  # multi-city
            "multi_city_json": multi_city_json,
            "currency": currency,
            "adults": adults,
            "gl": "ca",
            "hl": "en",
            "api_key": self._api_key,
        }

    async def search_round_trip(self, query: FareQuery) -> list[FareOption]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(SERPAPI_URL, params=self._params(query))
            resp.raise_for_status()
            data = resp.json()
        return parse_response(data, query)

    async def search_one_way(self, query: FareQuery) -> list[FareOption]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(SERPAPI_URL, params=self._one_way_params(query))
            resp.raise_for_status()
            data = resp.json()
        return parse_response(data, query)

    async def search_multi_city(
        self,
        legs: list[MultiCityLeg],
        *,
        adults: int = 1,
        currency: str = "CAD",
        max_stops: int | None = None,
    ) -> list[FareOption]:
        """Walks the departure_token chain described in the module
        docstring: one HTTP call per leg, each continuing from the
        previous step's cheapest choice. Greedy, not exhaustive -- there
        is no attempt to explore alternate leg-1 choices if a later leg
        turns out expensive, matching the "avoid combinatorial fan-out"
        tradeoff already documented above.
        """
        base_params = self._multi_city_params(legs, adults=adults, currency=currency)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(SERPAPI_URL, params=base_params)
            resp.raise_for_status()
            chosen = cheapest_multi_city_step(resp.json())
            if chosen is None:
                return []
            collected_legs = [_parse_leg(leg) for leg in (chosen.get("flights") or [])]
            price = chosen.get("price")
            token = chosen.get("departure_token")

            for _ in range(len(legs) - 1):
                if not token:
                    return []  # chain ended early -- treat as no result rather than an incomplete one
                resp = await client.get(SERPAPI_URL, params={**base_params, "departure_token": token})
                resp.raise_for_status()
                chosen = cheapest_multi_city_step(resp.json())
                if chosen is None:
                    return []
                collected_legs.extend(_parse_leg(leg) for leg in (chosen.get("flights") or []))
                price = chosen.get("price")
                token = chosen.get("departure_token")

        if price is None:
            return []
        option = build_multi_city_option(collected_legs, price, legs, currency=currency, max_stops=max_stops)
        return [option] if option else []


def build_serpapi_provider(api_key: str) -> FareProvider:
    return SerpApiFareProvider(api_key)
