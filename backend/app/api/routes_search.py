from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.search import SearchRequest
from app.search.jobs import get_state, start_search

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/search")
async def post_search(req: SearchRequest) -> dict:
    search_id = await start_search(req)
    return {"search_id": search_id}


@router.get("/search/{search_id}")
async def get_search(search_id: str) -> dict:
    state = await get_state(search_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Unknown or expired search_id")
    return state
