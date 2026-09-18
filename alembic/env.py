"""Alembic entry point using the application's settings and async PostgreSQL."""

import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.database.base import Base
from app.models import load_models

settings = get_settings()
# Leave stdout clean for ``alembic upgrade head --sql`` output.
configure_logging(settings.log_level, stream="ext://sys.stderr")
load_models()
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Generate SQL without connecting or interpolating secrets through INI files."""
    context.configure(
        url=settings.database_url.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # A short-lived CLI process does not need the application's connection pool.
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        poolclass=pool.NullPool,
        connect_args={"timeout": settings.database_connect_timeout},
        hide_parameters=True,
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(do_run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
