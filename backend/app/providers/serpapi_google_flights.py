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
"""

from __future__ import annotations

import datetime as dt

import httpx

from app.providers.base import FareLeg, FareOption, FareProvider, FareQuery

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


def _parse_itinerary(item: dict, currency: str) -> FareOption | None:
    raw_legs = item.get("flights") or []
    if not raw_legs:
        return None

    legs: list[FareLeg] = []
    for leg in raw_legs:
        dep = leg.get("departure_airport") or {}
        arr = leg.get("arrival_airport") or {}
        flight_number = leg.get("flight_number")
        legs.append(
            FareLeg(
                from_iata=dep.get("id", ""),
                to_iata=arr.get("id", ""),
                dep_time=_parse_time(dep.get("time")),
                arr_time=_parse_time(arr.get("time")),
                carrier=_carrier_code(flight_number, leg.get("airline")),
                flight_number=flight_number or "",
                duration_min=int(leg.get("duration") or 0),
            )
        )

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

    async def search_round_trip(self, query: FareQuery) -> list[FareOption]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(SERPAPI_URL, params=self._params(query))
            resp.raise_for_status()
            data = resp.json()
        return parse_response(data, query)


def build_serpapi_provider(api_key: str) -> FareProvider:
    return SerpApiFareProvider(api_key)
