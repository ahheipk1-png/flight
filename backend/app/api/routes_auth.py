"""Account request/approval + login, and the admin actions that gate it.
No self-serve password reset (matches the reference pattern this was
modeled on) -- an admin sets a new password instead; see
authAdminSetPw-equivalent below.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_admin, get_current_user
from app.config import Settings, get_settings
from app.db import get_session
from app.models.auth import User
from app.redis import RedisLike, get_redis
from app.schemas.auth import (
    AdminAccountOut,
    AdminSetPasswordRequest,
    ApiKeyUpdateRequest,
    LoginRequest,
    MeOut,
    RegisterRequest,
    SessionOut,
)
from app.services.auth import (
    create_session,
    delete_session,
    encrypt_api_key,
    hash_password,
    normalize_username,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"])

_bearer = HTTPBearer(auto_error=False)


@router.post("/register")
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    username = normalize_username(body.username)
    existing = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="That username is already taken or already requested.")

    user = User(
        username=username,
        password_hash=hash_password(body.password),
        status="pending",
        is_admin=False,
        created_at=dt.datetime.now(dt.UTC),
    )
    if body.serpapi_api_key:
        user.serpapi_api_key_encrypted = encrypt_api_key(body.serpapi_api_key, settings)
    session.add(user)
    await session.commit()
    return {"ok": True, "message": "Requested! An admin needs to approve your account before you can log in."}


@router.post("/login", response_model=SessionOut)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    redis: RedisLike = Depends(get_redis),
) -> SessionOut:
    username = normalize_username(body.username)
    user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    if user.status == "pending":
        raise HTTPException(status_code=403, detail="Your account is still waiting for admin approval.")
    if user.status == "denied":
        raise HTTPException(status_code=403, detail="Your account request was denied.")
    if user.status == "disabled":
        raise HTTPException(status_code=403, detail="Your account has been disabled.")

    token = await create_session(redis, user.id, settings)
    return SessionOut(token=token, username=user.username, is_admin=user.is_admin)


@router.post("/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    redis: RedisLike = Depends(get_redis),
) -> dict:
    if credentials is not None:
        await delete_session(redis, credentials.credentials)
    return {"ok": True}


@router.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user)) -> MeOut:
    return MeOut(
        username=user.username,
        status=user.status,
        is_admin=user.is_admin,
        has_api_key=bool(user.serpapi_api_key_encrypted),
    )


@router.put("/api-key")
async def set_api_key(
    body: ApiKeyUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    user.serpapi_api_key_encrypted = encrypt_api_key(body.serpapi_api_key, settings)
    await session.commit()
    return {"ok": True}


@router.delete("/api-key")
async def clear_api_key(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user.serpapi_api_key_encrypted = None
    await session.commit()
    return {"ok": True}


# ---------- admin ----------


def _to_admin_out(u: User) -> AdminAccountOut:
    return AdminAccountOut(
        id=u.id,
        username=u.username,
        status=u.status,
        is_admin=u.is_admin,
        has_api_key=bool(u.serpapi_api_key_encrypted),
        created_at=u.created_at,
        decided_at=u.decided_at,
    )


@admin_router.get("/accounts", response_model=list[AdminAccountOut])
async def list_accounts(
    _admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> list[AdminAccountOut]:
    users = (await session.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [_to_admin_out(u) for u in users]


async def _get_target_user(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such account.")
    return user


@admin_router.post("/accounts/{user_id}/approve")
async def approve_account(
    user_id: int,
    _admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await _get_target_user(session, user_id)
    user.status = "approved"
    user.decided_at = dt.datetime.now(dt.UTC)
    await session.commit()
    return {"ok": True}


@admin_router.post("/accounts/{user_id}/deny")
async def deny_account(
    user_id: int,
    _admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await _get_target_user(session, user_id)
    user.status = "denied"
    user.decided_at = dt.datetime.now(dt.UTC)
    await session.commit()
    return {"ok": True}


@admin_router.post("/accounts/{user_id}/disable")
async def disable_account(
    user_id: int,
    admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await _get_target_user(session, user_id)
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You can't disable your own admin account.")
    user.status = "disabled"
    await session.commit()
    return {"ok": True}


@admin_router.post("/accounts/{user_id}/set-password")
async def admin_set_password(
    user_id: int,
    body: AdminSetPasswordRequest,
    _admin: User = Depends(get_current_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = await _get_target_user(session, user_id)
    user.password_hash = hash_password(body.new_password)
    await session.commit()
    return {"ok": True}
