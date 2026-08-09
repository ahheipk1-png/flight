"""Coarse candidate grid generation -- spec §27 step 1. Primary origin
only, one metro-primary airport per destination metro, dates strided
every `coarse_date_stride_days`, midpoint trip length. For the spec §31
worked example (~61 day window, 4 Japan/Korea/Taiwan/HK primaries) this
is ~5 destinations x ~16 dates = ~80 cells, never the full grid.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.search.spaces import SearchSpace
from app.services.indicative import estimate


@dataclass
class Cell:
    origin: str
    destination: str
    depart_date: dt.date
    trip_length: int
    estimated_price: float
    estimate_source: str

    @property
    def return_date(self) -> dt.date:
        return self.depart_date + dt.timedelta(days=self.trip_length)


def _strided_dates(start: dt.date, end: dt.date, stride_days: int) -> list[dt.date]:
    dates = []
    d = start
    while d <= end:
        dates.append(d)
        d += dt.timedelta(days=stride_days)
    return dates


async def generate_coarse(session: AsyncSession, space: SearchSpace, settings: Settings) -> list[Cell]:
    midpoint_length = (space.trip_length_min + space.trip_length_max) // 2
    dates = _strided_dates(space.departure_from, space.departure_to, settings.coarse_date_stride_days)

    cells: list[Cell] = []
    for dest in space.destination_primaries:
        for depart in dates:
            return_date = depart + dt.timedelta(days=midpoint_length)
            price, source = await estimate(session, space.primary_origin.iata, dest.iata, depart, return_date)
            cells.append(
                Cell(
                    origin=space.primary_origin.iata,
                    destination=dest.iata,
                    depart_date=depart,
                    trip_length=midpoint_length,
                    estimated_price=price,
                    estimate_source=source,
                )
            )
    return cells
