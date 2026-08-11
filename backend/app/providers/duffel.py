"""Duffel Flights (NDC) client. Like serpapi_google_flights.py, this is the
ONE module that talks to this particular paid, real-world API -- all
response-shape assumptions are isolated here and exercised only against
recorded JSON fixtures in tests (see tests/fixtures/duffel/), never live.
A capped live smoke test (README "Going live with Duffel") is what
validates these assumptions against reality before any real volume.

Why Duffel, alongside SerpApi: Duffel bills ~$0.005/search once a search-
to-book ratio is exceeded (vs SerpApi's ~$0.01-0.025/search flat), and its
POST /air/offer_requests?return_offers=true call returns full segment-by-
segment detail for BOTH slices in one synchronous response -- no second
paid call needed the way SerpApi requires a departure_token for return-leg
detail. We still only extract the outbound slice below: nothing downstream
(search/pipeline.py, schemas/itinerary.py, the frontend) has ever surfaced
return-leg detail, even for the mock provider which "has" it -- adding an
inbound_legs field with no reader would be speculative. inbound_detail is
set to "full" to mean the same thing it does for mock: this is a real,
fully-priced round trip, not a heuristic -- not "we itemized the return".

Known limitations / unverified assumptions (confirm against a real
response in the live smoke test before relying on them):
  - Duffel's offer_request body has no currency field (confirmed from the
    documented optional-field list) -- you cannot request a currency the
    way SerpApi's `currency` param does. Each offer's total_currency is
    read directly from the response rather than assumed to equal
    query.currency. Since the rest of this app assumes CAD end-to-end
    (see plan "Assumptions: CAD-only"), a non-CAD offer would currently
    display with a "$" prefix and the wrong implied currency -- there is
    no conversion here, by design (out of MVP 1 scope), but it is a real
    display-correctness gap if Duffel returns e.g. USD for some routes.
  - Passenger objects are sent as {"type": "adult"} only, no given_name/
    family_name. Duffel's docs don't explicitly say these are optional at
    the offer_request (search) stage vs required only at order creation;
    the "age OR type, not both" note implies type-only is valid.
  - Flight number display assembles f"{carrier}{number}" from
    marketing_carrier.iata_code + marketing_carrier_flight_number (falling
    back to operating_carrier fields if marketing is absent), matching
    the "CX307"-style format the rest of the app already uses. The exact
    un-prefixed format of *_flight_number is inferred from Duffel's field
    naming (carrier and number kept as separate fields), not from a
    fetched example response.
  - Layover minutes are computed locally from consecutive segments'
    arriving_at/departing_at timestamps (Duffel does not appear to expose
    a precomputed per-layover duration the way SerpApi's layovers[] does).
"""

from __future__ import annotations

import datetime as dt
import re

import httpx

from app.providers.base import FareLeg, FareOption, FareProvider, FareQuery

DUFFEL_URL = "https://api.duffel.com/air/offer_requests"
DUFFEL_VERSION = "v2"

_ISO8601_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)


class DuffelError(RuntimeError):
    pass


def _parse_iso8601_duration_min(value: str | None) -> int:
    """'PT15H30M' -> 930. Flight-leg/slice durations only (no Y/W terms)."""
    if not value:
        return 0
    m = _ISO8601_DURATION_RE.match(value.strip())
    if not m:
        return 0
    days = int(m.group("days") or 0)
    hours = int(m.group("hours") or 0)
    minutes = int(m.group("minutes") or 0)
    seconds = int(m.group("seconds") or 0)
    return days * 24 * 60 + hours * 60 + minutes + (1 if seconds >= 30 else 0)


def _parse_time(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.min
    return dt.datetime.fromisoformat(value)


def _carrier_and_flight_number(seg: dict) -> tuple[str, str]:
    marketing = seg.get("marketing_carrier") or {}
    operating = seg.get("operating_carrier") or {}
    carrier = marketing.get("iata_code") or operating.get("iata_code") or "??"
    number = seg.get("marketing_carrier_flight_number") or seg.get("operating_carrier_flight_number") or ""
    return carrier, f"{carrier}{number}" if number else carrier


def _extract_outbound_legs(segments: list[dict]) -> list[FareLeg]:
    legs: list[FareLeg] = []
    for seg in segments:
        origin = (seg.get("origin") or {}).get("iata_code", "")
        destination = (seg.get("destination") or {}).get("iata_code", "")
        carrier, flight_number = _carrier_and_flight_number(seg)
        legs.append(
            FareLeg(
                from_iata=origin,
                to_iata=destination,
                dep_time=_parse_time(seg.get("departing_at")),
                arr_time=_parse_time(seg.get("arriving_at")),
                carrier=carrier,
                flight_number=flight_number,
                duration_min=_parse_iso8601_duration_min(seg.get("duration")),
            )
        )
    return legs


def _layovers_from_legs(legs: list[FareLeg]) -> tuple[tuple[str, int], ...]:
    layovers = []
    for prev, nxt in zip(legs, legs[1:]):
        minutes = round((nxt.dep_time - prev.arr_time).total_seconds() / 60)
        layovers.append((prev.to_iata, max(minutes, 0)))
    return tuple(layovers)


def _parse_offer(offer: dict) -> FareOption | None:
    slices = offer.get("slices") or []
    if not slices:
        return None
    outbound = slices[0]
    segments = outbound.get("segments") or []
    if not segments:
        return None

    total_amount = offer.get("total_amount")
    if total_amount is None:
        return None

    legs = _extract_outbound_legs(segments)
    layovers = _layovers_from_legs(legs)

    total_duration = _parse_iso8601_duration_min(outbound.get("duration"))
    if not total_duration:
        total_duration = sum(l.duration_min for l in legs) + sum(m for _, m in layovers)

    carriers = tuple(dict.fromkeys(l.carrier for l in legs))

    return FareOption(
        price=float(total_amount),
        currency=offer.get("total_currency", "CAD"),
        outbound_legs=tuple(legs),
        layovers=layovers,
        total_duration_min=total_duration,
        stops=len(layovers),
        carriers=carriers,
        inbound_detail="full",
        raw=offer,
    )


def parse_response(data: dict, query: FareQuery) -> list[FareOption]:
    """Pure function, no I/O -- this is what the fixture-based tests target."""
    if "errors" in data:
        raise DuffelError(str(data["errors"]))

    offers = ((data.get("data") or {}).get("offers")) or []
    options: list[FareOption] = []
    for offer in offers:
        option = _parse_offer(offer)
        if option is None:
            continue
        if query.max_stops is not None and option.stops > query.max_stops:
            continue
        options.append(option)

    options.sort(key=lambda o: o.price)
    return options


class DuffelFareProvider:
    name = "duffel"

    def __init__(self, api_key: str, *, timeout: float = 20.0):
        self._api_key = api_key
        self._timeout = timeout

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Duffel-Version": DUFFEL_VERSION,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _body(self, query: FareQuery) -> dict:
        data: dict = {
            "slices": [
                {"origin": query.origin, "destination": query.destination, "departure_date": query.depart_date.isoformat()},
                {"origin": query.destination, "destination": query.origin, "departure_date": query.return_date.isoformat()},
            ],
            "passengers": [{"type": "adult"} for _ in range(query.adults)],
            "cabin_class": "economy",
        }
        if query.max_stops is not None:
            data["max_connections"] = query.max_stops
        return {"data": data}

    async def search_round_trip(self, query: FareQuery) -> list[FareOption]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                DUFFEL_URL,
                params={"return_offers": "true"},
                headers=self._headers(),
                json=self._body(query),
            )
            resp.raise_for_status()
            data = resp.json()
        return parse_response(data, query)


def build_duffel_provider(api_key: str) -> FareProvider:
    return DuffelFareProvider(api_key)
