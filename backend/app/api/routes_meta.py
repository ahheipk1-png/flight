from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models.geo import Airport, MetroArea, TravelRegion
from app.schemas.meta import AirportOut, MetaResponse, MetroAreaOut, TravelRegionOut

router = APIRouter(prefix="/api", tags=["meta"])


def _airport_out(airport: Airport, metro: MetroArea, region: TravelRegion) -> AirportOut:
    return AirportOut(
        iata=airport.iata, icao=airport.icao, name=airport.name, city=airport.city, country=airport.country,
        lat=airport.lat, lon=airport.lon, tz=airport.tz, metro=metro.code, region=region.code,
        is_metro_primary=airport.is_metro_primary, is_origin_candidate=airport.is_origin_candidate,
        is_origin_default=airport.is_origin_default,
    )


@router.get("/meta", response_model=MetaResponse)
async def get_meta(session: AsyncSession = Depends(get_session)) -> MetaResponse:
    """Airports + metros + regions in one cacheable payload. Drives the
    search form (FROM/WHERE chips) and the map's static reference data.
    """
    regions = (await session.execute(select(TravelRegion))).scalars().all()
    metros = (await session.execute(select(MetroArea))).scalars().all()
    airports = (await session.execute(select(Airport).where(Airport.active.is_(True)))).scalars().all()

    metro_by_id = {m.id: m for m in metros}
    region_by_id = {r.id: r for r in regions}

    airport_rows = [_airport_out(a, metro_by_id[a.metro_area_id], region_by_id[a.travel_region_id]) for a in airports]
    origin_group = [a.iata for a in airports if a.is_origin_candidate]

    return MetaResponse(
        travel_regions=[TravelRegionOut(code=r.code, name=r.name, kind=r.kind) for r in regions],
        metro_areas=[MetroAreaOut(code=m.code, name=m.name, country=m.country, lat=m.lat, lon=m.lon) for m in metros],
        airports=airport_rows,
        origin_group=origin_group,
    )


@router.get("/airports/{iata}", response_model=AirportOut)
async def get_airport(iata: str, session: AsyncSession = Depends(get_session)) -> AirportOut:
    airport = (await session.execute(select(Airport).where(Airport.iata == iata.upper()))).scalar_one_or_none()
    if airport is None:
        raise HTTPException(status_code=404, detail=f"Unknown airport {iata!r}")
    metro = await session.get(MetroArea, airport.metro_area_id)
    region = await session.get(TravelRegion, airport.travel_region_id)
    return _airport_out(airport, metro, region)
