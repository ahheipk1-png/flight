"""One-off: run the Python SerpApi parsers over the recorded fixtures and
dump their outputs as JSON goldens for the TS engine's parity tests
(frontend/src/lib/engine/__tests__/). Re-run if the Python parsers or the
fixtures ever change:

    backend\\.venv\\Scripts\\python scripts\\dump_parser_goldens.py

Datetimes are dumped minute-precision ("%Y-%m-%dT%H:%M") to match the TS
engine's ISO-string representation; `raw` is omitted (the TS FareOption
has no raw field).
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.providers.base import FareOption, FareQuery, MultiCityLeg  # noqa: E402
from app.providers.serpapi_google_flights import (  # noqa: E402
    _parse_leg,
    build_multi_city_option,
    cheapest_multi_city_step,
    parse_response,
)

FIXTURES = REPO / "backend" / "tests" / "fixtures" / "serpapi"
OUT = REPO / "frontend" / "src" / "lib" / "engine" / "__tests__" / "goldens"


def enc_time(value: dt.datetime) -> str:
    if value == dt.datetime.min:
        return ""
    return value.strftime("%Y-%m-%dT%H:%M")


def enc_option(o: FareOption) -> dict:
    return {
        "price": o.price,
        "currency": o.currency,
        "outbound_legs": [
            {
                "from_iata": l.from_iata,
                "to_iata": l.to_iata,
                "dep_time": enc_time(l.dep_time),
                "arr_time": enc_time(l.arr_time),
                "carrier": l.carrier,
                "flight_number": l.flight_number,
                "duration_min": l.duration_min,
            }
            for l in o.outbound_legs
        ],
        "layovers": [list(lo) for lo in o.layovers],
        "total_duration_min": o.total_duration_min,
        "stops": o.stops,
        "carriers": list(o.carriers),
        "inbound_detail": o.inbound_detail,
        "slices": [
            {
                "legs": [
                    {
                        "from_iata": l.from_iata,
                        "to_iata": l.to_iata,
                        "dep_time": enc_time(l.dep_time),
                        "arr_time": enc_time(l.arr_time),
                        "carrier": l.carrier,
                        "flight_number": l.flight_number,
                        "duration_min": l.duration_min,
                    }
                    for l in sl.legs
                ],
                "layovers": [list(lo) for lo in sl.layovers],
                "stops": sl.stops,
                "duration_min": sl.duration_min,
            }
            for sl in o.slices
        ],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    query = FareQuery("YYZ", "KIX", dt.date(2026, 9, 18), dt.date(2026, 10, 2), currency="CAD", max_stops=None)

    for name in ("round_trip_yyz_kix", "one_way_yyz_kix"):
        data = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
        options = parse_response(data, query)
        (OUT / f"{name}.parsed.json").write_text(
            json.dumps([enc_option(o) for o in options], indent=2), encoding="utf-8"
        )

    # Multi-city: replay the full departure_token chain from the two
    # recorded step fixtures, exactly as search_multi_city would.
    step1 = json.loads((FIXTURES / "multi_city_yyz_ist_bkk_step1.json").read_text(encoding="utf-8"))
    step2 = json.loads((FIXTURES / "multi_city_yyz_ist_bkk_step2.json").read_text(encoding="utf-8"))
    legs = [
        MultiCityLeg("YYZ", "IST", dt.date(2026, 9, 10)),
        MultiCityLeg("IST", "BKK", dt.date(2026, 9, 15)),
    ]
    chosen1 = cheapest_multi_city_step(step1)
    assert chosen1 is not None
    collected = [_parse_leg(leg) for leg in (chosen1.get("flights") or [])]
    chosen2 = cheapest_multi_city_step(step2)
    assert chosen2 is not None
    collected.extend(_parse_leg(leg) for leg in (chosen2.get("flights") or []))
    option = build_multi_city_option(collected, chosen2["price"], legs, currency="CAD", max_stops=None)
    assert option is not None
    (OUT / "multi_city_yyz_ist_bkk.assembled.json").write_text(
        json.dumps(
            {
                "step1_chosen_token": chosen1.get("departure_token"),
                "option": enc_option(option),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"goldens written to {OUT}")


if __name__ == "__main__":
    main()
