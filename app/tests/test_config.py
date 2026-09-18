"""Configuration loading, precedence, validation, and caching."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings


def test_dotenv_loading_and_environment_precedence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        'APP_NAME="Test platform"\nAPP_LOG_LEVEL=WARNING\nAPP_DOCS_ENABLED=false\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("APP_LOG_LEVEL", "ERROR")

    settings = Settings(_env_file=env_file)

    assert settings.name == "Test platform"
    assert settings.log_level == "ERROR"
    assert settings.docs_enabled is False


@pytest.mark.parametrize(
    ("key", "value"),
    [("APP_LOG_LEVEL", "VERBOSE"), ("APP_ENVIRONMENT", "prodution")],
)
def test_invalid_configuration_fails_fast(
    monkeypatch: pytest.MonkeyPatch, key: str, value: str
) -> None:
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_configuration_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("APP_NAME", "Cached platform")
    try:
        first = get_settings()
        monkeypatch.setenv("APP_NAME", "Changed platform")
        assert get_settings() is first
        assert get_settings().name == "Cached platform"
    finally:
        get_settings.cache_clear()


def test_database_url_is_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATABASE_URL")

    with pytest.raises(ValidationError, match="DATABASE_URL"):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "url",
    [
        "not-a-url",
        "sqlite+aiosqlite:///database.db",
        "postgresql://localhost/example",
        "postgresql+asyncpg://localhost",
        "postgresql+asyncpg:///example",
        "postgresql+asyncpg://localhost:invalid/example",
    ],
)
def test_database_url_rejects_invalid_driver_or_address(url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url=url)


def test_database_credentials_are_hidden_in_settings_and_errors() -> None:
    secret = "example-private-password"
    settings = Settings(
        _env_file=None,
        database_url=f"postgresql+asyncpg://example:{secret}@localhost/example",
    )

    assert secret not in repr(settings)
    assert secret not in settings.model_dump_json()
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, database_url=f"invalid://example:{secret}@host/db")
    assert secret not in str(error.value)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("DATABASE_POOL_SIZE", "0"),
        ("DATABASE_MAX_OVERFLOW", "-1"),
        ("DATABASE_POOL_TIMEOUT", "0"),
        ("DATABASE_CONNECT_TIMEOUT", "-1"),
        ("DATABASE_CONNECT_TIMEOUT", "inf"),
    ],
)
def test_database_pool_settings_are_validated(
    monkeypatch: pytest.MonkeyPatch, key: str, value: str
) -> None:
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_database_url_dotenv_interpolation_and_environment_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATABASE_URL")
    env_file = tmp_path / ".env"
    env_file.write_text(
        "POSTGRES_USER=example\nPOSTGRES_PASSWORD=example-password\n"
        "POSTGRES_DB=example\nPOSTGRES_PORT=5432\n"
        'DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}'
        '@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"\n',
        encoding="utf-8",
    )

    assert Settings(_env_file=env_file).database_url.get_secret_value() == (
        "postgresql+asyncpg://example:example-password@localhost:5432/example"
    )
    override = "postgresql+asyncpg://localhost/override"
    monkeypatch.setenv("DATABASE_URL", override)
    assert Settings(_env_file=env_file).database_url.get_secret_value() == override
