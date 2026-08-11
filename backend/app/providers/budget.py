"""Hard spending cap on live fare-provider calls (currently SerpApi and
Duffel; anything that isn't the free mock provider). Redis counters are
the fast path checked before every live call; app/models/fares.py:
ApiCallLog is the durable audit trail a human can query later (written by
the caller, services/fares.py, after a successful reservation).

Each paid provider gets its own independent counter pool (keyed by
provider name) and its own configured limits, since only one provider is
ever active at a time (see Settings.effective_fare_provider) but they
have very different per-call costs -- see BudgetGuard.for_provider.
"""

from __future__ import annotations

import datetime as dt

from app.config import Settings
from app.redis import RedisLike


class BudgetExhausted(RuntimeError):
    def __init__(self, provider: str, scope: str, limit: int):
        self.provider = provider
        self.scope = scope
        self.limit = limit
        super().__init__(f"{provider} {scope} budget exhausted (limit={limit})")


class BudgetGuard:
    def __init__(self, redis: RedisLike, *, provider: str, daily_limit: int, monthly_limit: int):
        self._redis = redis
        self._provider = provider
        self._daily_limit = daily_limit
        self._monthly_limit = monthly_limit

    @classmethod
    def for_provider(cls, provider: str, redis: RedisLike, settings: Settings) -> "BudgetGuard":
        if provider == "duffel":
            return cls(
                redis,
                provider="duffel",
                daily_limit=settings.duffel_daily_budget,
                monthly_limit=settings.duffel_monthly_budget,
            )
        return cls(
            redis,
            provider="serpapi",
            daily_limit=settings.serpapi_daily_budget,
            monthly_limit=settings.serpapi_monthly_budget,
        )

    def _day_key(self, now: dt.datetime) -> str:
        return f"{self._provider}:budget:day:{now:%Y%m%d}"

    def _month_key(self, now: dt.datetime) -> str:
        return f"{self._provider}:budget:month:{now:%Y%m}"

    async def status(self, now: dt.datetime | None = None) -> dict:
        now = now or dt.datetime.now(dt.UTC)
        day_raw = await self._redis.get(self._day_key(now))
        month_raw = await self._redis.get(self._month_key(now))
        day_count = int(day_raw or 0)
        month_count = int(month_raw or 0)
        return {
            "provider": self._provider,
            "day_count": day_count,
            "day_limit": self._daily_limit,
            "day_remaining": max(0, self._daily_limit - day_count),
            "month_count": month_count,
            "month_limit": self._monthly_limit,
            "month_remaining": max(0, self._monthly_limit - month_count),
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
            raise BudgetExhausted(self._provider, "daily", status["day_limit"])
        if status["month_count"] >= status["month_limit"]:
            raise BudgetExhausted(self._provider, "monthly", status["month_limit"])

        day_key, month_key = self._day_key(now), self._month_key(now)
        await self._redis.incr(day_key)
        await self._redis.expire(day_key, 60 * 60 * 48)
        await self._redis.incr(month_key)
        await self._redis.expire(month_key, 60 * 60 * 24 * 40)
