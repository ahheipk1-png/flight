from __future__ import annotations

import pytest

from app.config import get_settings
from app.providers.budget import BudgetExhausted, BudgetGuard
from app.redis import get_redis


async def test_reserve_increments_and_reports_status():
    guard = BudgetGuard(get_redis(), get_settings())

    status_before = await guard.status()
    assert status_before["day_count"] == 0

    await guard.try_reserve()
    await guard.try_reserve()

    status_after = await guard.status()
    assert status_after["day_count"] == 2
    assert status_after["month_count"] == 2
    assert status_after["day_remaining"] == status_before["day_limit"] - 2


async def test_daily_cap_raises_budget_exhausted(monkeypatch):
    monkeypatch.setenv("SERPAPI_DAILY_BUDGET", "2")
    get_settings.cache_clear()
    guard = BudgetGuard(get_redis(), get_settings())

    await guard.try_reserve()
    await guard.try_reserve()
    with pytest.raises(BudgetExhausted) as exc_info:
        await guard.try_reserve()
    assert exc_info.value.scope == "daily"


async def test_monthly_cap_raises_even_when_daily_has_room(monkeypatch):
    monkeypatch.setenv("SERPAPI_DAILY_BUDGET", "1000")
    monkeypatch.setenv("SERPAPI_MONTHLY_BUDGET", "1")
    get_settings.cache_clear()
    guard = BudgetGuard(get_redis(), get_settings())

    await guard.try_reserve()
    with pytest.raises(BudgetExhausted) as exc_info:
        await guard.try_reserve()
    assert exc_info.value.scope == "monthly"
