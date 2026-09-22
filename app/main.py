"""Application composition: configuration, lifecycle, handlers, and routes."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from anyio import CapacityLimiter

from app.api.v1.router import router as api_v1_router
from app.core.body_limit import MULTIPART_OVERHEAD_BYTES, RequestBodyLimitMiddleware
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.database.session import create_database_engine, create_session_factory
from app.models import load_models
from app.storage.factory import create_storage

logger = logging.getLogger(__name__)

# Every verb the v1 routers expose; OPTIONS is answered by the middleware itself.
CORS_METHODS = ("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS")
# Authorization carries the JWT, Content-Type covers JSON and uploads, and Range
# lets a cross-origin media element seek.
CORS_REQUEST_HEADERS = ("Authorization", "Content-Type", "Range")
# Only what a player/downloader cannot already read: the rest of what the API
# returns (Content-Type, Content-Length, Cache-Control) is CORS-safelisted.
CORS_EXPOSED_HEADERS = ("Content-Range", "Accept-Ranges", "Content-Disposition")
CORS_PREFLIGHT_MAX_AGE_SECONDS = 600


def configure_cors(application: FastAPI, settings: Settings) -> None:
    """Allow the configured browser origins, and nothing else.

    CORS is a browser convenience, never an authorization boundary: every route
    still enforces its own JWT, role and enrollment rules. An empty origin list
    registers no middleware at all, which is correct for a same-origin
    deployment where the SPA is served from this host.
    """
    if not settings.cors_allowed_origins:
        return
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allowed_origins),
        # Tokens travel in the Authorization header and in the playback query
        # parameter, never in cookies, so the browser must not be invited to
        # attach credentials to cross-origin requests.
        allow_credentials=False,
        allow_methods=list(CORS_METHODS),
        allow_headers=list(CORS_REQUEST_HEADERS),
        expose_headers=list(CORS_EXPOSED_HEADERS),
        max_age=CORS_PREFLIGHT_MAX_AGE_SECONDS,
    )


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Own the pool for this application/worker and release it during shutdown."""
    load_models()
    engine = create_database_engine(application.state.settings)
    application.state.database_engine = engine
    application.state.database_session_factory = create_session_factory(engine)
    # Each Argon2 job uses 64 MiB; bound concurrent hashing per worker.
    application.state.password_limiter = CapacityLimiter(2)
    # One storage adapter per worker; it holds the provider's HTTP client.
    application.state.storage = create_storage(application.state.settings)
    logger.info(
        "Application started",
        extra={"environment": application.state.settings.environment},
    )
    try:
        yield
    finally:
        await application.state.storage.aclose()
        await engine.dispose()
        logger.info("Application stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application; explicit settings keep tests isolated from .env."""
    settings = settings if settings is not None else get_settings()
    configure_logging(settings.log_level)

    application = FastAPI(
        title=settings.name,
        description=settings.description,
        version=settings.version,
        debug=False,
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/api/v1/openapi.json" if settings.docs_enabled else None,
        openapi_tags=[
            {"name": "health", "description": "Application and database health checks."},
        ],
    )
    application.state.settings = settings
    # Added before CORS so that CORS ends up the outer layer: a refused upload
    # still answers a browser with the headers it needs to read the 413. The
    # limit itself is the configured maximum upload plus the multipart framing
    # around it, so no legitimate upload is affected.
    application.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_bytes=settings.storage_max_upload_bytes + MULTIPART_OVERHEAD_BYTES,
    )
    configure_cors(application, settings)
    register_exception_handlers(application)
    application.include_router(api_v1_router, prefix="/api/v1")
    return application


app = create_app()
