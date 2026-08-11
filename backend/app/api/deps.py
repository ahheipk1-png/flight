"""Shared FastAPI dependencies: who's calling, and (for /api/search) what
FareProvider they're allowed to search with. See services/auth.py for the
underlying session/encryption mechanics.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models.auth import User
from app.providers.base import FareProvider
from app.providers.serpapi_google_flights import build_serpapi_provider
from app.redis import RedisLike, get_redis
from app.services.auth import EncryptionKeyMissing, decrypt_api_key, get_session_user_id

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
    redis: RedisLike = Depends(get_redis),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Log in to continue.")
    user_id = await get_session_user_id(redis, credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid -- please log in again.")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Account no longer exists.")
    return user


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


async def get_search_provider(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FareProvider:
    """No fallback: every search runs on the caller's OWN stored key, never
    a site-wide one. Raises a clear, actionable error at each gate rather
    than silently degrading, since a silent fallback here is exactly the
    shared-cost behavior this whole feature exists to avoid.
    """
    if user.status != "approved":
        raise HTTPException(
            status_code=403,
            detail="Your account is not approved yet -- an admin needs to approve it before you can search.",
        )
    if not user.serpapi_api_key_encrypted:
        raise HTTPException(
            status_code=400,
            detail="Add your own SerpApi key in Settings before searching -- there's no shared/default key.",
        )
    try:
        api_key = decrypt_api_key(user.serpapi_api_key_encrypted, settings)
    except EncryptionKeyMissing as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return build_serpapi_provider(api_key)
