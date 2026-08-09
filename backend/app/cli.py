"""Dev CLI.

    python -m app.cli seed
    python -m app.cli probe ORIGIN DEST DEPART_DATE RETURN_DATE [--live] [--adults N] [--max-stops N]
    python -m app.cli budget-status
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt

from app.config import get_settings
from app.db import create_all, session_scope
from app.providers.base import FareQuery
from app.services import fares as fare_service
from app.services import geo as geo_service


async def cmd_seed() -> None:
    await create_all()
    async with session_scope() as session:
        counts = await geo_service.seed_database(session)
    print(f"Seeded: {counts}")


async def cmd_probe(
    origin: str, destination: str, depart: str, ret: str, live: bool, adults: int, max_stops: int | None
) -> None:
    settings = get_settings()
    if live:
        if not settings.serpapi_api_key:
            raise SystemExit("--live requires SERPAPI_API_KEY to be set in .env")
        from app.providers.serpapi_google_flights import build_serpapi_provider

        provider = build_serpapi_provider(settings.serpapi_api_key)
    else:
        from app.providers.mock import mock_provider

        provider = mock_provider

    query = FareQuery(
        origin=origin,
        destination=destination,
        depart_date=dt.date.fromisoformat(depart),
        return_date=dt.date.fromisoformat(ret),
        adults=adults,
        currency=settings.default_currency,
        max_stops=max_stops,
    )
    async with session_scope() as session:
        options, degraded = await fare_service.search_cached(session, query, kind="discovery", provider=provider)

    if degraded:
        print("DEGRADED: budget exhausted, no live call made")
        return

    print(f"{len(options)} option(s) from provider={provider.name}")
    for o in options:
        route = " -> ".join([o.outbound_legs[0].from_iata, *[l.to_iata for l in o.outbound_legs]])
        print(
            f"  {o.currency} {o.price:>9.2f}  stops={o.stops}  {route}  "
            f"dur={o.total_duration_min}min  carriers={','.join(o.carriers)}  "
            f"inbound={o.inbound_detail}"
        )


async def cmd_budget_status() -> None:
    print(await fare_service.budget_status())


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("seed", help="Upsert data/seed/*.json into the database")

    probe = sub.add_parser("probe", help="Fetch fares for one route/date pair")
    probe.add_argument("origin")
    probe.add_argument("destination")
    probe.add_argument("depart")
    probe.add_argument("return_date")
    probe.add_argument("--live", action="store_true", help="Use real SerpApi instead of the mock provider")
    probe.add_argument("--adults", type=int, default=1)
    probe.add_argument("--max-stops", type=int, default=None)

    sub.add_parser("budget-status", help="Show live SerpApi budget counters")

    args = parser.parse_args()

    if args.command == "seed":
        asyncio.run(cmd_seed())
    elif args.command == "probe":
        asyncio.run(
            cmd_probe(args.origin, args.destination, args.depart, args.return_date, args.live, args.adults, args.max_stops)
        )
    elif args.command == "budget-status":
        asyncio.run(cmd_budget_status())


if __name__ == "__main__":
    main()
