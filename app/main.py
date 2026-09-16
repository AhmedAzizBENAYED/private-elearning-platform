"""Application composition: configuration, lifecycle, handlers, and routes."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.router import router as api_v1_router
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Own application-wide resources and their cleanup as the backend grows."""
    logger.info(
        "Application started",
        extra={"environment": application.state.settings.environment},
    )
    try:
        yield
    finally:
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
            {"name": "health", "description": "Application liveness checks."},
        ],
    )
    application.state.settings = settings
    register_exception_handlers(application)
    application.include_router(api_v1_router, prefix="/api/v1")
    return application


app = create_app()
