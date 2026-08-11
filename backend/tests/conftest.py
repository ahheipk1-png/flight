from __future__ import annotations

import httpx
import pytest
from cryptography.fernet import Fernet

from app.config import get_settings
from app.db import create_all, dispose_engine, session_scope
from app.redis import reset_redis_for_tests
from app.services.geo import seed_database

# Fixed (not per-run-generated) so any test that hardcodes a ciphertext
# fixture -- none do today, but a future one plausibly might -- stays
# decryptable. Test-only; never used outside this fixture.
TEST_ENCRYPTION_KEY = Fernet.generate_key().decode()


@pytest.fixture(autouse=True)
async def _isolated_env(tmp_path, monkeypatch):
    """Every test gets a fresh SQLite file and a fresh in-memory redis, and
    the cached Settings singleton is cleared so env overrides apply.
    """
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setenv("REDIS_URL", "memory://")
    monkeypatch.setenv("API_KEY_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY)
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


@pytest.fixture
async def client():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
