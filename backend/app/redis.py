"""Redis access. REDIS_URL="memory://" uses an in-process fakeredis
singleton (no server needed); any redis:// URL uses a real async client.
Same interface either way (fakeredis is a drop-in for redis.asyncio),
so callers never branch on which backend is active.
"""

from __future__ import annotations

from typing import Protocol

from app.config import get_settings


class RedisLike(Protocol):
    async def get(self, name: str) -> bytes | None: ...
    async def set(self, name: str, value: str, ex: int | None = None) -> bool | None: ...
    async def incr(self, name: str) -> int: ...
    async def expire(self, name: str, time: int) -> bool: ...
    async def delete(self, *names: str) -> int: ...
    async def ping(self) -> bool: ...
    async def flushdb(self) -> bool: ...


_client: RedisLike | None = None


def get_redis() -> RedisLike:
    global _client
    if _client is None:
        _client = _build_client()
    return _client


def _build_client() -> RedisLike:
    url = get_settings().redis_url
    if url.startswith("memory://"):
        import fakeredis.aioredis as fakeredis_aioredis

        return fakeredis_aioredis.FakeRedis()
    import redis.asyncio as redis_asyncio

    return redis_asyncio.from_url(url)


async def reset_redis_for_tests() -> None:
    """Drop the singleton so the next get_redis() starts clean. Used by
    the test fixture between tests to avoid budget/cache bleed-through.
    """
    global _client
    if _client is not None:
        try:
            await _client.flushdb()
        except Exception:
            pass
    _client = None
