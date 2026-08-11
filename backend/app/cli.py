"""Dev CLI.

    python -m app.cli seed
    python -m app.cli probe ORIGIN DEST DEPART_DATE RETURN_DATE [--live] [--provider serpapi|duffel] [--adults N] [--max-stops N]
    python -m app.cli budget-status
    python -m app.cli make-admin USERNAME
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import getpass

from sqlalchemy import select

from app.config import get_settings
from app.db import create_all, session_scope
from app.models.auth import User
from app.providers.base import FareQuery
from app.services import fares as fare_service
from app.services import geo as geo_service
from app.services.auth import hash_password, normalize_username


async def cmd_seed() -> None:
    await create_all()
    async with session_scope() as session:
        counts = await geo_service.seed_database(session)
    print(f"Seeded: {counts}")


async def cmd_probe(
    origin: str,
    destination: str,
    depart: str,
    ret: str,
    live: bool,
    provider_choice: str | None,
    adults: int,
    max_stops: int | None,
) -> None:
    settings = get_settings()
    if live:
        chosen = provider_choice or settings.effective_fare_provider
        if chosen == "duffel":
            if not settings.duffel_api_key:
                raise SystemExit("--live --provider duffel requires DUFFEL_API_KEY to be set in .env")
            from app.providers.duffel import build_duffel_provider

            provider = build_duffel_provider(settings.duffel_api_key)
        elif chosen == "serpapi":
            if not settings.serpapi_api_key:
                raise SystemExit("--live --provider serpapi requires SERPAPI_API_KEY to be set in .env")
            from app.providers.serpapi_google_flights import build_serpapi_provider

            provider = build_serpapi_provider(settings.serpapi_api_key)
        else:
            raise SystemExit(
                f"--live needs a real provider, but the effective provider is 'mock' "
                f"(set DUFFEL_API_KEY or SERPAPI_API_KEY, or pass --provider explicitly)"
            )
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


async def cmd_make_admin(username: str) -> None:
    """Bootstrap the site owner's own admin account -- promotes an existing
    account, or creates a fresh approved-admin one if it doesn't exist yet.
    No hardcoded default admin/password shipped anywhere (unlike the
    reference this was modeled on, which seeds a guessable admin/admin) --
    this always requires a real, freshly-typed password.
    """
    username = normalize_username(username)
    async with session_scope() as session:
        user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
        now = dt.datetime.now(dt.UTC)
        if user is not None:
            user.is_admin = True
            user.status = "approved"
            user.decided_at = now
            await session.commit()
            print(f"'{username}' promoted to admin and approved.")
            return

        pw1 = getpass.getpass(f"New password for admin account '{username}' (8+ characters): ")
        if len(pw1) < 8:
            raise SystemExit("Password must be at least 8 characters.")
        pw2 = getpass.getpass("Confirm password: ")
        if pw1 != pw2:
            raise SystemExit("Passwords did not match.")
        session.add(
            User(
                username=username,
                password_hash=hash_password(pw1),
                status="approved",
                is_admin=True,
                created_at=now,
                decided_at=now,
            )
        )
        await session.commit()
        print(f"Admin account '{username}' created and approved.")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("seed", help="Upsert data/seed/*.json into the database")

    probe = sub.add_parser("probe", help="Fetch fares for one route/date pair")
    probe.add_argument("origin")
    probe.add_argument("destination")
    probe.add_argument("depart")
    probe.add_argument("return_date")
    probe.add_argument("--live", action="store_true", help="Use a real provider instead of the mock provider")
    probe.add_argument(
        "--provider",
        choices=["serpapi", "duffel"],
        default=None,
        help="Which live provider to use with --live (default: whatever FARE_PROVIDER/auto resolves to)",
    )
    probe.add_argument("--adults", type=int, default=1)
    probe.add_argument("--max-stops", type=int, default=None)

    sub.add_parser("budget-status", help="Show the active live provider's budget counters")

    make_admin = sub.add_parser("make-admin", help="Promote/create an approved admin account")
    make_admin.add_argument("username")

    args = parser.parse_args()

    if args.command == "seed":
        asyncio.run(cmd_seed())
    elif args.command == "probe":
        asyncio.run(
            cmd_probe(
                args.origin,
                args.destination,
                args.depart,
                args.return_date,
                args.live,
                args.provider,
                args.adults,
                args.max_stops,
            )
        )
    elif args.command == "budget-status":
        asyncio.run(cmd_budget_status())
    elif args.command == "make-admin":
        asyncio.run(cmd_make_admin(args.username))


if __name__ == "__main__":
    main()
