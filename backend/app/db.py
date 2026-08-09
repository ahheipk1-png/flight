"""Async SQLAlchemy engine/session wiring. Works against SQLite (dev, no
Docker) or Postgres (docker-compose target) via DATABASE_URL alone -- MVP 1
models use no PostGIS-specific column types yet, so both backends are plain
SQL under this schema.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _enable_sqlite_wal(engine: AsyncEngine) -> None:
    """search/verification.py verifies candidates concurrently, each with
    its own AsyncSession (SQLAlchemy sessions aren't safe to share across
    concurrent coroutines). Postgres handles concurrent writers natively;
    SQLite's default journal mode serializes writers and raises "database
    is locked" under exactly this pattern, so give it WAL mode plus a
    busy timeout to wait/queue instead of erroring.
    """

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        url = get_settings().database_url
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_async_engine(url, connect_args=connect_args, pool_pre_ping=True)
        if url.startswith("sqlite"):
            _enable_sqlite_wal(_engine)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _session_factory


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency."""
    async with get_session_factory()() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Context manager for use outside request handlers (CLI, jobs, tests)."""
    async with get_session_factory()() as session:
        yield session


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def create_all() -> None:
    """Used by tests and first-run convenience; real deployments use Alembic."""
    from app import models  # noqa: F401  (ensure models are registered on Base.metadata)

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
