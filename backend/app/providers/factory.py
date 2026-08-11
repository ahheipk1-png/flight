from __future__ import annotations

from app.config import Settings, get_settings
from app.providers.base import FareProvider
from app.providers.duffel import build_duffel_provider
from app.providers.mock import mock_provider
from app.providers.serpapi_google_flights import build_serpapi_provider


def get_fare_provider(settings: Settings | None = None) -> FareProvider:
    settings = settings or get_settings()
    effective = settings.effective_fare_provider
    if effective == "duffel":
        if not settings.duffel_api_key:
            raise RuntimeError("FARE_PROVIDER=duffel but DUFFEL_API_KEY is not set")
        return build_duffel_provider(settings.duffel_api_key)
    if effective == "serpapi":
        if not settings.serpapi_api_key:
            raise RuntimeError("FARE_PROVIDER=serpapi but SERPAPI_API_KEY is not set")
        return build_serpapi_provider(settings.serpapi_api_key)
    return mock_provider
