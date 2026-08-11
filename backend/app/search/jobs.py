"""In-process asyncio job registry for searches. State lives in Redis
(TTL 1h) so GET /api/search/{id} can report the single secondary status
line the spec's Search State UX calls for ("generating" | "pruning" |
"verifying" | "ranking" | "done" | "error") while the pipeline runs in
the background. Single-process only -- an accepted MVP 1 simplification
(see plan risks); a multi-worker deployment would need a real queue.
"""

from __future__ import annotations

import asyncio
import json
import uuid

from app.config import Settings, get_settings
from app.db import session_scope
from app.providers.base import FareProvider
from app.redis import RedisLike, get_redis
from app.schemas.search import MultiCitySearchRequest, SearchRequest
from app.search.pipeline import run_multi_city_search, run_search

JOB_TTL_SECONDS = 3600

# asyncio.create_task() doesn't keep its own strong reference -- without
# holding one somewhere, the task can be garbage-collected mid-run. This
# set is that anchor.
_background_tasks: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _job_key(search_id: str) -> str:
    return f"search:{search_id}"


async def _set_state(redis: RedisLike, search_id: str, **fields) -> None:
    current_raw = await redis.get(_job_key(search_id))
    current = json.loads(current_raw) if current_raw else {}
    current.update(fields)
    await redis.set(_job_key(search_id), json.dumps(current), ex=JOB_TTL_SECONDS)


async def get_state(search_id: str, redis: RedisLike | None = None) -> dict | None:
    redis = redis or get_redis()
    raw = await redis.get(_job_key(search_id))
    if raw is None:
        return None
    payload = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
    return json.loads(payload)


async def _run_job(search_id: str, req: SearchRequest, settings: Settings, provider: FareProvider) -> None:
    redis = get_redis()

    async def on_stage(stage_name: str) -> None:
        await _set_state(redis, search_id, status="running", stage=stage_name)

    try:
        async with session_scope() as session:
            result = await run_search(session, req, settings, on_stage=on_stage, provider=provider)

        await _set_state(
            redis,
            search_id,
            status="done",
            stage="done",
            degraded=result["degraded"],
            itineraries=[it.model_dump(mode="json") for it in result["itineraries"]],
            meta={
                "candidate_count": result["candidate_count"],
                "candidate_group_count": result["candidate_group_count"],
                "coarse_count": result["coarse_count"],
            },
        )
    except Exception as exc:  # noqa: BLE001 -- surfaced to the client via job state, not raised
        await _set_state(redis, search_id, status="error", stage="error", error=str(exc))


async def start_search(req: SearchRequest, provider: FareProvider, settings: Settings | None = None) -> str:
    """`provider` is required, not optional: every real search runs on the
    calling user's own FareProvider (built from their stored key by
    api/deps.py), never a site-wide default -- there is no fallback.
    """
    settings = settings or get_settings()
    search_id = uuid.uuid4().hex[:12]
    redis = get_redis()
    await _set_state(redis, search_id, status="running", stage="queued", degraded=False, itineraries=None)
    _spawn(_run_job(search_id, req, settings, provider))
    return search_id


async def _run_multi_city_job(
    search_id: str, req: MultiCitySearchRequest, settings: Settings, provider: FareProvider
) -> None:
    redis = get_redis()

    async def on_stage(stage_name: str) -> None:
        await _set_state(redis, search_id, status="running", stage=stage_name)

    try:
        async with session_scope() as session:
            result = await run_multi_city_search(session, req, settings, on_stage=on_stage, provider=provider)

        await _set_state(
            redis,
            search_id,
            status="done",
            stage="done",
            degraded=result["degraded"],
            itineraries=[it.model_dump(mode="json") for it in result["itineraries"]],
            meta={
                "candidate_count": result["candidate_count"],
                "candidate_group_count": result["candidate_group_count"],
                "coarse_count": result["coarse_count"],
            },
        )
    except Exception as exc:  # noqa: BLE001 -- surfaced to the client via job state, not raised
        await _set_state(redis, search_id, status="error", stage="error", error=str(exc))


async def start_multi_city_search(
    req: MultiCitySearchRequest, provider: FareProvider, settings: Settings | None = None
) -> str:
    """Manual multi-city's counterpart to start_search -- same job-state
    machinery (queued -> verifying -> ranking -> done, reusing the
    existing SearchStage vocabulary; run_multi_city_search never emits
    "generating"/"pruning" since it has no coarse grid to build).
    """
    settings = settings or get_settings()
    search_id = uuid.uuid4().hex[:12]
    redis = get_redis()
    await _set_state(redis, search_id, status="running", stage="queued", degraded=False, itineraries=None)
    _spawn(_run_multi_city_job(search_id, req, settings, provider))
    return search_id
