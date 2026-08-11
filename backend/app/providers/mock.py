"""Deterministic mock FareProvider. No network calls, no cost -- used
automatically whenever SERPAPI_API_KEY is unset (FARE_PROVIDER=auto) and
always in tests. Same (origin, destination, dates, currency) always
produces the same options, forever, so pruning/ranking tests can assert
on exact outcomes and "deals" can be deliberately planted and found.

Price model (all multipliers deterministic given the seeded RNG below):
    price = route_baseline[destination]
          * origin_factor[origin]      -- simulates secondary-airport savings
          * seasonal(depart_date)
          * weekday_factor(depart_date)
          * trip_length_factor(nights)
          * deal_factor (7% chance of a planted deal)
          * noise (0.93-1.08)
          * adults                     -- linear, no group discount (MVP simplification)
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import random

from app.config import SEED_DIR
from app.providers.base import FareLeg, FareOption, FareProvider, FareQuery, FareSlice, MultiCityLeg

# Independent from services/indicative.py's ONE_WAY_FACTOR (that one
# approximates a cold-start baseline before any real observations exist;
# this one IS the simulated market price) -- importing one from the other
# would also be circular, since indicative.py already imports ORIGIN_FACTOR
# from this module.
ONE_WAY_PRICE_FACTOR = 0.6

# Relative pricing pull per Toronto-region origin airport. Deliberately
# gives BUF/YHM a strong pull below YYZ so the nearby-airport savings
# logic (spec §31: min_saving_per_person) has real deals to find in tests.
ORIGIN_FACTOR = {
    "YYZ": 1.00,
    "YTZ": 1.05,
    "YHM": 0.88,
    "YKF": 0.95,
    "BUF": 0.75,
}

# Plausible single connecting hub per destination, for a one-stop option.
# Not real routing data -- just enough structure for the mock landscape
# to exercise stops/layover logic.
CONNECTING_HUB = {
    "HND": "ICN", "NRT": "ICN", "KIX": "ICN", "ITM": "HND", "UKB": "KIX",
    "ICN": "HND", "TPE": "HKG", "HKG": "TPE", "SIN": "HKG", "BKK": "HKG",
    "IST": "AMS", "DOH": "IST", "DXB": "IST",
    "LHR": "AMS", "CDG": "AMS", "AMS": "CDG", "FRA": "AMS", "LIS": "CDG", "OPO": "LIS",
}

CARRIER_POOL = ["AC", "NH", "OZ", "KE", "CI", "CX", "SQ", "TG", "TK", "QR", "EK", "BA", "AF", "KL", "LH", "TP"]

_AIRPORT_COORDS: dict[str, tuple[float, float]] | None = None


def _airport_coords() -> dict[str, tuple[float, float]]:
    global _AIRPORT_COORDS
    if _AIRPORT_COORDS is None:
        with (SEED_DIR / "airports.json").open("r", encoding="utf-8") as f:
            rows = json.load(f)
        _AIRPORT_COORDS = {r["iata"]: (r["lat"], r["lon"]) for r in rows}
    return _AIRPORT_COORDS


def _haversine_km(a: str, b: str) -> float:
    coords = _airport_coords()
    lat1, lon1 = coords.get(a, (43.6777, -79.6248))  # fall back to YYZ if unknown
    lat2, lon2 = coords.get(b, (43.6777, -79.6248))
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def _leg_duration_min(a: str, b: str) -> int:
    km = _haversine_km(a, b)
    cruise_hours = km / 830.0  # rough average incl. routing inefficiency
    return round(cruise_hours * 60) + 40  # + taxi/climb/descent overhead


_BASELINES: dict[str, float] | None = None


def _baseline(destination: str) -> float:
    global _BASELINES
    if _BASELINES is None:
        with (SEED_DIR / "route_baselines.json").open("r", encoding="utf-8") as f:
            _BASELINES = json.load(f)["toronto"]
    return _BASELINES.get(destination, 1100.0)


def _seeded_rng(query: FareQuery) -> random.Random:
    material = f"{query.origin}|{query.destination}|{query.depart_date.isoformat()}|{query.return_date.isoformat()}|{query.currency}"
    seed_int = int(hashlib.sha256(material.encode()).hexdigest()[:16], 16)
    return random.Random(seed_int)


def _seasonal_factor(d: dt.date) -> float:
    day_of_year = d.timetuple().tm_yday
    return 1.0 + 0.12 * math.sin(2 * math.pi * day_of_year / 365.0)


def _weekday_factor(d: dt.date) -> float:
    # Mon=0 .. Sun=6. Cheaper mid-week departures, pricier Fri/Sun.
    return {0: 1.00, 1: 0.95, 2: 0.94, 3: 0.97, 4: 1.08, 5: 1.02, 6: 1.08}[d.weekday()]


def _trip_length_factor(nights: int) -> float:
    if nights < 7:
        return 1.15
    if nights > 21:
        return 1.10
    return 1.0


def _price_for(query: FareQuery, rng: random.Random, *, is_onestop: bool) -> float:
    base = _baseline(query.destination)
    nights = (query.return_date - query.depart_date).days
    price = (
        base
        * ORIGIN_FACTOR.get(query.origin, 1.0)
        * _seasonal_factor(query.depart_date)
        * _weekday_factor(query.depart_date)
        * _trip_length_factor(nights)
    )
    if is_onestop:
        price *= rng.uniform(0.85, 0.94)  # connecting itineraries tend cheaper
    if rng.random() < 0.07:
        price *= 0.74  # planted deal
    price *= rng.uniform(0.93, 1.08)  # noise
    price *= query.adults
    return round(price, 2)


def _price_for_one_way(query: FareQuery, rng: random.Random, *, is_onestop: bool) -> float:
    """Deliberately does not delegate to _price_for: that formula's nights
    factor is meaningless here (there is no return leg), and reusing it
    with nights=0 would wrongly apply the <7-night short-trip surcharge.
    """
    base = _baseline(query.destination)
    price = (
        base
        * ONE_WAY_PRICE_FACTOR
        * ORIGIN_FACTOR.get(query.origin, 1.0)
        * _seasonal_factor(query.depart_date)
        * _weekday_factor(query.depart_date)
    )
    if is_onestop:
        price *= rng.uniform(0.85, 0.94)
    if rng.random() < 0.07:
        price *= 0.74  # planted deal
    price *= rng.uniform(0.93, 1.08)  # noise
    price *= query.adults
    return round(price, 2)


def _make_option(
    query: FareQuery, rng: random.Random, *, hub: str | None, price: float
) -> FareOption:
    dep_hour = rng.randint(6, 22)
    dep_dt = dt.datetime.combine(query.depart_date, dt.time(hour=dep_hour))
    carrier = rng.choice(CARRIER_POOL)

    if hub is None:
        duration = _leg_duration_min(query.origin, query.destination)
        arr_dt = dep_dt + dt.timedelta(minutes=duration)
        leg = FareLeg(
            from_iata=query.origin, to_iata=query.destination,
            dep_time=dep_dt, arr_time=arr_dt, carrier=carrier,
            flight_number=f"{carrier}{rng.randint(100, 999)}", duration_min=duration,
        )
        return FareOption(
            price=price, currency=query.currency, outbound_legs=(leg,), layovers=(),
            total_duration_min=duration, stops=0, carriers=(carrier,),
            inbound_detail="full", raw={"mock": True, "template": "nonstop"},
        )

    leg1_min = _leg_duration_min(query.origin, hub)
    layover_min = rng.randint(70, 260)
    leg2_min = _leg_duration_min(hub, query.destination)
    leg1_arr = dep_dt + dt.timedelta(minutes=leg1_min)
    leg2_dep = leg1_arr + dt.timedelta(minutes=layover_min)
    leg2_arr = leg2_dep + dt.timedelta(minutes=leg2_min)
    carrier2 = rng.choice(CARRIER_POOL)
    legs = (
        FareLeg(query.origin, hub, dep_dt, leg1_arr, carrier, f"{carrier}{rng.randint(100, 999)}", leg1_min),
        FareLeg(hub, query.destination, leg2_dep, leg2_arr, carrier2, f"{carrier2}{rng.randint(100, 999)}", leg2_min),
    )
    total = leg1_min + layover_min + leg2_min
    return FareOption(
        price=price, currency=query.currency, outbound_legs=legs, layovers=((hub, layover_min),),
        total_duration_min=total, stops=1, carriers=tuple(dict.fromkeys((carrier, carrier2))),
        inbound_detail="full", raw={"mock": True, "template": "onestop", "hub": hub},
    )


class MockFareProvider:
    name = "mock"

    async def search_round_trip(self, query: FareQuery) -> list[FareOption]:
        rng = _seeded_rng(query)
        options: list[FareOption] = []

        options.append(_make_option(query, rng, hub=None, price=_price_for(query, rng, is_onestop=False)))

        hub = CONNECTING_HUB.get(query.destination)
        if hub and hub != query.origin:
            options.append(_make_option(query, rng, hub=hub, price=_price_for(query, rng, is_onestop=True)))

        if rng.random() < 0.5:
            options.append(_make_option(query, rng, hub=None, price=_price_for(query, rng, is_onestop=False)))

        if hub and rng.random() < 0.4:
            options.append(_make_option(query, rng, hub=hub, price=_price_for(query, rng, is_onestop=True)))

        if query.max_stops is not None:
            options = [o for o in options if o.stops <= query.max_stops]

        options.sort(key=lambda o: o.price)
        return options

    async def search_one_way(self, query: FareQuery) -> list[FareOption]:
        rng = _seeded_rng(query)
        options: list[FareOption] = []

        options.append(_make_option(query, rng, hub=None, price=_price_for_one_way(query, rng, is_onestop=False)))

        hub = CONNECTING_HUB.get(query.destination)
        if hub and hub != query.origin:
            options.append(_make_option(query, rng, hub=hub, price=_price_for_one_way(query, rng, is_onestop=True)))

        if query.max_stops is not None:
            options = [o for o in options if o.stops <= query.max_stops]

        options.sort(key=lambda o: o.price)
        return options

    async def search_multi_city(
        self,
        legs: list[MultiCityLeg],
        *,
        adults: int = 1,
        currency: str = "CAD",
        max_stops: int | None = None,
    ) -> list[FareOption]:
        """Returns exactly one combined itinerary (sum of per-leg prices),
        not multiple variants -- unlike search_round_trip/search_one_way,
        there's no small set of "the" alternatives to enumerate for an
        N-leg chain without combinatorial blowup, and this is a mock
        provider, not a search-quality benchmark. Per-leg nonstop-vs-hub
        routing is still deterministic (seeded on that leg's own
        origin/destination/date), so repeated searches are stable.
        """
        slices: list[FareSlice] = []
        all_legs: list[FareLeg] = []
        all_layovers: list[tuple[str, int]] = []
        all_carriers: list[str] = []
        total_price = 0.0
        total_duration = 0
        total_stops = 0

        for leg in legs:
            leg_query = FareQuery(
                origin=leg.origin,
                destination=leg.destination,
                depart_date=leg.date,
                return_date=leg.date,
                adults=adults,
                currency=currency,
                max_stops=max_stops,
                trip_type="one_way",
            )
            rng = _seeded_rng(leg_query)
            hub = CONNECTING_HUB.get(leg.destination)
            use_hub = bool(hub and hub != leg.origin and rng.random() < 0.35)
            price = _price_for_one_way(leg_query, rng, is_onestop=use_hub)
            option = _make_option(leg_query, rng, hub=hub if use_hub else None, price=price)

            total_price += option.price
            all_legs.extend(option.outbound_legs)
            all_layovers.extend(option.layovers)
            all_carriers.extend(option.carriers)
            total_duration += option.total_duration_min
            total_stops += option.stops
            slices.append(
                FareSlice(
                    legs=option.outbound_legs,
                    layovers=option.layovers,
                    stops=option.stops,
                    duration_min=option.total_duration_min,
                )
            )

        combined = FareOption(
            price=round(total_price, 2),
            currency=currency,
            outbound_legs=tuple(all_legs),
            layovers=tuple(all_layovers),
            total_duration_min=total_duration,
            stops=total_stops,
            carriers=tuple(dict.fromkeys(all_carriers)),
            inbound_detail="full",
            raw={"mock": True, "template": "multi_city"},
            slices=tuple(slices),
        )
        return [combined]


mock_provider: FareProvider = MockFareProvider()
