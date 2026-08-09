from __future__ import annotations

import pytest

from app.config import get_settings
from app.db import create_all, dispose_engine, session_scope
from app.redis import reset_redis_for_tests
from app.services.geo import seed_database


@pytest.fixture(autouse=True)
async def _isolated_env(tmp_path, monkeypatch):
    """Every test gets a fresh SQLite file and a fresh in-memory redis, and
    the cached Settings singleton is cleared so env overrides apply.
    """
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setenv("REDIS_URL", "memory://")
    get_settings.cache_clear()

    await dispose_engine()
    await reset_redis_for_tests()
    await create_all()

    yield

    await dispose_engine()
    await reset_redis_for_tests()
    get_settings.cache_clear()


@pytest.fixture
async def db_session():
    async with session_scope() as session:
        yield session


@pytest.fixture
async def seeded_session(db_session):
    await seed_database(db_session)
    yield db_session
