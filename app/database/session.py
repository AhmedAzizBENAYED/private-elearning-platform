"""Async PostgreSQL infrastructure and request-scoped session injection."""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated, cast

from asyncpg import PostgresError
from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings

logger = logging.getLogger(__name__)
DATABASE_HEALTH_TIMEOUT_SECONDS = 5.0


def create_database_engine(settings: Settings) -> AsyncEngine:
    """Create a lazy connection pool; construction does not contact PostgreSQL."""
    return create_async_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_timeout=settings.database_pool_timeout,
        connect_args={"timeout": settings.database_connect_timeout},
        hide_parameters=True,
        echo=False,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield one session and close it on every exit, rolling back unfinished work.

    Callers own transaction boundaries, for example ``async with session.begin()``.
    This dependency never commits implicitly. Never share a session across tasks.
    """
    factory = cast(
        async_sessionmaker[AsyncSession], request.app.state.database_session_factory
    )
    async with factory() as session:
        yield session


DatabaseSession = Annotated[AsyncSession, Depends(get_db_session)]


async def check_database_connection(session: AsyncSession) -> bool:
    """Run a bounded read-only probe without logging credentials or driver text."""
    try:
        async with asyncio.timeout(DATABASE_HEALTH_TIMEOUT_SECONDS):
            await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, PostgresError, OSError, TimeoutError) as exc:
        logger.warning("Database health check failed (%s)", type(exc).__name__)
        return False
    return True
