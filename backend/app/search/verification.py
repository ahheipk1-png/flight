"""Live-price (or indicative-fallback) verification of the top candidate
groups -- spec §26 "LIVE FARE SEARCH" stage / §27 step 3. Hard
constraints (budget, stops, layover min/max) are enforced locally here
rather than trusted to any provider param, per spec intent.

Groups (see pruning.py) are verified whole: cheapest-group-first, and a
group is only verified if ALL of its origin variants fit in the
remaining live-call budget. This keeps a primary-origin result and its
alt-origin siblings verified together, which ranking.py's nearby-airport
filter depends on to compute a net saving.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import session_scope
from app.providers.base import FareOption, FareQuery
from app.search.pruning import Candidate, CandidateGroup
from app.search.spaces import SearchSpace
from app.services import fares as fare_service
from app.services import indicative

VERIFY_CONCURRENCY = 4


@dataclass
class VerifiedItinerary:
    origin: str
    destination: str
    depart_date: dt.date
    return_date: dt.date
    trip_length: int
    option: FareOption
    verified: bool  # False when we fell back to an indicative estimate (budget exhausted)


def _passes_hard_constraints(option: FareOption, space: SearchSpace) -> bool:
    if option.stops > space.max_stops:
        return False
    for _, minutes in option.layovers:
        if not (space.min_normal_minutes <= minutes <= space.max_normal_minutes):
            return False
    # Budget is interpreted per person (MVP 1 assumption; see plan risks --
    # adults=1 is the supported default, so this is exact in the common case).
    if option.price > space.max_total:
        return False
    return True


def _select_candidates_to_verify(groups: list[CandidateGroup], call_budget: int) -> list[Candidate]:
    selected_groups: list[CandidateGroup] = []
    used = 0
    for group in groups:
        if used + len(group.candidates) > call_budget:
            continue  # doesn't fit as a whole group -- try smaller ones rather than splitting it
        selected_groups.append(group)
        used += len(group.candidates)
        if used >= call_budget:
            break

    if selected_groups:
        return [c for g in selected_groups for c in g.candidates]

    if not groups:
        return []

    # Budget too tight for even the cheapest whole group -- verify as much
    # of it as fits rather than verifying nothing. This sacrifices the
    # pairing guarantee for this one group, but only under a budget
    # tighter than any real MVP 1 default.
    cheapest = groups[0]
    return sorted(cheapest.candidates, key=lambda c: c.estimated_price)[:call_budget]


async def verify_top(
    session: AsyncSession, space: SearchSpace, groups: list[CandidateGroup], settings: Settings
) -> tuple[list[VerifiedItinerary], bool]:
    """Returns (verified_itineraries, degraded). degraded=True if any
    candidate had to fall back to an indicative estimate because the
    live budget was exhausted mid-search.

    The `session` parameter is intentionally unused by the concurrent path
    below -- an AsyncSession is not safe to share across coroutines running
    concurrently under asyncio.gather, so each verify_one() opens its own
    short-lived session instead (see app/db.py's session_scope). `session`
    stays in the signature for consistency with the other pipeline stages,
    which all run sequentially and do share one session safely.
    """
    call_budget = min(settings.verify_top_n, settings.per_search_live_cap)
    to_verify = _select_candidates_to_verify(groups, call_budget)

    semaphore = asyncio.Semaphore(VERIFY_CONCURRENCY)
    any_degraded = False

    async def verify_one(candidate: Candidate) -> VerifiedItinerary | None:
        nonlocal any_degraded
        query = FareQuery(
            origin=candidate.origin,
            destination=candidate.destination,
            depart_date=candidate.depart_date,
            return_date=candidate.return_date,
            adults=space.adults,
            currency=space.currency,
            max_stops=space.max_stops,
        )
        async with semaphore, session_scope() as local_session:
            options, degraded = await fare_service.search_cached(local_session, query, kind="verified")

            if degraded:
                any_degraded = True
                price, _source = await indicative.estimate(
                    local_session, candidate.origin, candidate.destination, candidate.depart_date, candidate.return_date
                )
                if price > space.max_total:
                    return None
                fallback = FareOption(
                    price=price,
                    currency=space.currency,
                    outbound_legs=(),
                    layovers=(),
                    total_duration_min=0,
                    stops=0,
                    carriers=(),
                    inbound_detail="indicative",
                )
                return VerifiedItinerary(
                    candidate.origin, candidate.destination, candidate.depart_date, candidate.return_date,
                    candidate.trip_length, fallback, verified=False,
                )

        passing = [o for o in options if _passes_hard_constraints(o, space)]
        if not passing:
            return None
        best = min(passing, key=lambda o: o.price)
        return VerifiedItinerary(
            candidate.origin, candidate.destination, candidate.depart_date, candidate.return_date,
            candidate.trip_length, best, verified=True,
        )

    results = await asyncio.gather(*(verify_one(c) for c in to_verify))
    verified = [r for r in results if r is not None]
    return verified, any_degraded
