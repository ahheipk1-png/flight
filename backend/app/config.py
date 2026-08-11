"""Central settings, loaded from the repo-root .env (see .env.example).

REPO_ROOT/backend/app/config.py -> parents[2] is REPO_ROOT.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_DIR = REPO_ROOT / "data" / "seed"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Storage ---
    # Default targets a local SQLite file so the app runs with zero infra.
    # Set to the Postgres URL in .env once `docker compose up -d` is healthy.
    database_url: str = "sqlite+aiosqlite:///./dev.db"
    # "memory://" uses an in-process fakeredis stand-in; set to a real
    # redis:// URL once Docker/Redis is available. Same code path either way.
    redis_url: str = "memory://"

    cors_origins: str = "http://localhost:3000"
    default_currency: str = "CAD"

    # --- Accounts ---
    # No fallback: every search runs on the requesting user's OWN stored
    # SerpApi key, not a server-wide one (see providers/duffel.py's sibling
    # module for why per-user keys exist at all -- this is that design,
    # made mandatory). New accounts land in status="pending" and can't log
    # in until an admin approves them (app/cli.py's `make-admin` bootstraps
    # the first admin). Passwords are argon2-hashed, never stored
    # recoverable. API keys ARE stored recoverable (Fernet, symmetric) --
    # unlike a password, the app must be able to use this value on the
    # user's behalf for every search, so one-way hashing doesn't apply;
    # encryption at rest is the right control here instead.
    #
    # api_key_encryption_key MUST be a real Fernet key (44 url-safe base64
    # chars) -- generate one with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # No auto-generated fallback on purpose: this restarts often in dev
    # (uvicorn --reload, manual restarts), and a fresh key every restart
    # would silently make every already-stored API key undecryptable.
    # Startup fails loudly instead if this is missing -- see factory.py.
    api_key_encryption_key: str = ""
    session_ttl_seconds: int = 60 * 60 * 24 * 30  # 30 days, matches the reference app's session lifetime

    # --- Fare provider ---
    fare_provider: Literal["auto", "mock", "serpapi", "duffel"] = "auto"
    serpapi_api_key: str = ""
    duffel_api_key: str = ""

    # --- Budget guard (live provider calls only; mock provider is free).
    # Each paid provider has its own pool since only one is ever active at
    # a time (effective_fare_provider) but their per-call cost differs a
    # lot: SerpApi ~$0.01-0.025/search flat, Duffel ~$0.005/search once its
    # own search-to-book ratio is exceeded (this app has no booking flow,
    # so treat every Duffel call as billed at that rate). Both sets of
    # defaults target a similar ~$25-40/month ceiling for a hobby-scale
    # deployment, not a specific search count. ---
    serpapi_daily_budget: int = 150
    serpapi_monthly_budget: int = 1500
    duffel_daily_budget: int = 200
    duffel_monthly_budget: int = 5000
    per_search_live_cap: int = 20
    live_discovery_calls_per_search: int = 6
    # verify_top pairs every origin variant of a trip together (see
    # search/pruning.py's CandidateGroup) so alt-origin results always have
    # a primary-origin price to compare against. With 4 Toronto-group
    # origins, 16 verifies ~4 destination/date neighborhoods per search.
    verify_top_n: int = 16

    # --- Cache TTLs (seconds) ---
    fare_cache_ttl_discovery: int = 21600
    fare_cache_ttl_verified: int = 1800
    fare_cache_ttl_empty: int = 3600

    # --- Search pipeline tuning (kept here for cheap re-tuning) ---
    coarse_date_stride_days: int = 4
    coarse_expand_window_days: int = 3
    prune_top_cells: int = 6
    prune_max_candidates: int = 40
    prune_overshoot_ratio: float = 1.15
    best_score_ground_cost_weight: float = 2.0
    best_score_duration_cost_per_hour: float = 8.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_fare_provider(self) -> Literal["mock", "serpapi", "duffel"]:
        if self.fare_provider == "auto":
            # Prefer Duffel when both keys happen to be configured: cheaper
            # per-call, and full (not just outbound-indicative) round-trip
            # detail. SerpApi remains a fully supported explicit choice
            # (FARE_PROVIDER=serpapi) either way.
            if self.duffel_api_key:
                return "duffel"
            if self.serpapi_api_key:
                return "serpapi"
            return "mock"
        return self.fare_provider


@lru_cache
def get_settings() -> Settings:
    return Settings()
