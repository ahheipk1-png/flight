from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_search_provider
from app.providers.base import FareProvider
from app.schemas.search import MultiCitySearchRequest, SearchRequest
from app.search.jobs import get_state, start_multi_city_search, start_search

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/search")
async def post_search(req: SearchRequest, provider: FareProvider = Depends(get_search_provider)) -> dict:
    search_id = await start_search(req, provider)
    return {"search_id": search_id}


@router.post("/search/multi-city")
async def post_multi_city_search(
    req: MultiCitySearchRequest, provider: FareProvider = Depends(get_search_provider)
) -> dict:
    search_id = await start_multi_city_search(req, provider)
    return {"search_id": search_id}


@router.get("/search/{search_id}")
async def get_search(search_id: str) -> dict:
    state = await get_state(search_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Unknown or expired search_id")
    return state
