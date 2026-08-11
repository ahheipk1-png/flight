from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.redis import get_redis
from app.services.fares import budget_status

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict:
    settings = get_settings()

    try:
        await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    try:
        await get_redis().ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    provider = settings.effective_fare_provider
    return {
        "status": "ok" if db_ok and redis_ok else "degraded",
        "db": "ok" if db_ok else "error",
        "redis": "ok" if redis_ok else "error",
        "fare_provider": provider,
        "budget": await budget_status(settings) if provider != "mock" else None,
    }
