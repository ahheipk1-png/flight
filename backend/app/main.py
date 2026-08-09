from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_health import router as health_router
from app.api.routes_meta import router as meta_router
from app.api.routes_search import router as search_router
from app.config import get_settings
from app.db import dispose_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="SmartFlighter API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(meta_router)
    app.include_router(search_router)
    return app


app = create_app()
