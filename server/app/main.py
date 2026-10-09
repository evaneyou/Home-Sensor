import asyncio
import logging
import os
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.enrollment_routes import router as enrollment_router
from app.api.routes import router
from app.config import get_settings

log = logging.getLogger(__name__)

try:
    __version__ = version("hns-server")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0+unknown"


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if os.environ.get("PYTEST_CURRENT_TEST"):
        yield
        return

    from app.db import SessionLocal
    from app.services.retention import run_retention
    from app.wireguard_tunnel import rewrite_peers

    try:
        with SessionLocal() as db:
            rewrite_peers(db)
    except Exception:
        log.exception("wireguard peer list was not written")

    async def _loop() -> None:
        while True:
            try:
                await asyncio.to_thread(run_retention)
            except Exception:
                log.exception("measurement retention failed")
            await asyncio.sleep(24 * 60 * 60)

    task = asyncio.create_task(_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="HomeNetWatch", version=__version__, lifespan=_lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(enrollment_router)
    return app


app = create_app()
