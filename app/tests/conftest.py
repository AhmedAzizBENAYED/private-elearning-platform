"""Isolated application instances and clients shared by API tests."""

import os
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings

TEST_DATABASE_URL = "postgresql+asyncpg://test:test@127.0.0.1:1/test"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for key in os.environ:
        if key.upper().startswith(("APP_", "DATABASE_", "POSTGRES_", "JWT_", "ACCESS_TOKEN_", "REFRESH_TOKEN_")):
            monkeypatch.delenv(key)
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("JWT_SECRET_KEY", "test-only-signing-key-never-use-in-production-" * 2)
    monkeypatch.setenv("JWT_ALGORITHM", "HS256")
    monkeypatch.setenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
    monkeypatch.setenv("REFRESH_TOKEN_EXPIRE_DAYS", "7")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, environment="test")


@pytest.fixture
def application(settings: Settings) -> FastAPI:
    from app.main import create_app

    return create_app(settings)


@pytest.fixture
def client(application: FastAPI) -> Iterator[TestClient]:
    with TestClient(application) as test_client:
        yield test_client
