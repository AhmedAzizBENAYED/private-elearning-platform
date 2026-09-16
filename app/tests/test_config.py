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
