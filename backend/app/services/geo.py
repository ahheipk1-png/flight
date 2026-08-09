"""Geography loading and lookup helpers used by the seed loader, /api/meta,
and the search pipeline's candidate generation.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import SEED_DIR
from app.models.geo import Airport, AirportEquivalence, MetroArea, TravelRegion


# --- Seed file loading ---------------------------------------------------

def _load_json(name: str) -> object:
    path = SEED_DIR / name
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_seed_bundle() -> dict:
    return {
        "travel_regions": _load_json("travel_regions.json"),
        "metro_areas": _load_json("metro_areas.json"),
        "airports": _load_json("airports.json"),
        "airport_equivalence": _load_json("airport_equivalence.json"),
        "route_baselines": _load_json("route_baselines.json"),
    }


async def seed_database(session: AsyncSession) -> dict[str, int]:
    """Idempotent upsert of all seed JSON into the DB, keyed on natural
    codes (region code / metro code / iata). Safe to run repeatedly.
    """
    bundle = load_seed_bundle()
    counts = {"travel_regions": 0, "metro_areas": 0, "airports": 0, "airport_equivalence": 0}

    region_by_code: dict[str, TravelRegion] = {}
    for row in bundle["travel_regions"]:
        existing = (
            await session.execute(select(TravelRegion).where(TravelRegion.code == row["code"]))
        ).scalar_one_or_none()
        if existing is None:
            existing = TravelRegion(code=row["code"], name=row["name"], kind=row["kind"])
            session.add(existing)
            counts["travel_regions"] += 1
        else:
            existing.name = row["name"]
            existing.kind = row["kind"]
        region_by_code[row["code"]] = existing
    await session.flush()

    metro_by_code: dict[str, MetroArea] = {}
    for row in bundle["metro_areas"]:
        existing = (
            await session.execute(select(MetroArea).where(MetroArea.code == row["code"]))
        ).scalar_one_or_none()
        if existing is None:
            existing = MetroArea(
                code=row["code"], name=row["name"], country=row["country"],
                lat=row["lat"], lon=row["lon"],
            )
            session.add(existing)
            counts["metro_areas"] += 1
        else:
            existing.name, existing.country = row["name"], row["country"]
            existing.lat, existing.lon = row["lat"], row["lon"]
        metro_by_code[row["code"]] = existing
    await session.flush()

    airport_by_iata: dict[str, Airport] = {}
    for row in bundle["airports"]:
        existing = (
            await session.execute(select(Airport).where(Airport.iata == row["iata"]))
        ).scalar_one_or_none()
        metro = metro_by_code[row["metro"]]
        region = region_by_code[row["region"]]
        if existing is None:
            existing = Airport(iata=row["iata"])
            session.add(existing)
            counts["airports"] += 1
        existing.icao = row.get("icao")
        existing.name = row["name"]
        existing.city = row["city"]
        existing.country = row["country"]
        existing.lat = row["lat"]
        existing.lon = row["lon"]
        existing.tz = row["tz"]
        existing.metro_area_id = metro.id
        existing.travel_region_id = region.id
        existing.is_metro_primary = row.get("is_metro_primary", False)
        existing.is_origin_candidate = row.get("is_origin_candidate", False)
        existing.is_origin_default = row.get("is_origin_default", False)
        existing.active = True
        airport_by_iata[row["iata"]] = existing
    await session.flush()

    for row in bundle["airport_equivalence"]:
        a = airport_by_iata[row["a"]]
        b = airport_by_iata[row["b"]]
        a_id, b_id = sorted((a.id, b.id))
        existing = (
            await session.execute(
                select(AirportEquivalence).where(
                    AirportEquivalence.airport_a_id == a_id,
                    AirportEquivalence.airport_b_id == b_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = AirportEquivalence(airport_a_id=a_id, airport_b_id=b_id)
            session.add(existing)
            counts["airport_equivalence"] += 1
        existing.ground_time_minutes = row["ground_time_minutes"]
        existing.ground_cost_estimate = row["ground_cost_estimate"]
        existing.currency = row["currency"]
        existing.same_metro = row["same_metro"]
        existing.same_travel_region = row["same_travel_region"]

    await session.commit()
    return counts


# --- Lookups used by the search pipeline / API ---------------------------

@dataclass(frozen=True)
class EquivalenceInfo:
    ground_time_minutes: int
    ground_cost_estimate: float
    currency: str
    same_metro: bool
    same_travel_region: bool


async def resolve_equivalence(session: AsyncSession, iata_a: str, iata_b: str) -> EquivalenceInfo | None:
    """Equivalence rows are stored once per pair with airport_a_id <
    airport_b_id; this resolves either call order transparently.
    """
    if iata_a == iata_b:
        return EquivalenceInfo(0, 0.0, "CAD", True, True)

    a = (await session.execute(select(Airport).where(Airport.iata == iata_a))).scalar_one_or_none()
    b = (await session.execute(select(Airport).where(Airport.iata == iata_b))).scalar_one_or_none()
    if a is None or b is None:
        return None

    lo_id, hi_id = sorted((a.id, b.id))
    row = (
        await session.execute(
            select(AirportEquivalence).where(
                AirportEquivalence.airport_a_id == lo_id,
                AirportEquivalence.airport_b_id == hi_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return EquivalenceInfo(
        row.ground_time_minutes, row.ground_cost_estimate, row.currency,
        row.same_metro, row.same_travel_region,
    )


async def get_origin_group(
    session: AsyncSession, region_code: str = "greater_toronto", *, only_default: bool = False
) -> list[Airport]:
    stmt = (
        select(Airport)
        .join(TravelRegion)
        .where(TravelRegion.code == region_code, Airport.is_origin_candidate.is_(True))
    )
    if only_default:
        stmt = stmt.where(Airport.is_origin_default.is_(True))
    return list((await session.execute(stmt)).scalars().all())


async def get_destination_airports(
    session: AsyncSession, region_codes: list[str], *, primary_only: bool = False
) -> list[Airport]:
    stmt = select(Airport).join(TravelRegion).where(TravelRegion.code.in_(region_codes))
    if primary_only:
        stmt = stmt.where(Airport.is_metro_primary.is_(True))
    return list((await session.execute(stmt)).scalars().all())


async def get_metro_siblings(session: AsyncSession, iata: str) -> list[Airport]:
    """All airports sharing a metro with the given airport (used when
    expanding a promising destination neighborhood to alternate metro
    airports, e.g. KIX -> also try ITM/UKB).
    """
    airport = (await session.execute(select(Airport).where(Airport.iata == iata))).scalar_one_or_none()
    if airport is None:
        return []
    stmt = select(Airport).where(Airport.metro_area_id == airport.metro_area_id)
    return list((await session.execute(stmt)).scalars().all())


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
