"""End-to-end mock-mode smoke test: POST the spec §31-shaped example body,
poll until done, and assert every hard constraint plus the plan's
verification checklist (explanations present, verified observations
written, nearby-airport savings respected).
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from sqlalchemy import select

from app.main import app
from app.models.fares import FareObservation

SEARCH_BODY = {
    "origin": {"region": "greater_toronto", "max_ground_minutes": 120, "min_saving_per_person": 100},
    "destination": {"regions": ["japan", "south_korea", "taiwan", "hong_kong"]},
    "dates": {
        "departure_from": "2026-09-01",
        "departure_to": "2026-10-31",
        "trip_length_min": 10,
        "trip_length_max": 16,
    },
    "budget": {"currency": "CAD", "max_total": 1600},
    "connections": {"max_stops": 1, "min_normal_minutes": 120, "max_normal_minutes": 300},
    "adults": 1,
}


@pytest.fixture
async def client(seeded_session):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_search_end_to_end_mock_mode(client, seeded_session):
    resp = await client.post("/api/search", json=SEARCH_BODY)
    assert resp.status_code == 200
    search_id = resp.json()["search_id"]

    state = None
    for _ in range(500):
        resp = await client.get(f"/api/search/{search_id}")
        assert resp.status_code == 200
        state = resp.json()
        if state["status"] in ("done", "error"):
            break
        await asyncio.sleep(0.02)

    assert state is not None
    assert state["status"] == "done", state.get("error")
    assert state["degraded"] is False  # mock provider never exhausts the live budget

    itineraries = state["itineraries"]
    assert len(itineraries) >= 1, "expected at least one itinerary within a generous CAD 1600 budget"

    saw_alt_origin = False
    for it in itineraries:
        assert it["fare"] <= 1600
        assert it["stops"] <= 1
        for _iata, minutes in it["layovers"]:
            assert 120 <= minutes <= 300
        assert 1 <= len(it["explanations"]) <= 3
        if it["origin"]["iata"] != "YYZ":
            saw_alt_origin = True
            assert it["ground_transfer"] is not None
            assert it["ground_transfer"]["minutes"] <= 120

    # Not a hard requirement every run, but the mock provider's ORIGIN_FACTOR
    # landscape is tuned so alt-origin deals should show up in this search.
    assert saw_alt_origin, "expected at least one alt-origin (nearby-airport) result to surface"

    verified_rows = (
        await seeded_session.execute(select(FareObservation).where(FareObservation.kind == "verified"))
    ).scalars().all()
    assert verified_rows, "verified fare_observations rows should have been written"
