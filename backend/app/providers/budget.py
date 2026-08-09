"""Hard spending cap on live SerpApi calls. Redis counters are the fast
path checked before every live call; app/models/fares.py:ApiCallLog is
the durable audit trail a human can query later (written by the caller,
services/fares.py, after a successful reservation).
"""

from __future__ import annotations

import datetime as dt

from app.config import Settings
from app.redis import RedisLike


class BudgetExhausted(RuntimeError):
    def __init__(self, scope: str, limit: int):
        self.scope = scope
        self.limit = limit
        super().__init__(f"SerpApi {scope} budget exhausted (limit={limit})")


class BudgetGuard:
    def __init__(self, redis: RedisLike, settings: Settings):
        self._redis = redis
        self._settings = settings

    @staticmethod
    def _day_key(now: dt.datetime) -> str:
        return f"serpapi:budget:day:{now:%Y%m%d}"

    @staticmethod
    def _month_key(now: dt.datetime) -> str:
        return f"serpapi:budget:month:{now:%Y%m}"

    async def status(self, now: dt.datetime | None = None) -> dict:
        now = now or dt.datetime.now(dt.UTC)
        day_raw = await self._redis.get(self._day_key(now))
        month_raw = await self._redis.get(self._month_key(now))
        day_count = int(day_raw or 0)
        month_count = int(month_raw or 0)
        return {
            "day_count": day_count,
            "day_limit": self._settings.serpapi_daily_budget,
            "day_remaining": max(0, self._settings.serpapi_daily_budget - day_count),
            "month_count": month_count,
            "month_limit": self._settings.serpapi_monthly_budget,
            "month_remaining": max(0, self._settings.serpapi_monthly_budget - month_count),
        }

    async def try_reserve(self, now: dt.datetime | None = None) -> None:
        """Raise BudgetExhausted if either cap is already hit; otherwise
        increment both counters. Counting is pessimistic -- a counter is
        not decremented if the downstream call later fails -- so budget
        only ever tightens conservatively, never drifts optimistic.
        """
        now = now or dt.datetime.now(dt.UTC)
        status = await self.status(now)
        if status["day_count"] >= status["day_limit"]:
            raise BudgetExhausted("daily", status["day_limit"])
        if status["month_count"] >= status["month_limit"]:
            raise BudgetExhausted("monthly", status["month_limit"])

        day_key, month_key = self._day_key(now), self._month_key(now)
        await self._redis.incr(day_key)
        await self._redis.expire(day_key, 60 * 60 * 48)
        await self._redis.incr(month_key)
        await self._redis.expire(month_key, 60 * 60 * 24 * 40)
