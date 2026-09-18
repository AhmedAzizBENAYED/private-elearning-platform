"""Database lifecycle and health contracts without requiring a running server."""

import asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

import pytest
from asyncpg import InvalidPasswordError
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.database import session as database
from app.database.base import Base
from app.database.session import DatabaseSession, get_db_session
from app.models import load_models


@pytest.mark.anyio
async def test_factory_creates_independent_sessions(settings: Settings) -> None:
    engine = database.create_database_engine(settings)
    factory = database.create_session_factory(engine)
    try:
        async with factory() as first, factory() as second:
            assert first is not second
            assert first.bind is engine
            assert first.sync_session.expire_on_commit is False
            assert first.autoflush is False
            assert not first.in_transaction()
    finally:
        await engine.dispose()


def test_request_sessions_close_unfinished_transactions_on_every_exit(
    application: FastAPI,
) -> None:
    sessions: list[AsyncSession] = []
    commits: list[Session] = []

    @application.get("/test/session/{fail}")
    async def use_session(fail: bool, session: DatabaseSession) -> dict[str, bool]:
        sessions.append(session)
        event.listen(session.sync_session, "after_commit", commits.append)
        # Starting a logical transaction does not open a database connection.
        await session.begin()
        if fail:
            raise RuntimeError("Simulated route failure")
        return {"active": session.in_transaction()}

    with TestClient(application, raise_server_exceptions=False) as client:
        assert client.get("/test/session/false").json() == {"active": True}
        assert client.get("/test/session/true").status_code == 500
        assert client.get("/test/session/false").status_code == 200

    assert len({id(session) for session in sessions}) == 3
    assert all(not session.in_transaction() for session in sessions)
    assert commits == []


def test_engine_pool_is_disposed_on_shutdown(application: FastAPI) -> None:
    with TestClient(application):
        engine = application.state.database_engine
        assert isinstance(engine, AsyncEngine)
        original_pool = engine.pool

    # dispose() replaces the pool even when no physical connections were opened.
    assert engine.pool is not original_pool


@pytest.fixture
def mock_database_session(application: FastAPI) -> AsyncMock:
    session = AsyncMock(spec=AsyncSession)

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_db_session] = override_session
    return session


def test_database_health_connected(
    client: TestClient, mock_database_session: AsyncMock,
) -> None:
    response = client.get("/api/v1/health/db")

    assert response.status_code == 200
    assert response.json() == {"database": "connected"}
    mock_database_session.execute.assert_awaited_once()
    assert str(mock_database_session.execute.call_args.args[0]) == "SELECT 1"


@pytest.mark.parametrize(
    "failure",
    [
        OperationalError("SELECT 1", {}, Exception("private-driver-details")),
        InvalidPasswordError("private-driver-details"),
        OSError("private-driver-details"),
        TimeoutError("private-driver-details"),
    ],
)
def test_database_health_unavailable_is_safe_and_liveness_stays_healthy(
    client: TestClient, mock_database_session: AsyncMock, failure: Exception,
) -> None:
    mock_database_session.execute.side_effect = failure

    response = client.get("/api/v1/health/db")

    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
    assert "private-driver-details" not in response.text
    assert client.get("/api/v1/health").status_code == 200


@pytest.mark.anyio
async def test_database_health_timeout_is_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = AsyncMock(spec=AsyncSession)

    async def hang(_statement: object) -> None:
        await asyncio.Event().wait()

    session.execute.side_effect = hang
    monkeypatch.setattr(database, "DATABASE_HEALTH_TIMEOUT_SECONDS", 0.01)

    assert await database.check_database_connection(session) is False


@pytest.mark.anyio
async def test_database_health_does_not_swallow_cancellation() -> None:
    session = AsyncMock(spec=AsyncSession)
    session.execute.side_effect = asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await database.check_database_connection(session)


def test_identity_model_is_registered() -> None:
    load_models()
    assert set(Base.metadata.tables) == {"users"}
