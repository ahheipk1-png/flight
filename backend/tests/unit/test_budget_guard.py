from __future__ import annotations

import pytest

from app.config import get_settings
from app.providers.budget import BudgetExhausted, BudgetGuard
from app.redis import get_redis


async def test_reserve_increments_and_reports_status():
    guard = BudgetGuard.for_provider("serpapi", get_redis(), get_settings())

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
    guard = BudgetGuard.for_provider("serpapi", get_redis(), get_settings())

    await guard.try_reserve()
    await guard.try_reserve()
    with pytest.raises(BudgetExhausted) as exc_info:
        await guard.try_reserve()
    assert exc_info.value.scope == "daily"
    assert exc_info.value.provider == "serpapi"


async def test_monthly_cap_raises_even_when_daily_has_room(monkeypatch):
    monkeypatch.setenv("SERPAPI_DAILY_BUDGET", "1000")
    monkeypatch.setenv("SERPAPI_MONTHLY_BUDGET", "1")
    get_settings.cache_clear()
    guard = BudgetGuard.for_provider("serpapi", get_redis(), get_settings())

    await guard.try_reserve()
    with pytest.raises(BudgetExhausted) as exc_info:
        await guard.try_reserve()
    assert exc_info.value.scope == "monthly"


async def test_duffel_and_serpapi_pools_are_independent(monkeypatch):
    monkeypatch.setenv("SERPAPI_DAILY_BUDGET", "1")
    monkeypatch.setenv("DUFFEL_DAILY_BUDGET", "5")
    get_settings.cache_clear()
    settings = get_settings()
    redis = get_redis()

    serpapi_guard = BudgetGuard.for_provider("serpapi", redis, settings)
    duffel_guard = BudgetGuard.for_provider("duffel", redis, settings)

    await serpapi_guard.try_reserve()
    with pytest.raises(BudgetExhausted) as exc_info:
        await serpapi_guard.try_reserve()
    assert exc_info.value.provider == "serpapi"

    # Exhausting serpapi's pool must not touch duffel's independent counter.
    duffel_status = await duffel_guard.status()
    assert duffel_status["day_count"] == 0
    assert duffel_status["day_limit"] == 5
    await duffel_guard.try_reserve()
    assert (await duffel_guard.status())["day_count"] == 1


async def test_for_provider_defaults_to_serpapi_for_unknown_name():
    guard = BudgetGuard.for_provider("mock", get_redis(), get_settings())
    assert (await guard.status())["provider"] == "serpapi"
