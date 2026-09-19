"""Configuration loading, precedence, validation, and caching."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings


@pytest.mark.parametrize("key,value", [
    ("JWT_SECRET_KEY", "short"), ("JWT_ALGORITHM", "none"),
    ("JWT_ALGORITHM", "RS256"), ("ACCESS_TOKEN_EXPIRE_MINUTES", "0"),
    ("ACCESS_TOKEN_EXPIRE_MINUTES", "61"), ("REFRESH_TOKEN_EXPIRE_DAYS", "0"),
    ("REFRESH_TOKEN_EXPIRE_DAYS", "91"),
])
def test_jwt_configuration_is_validated(monkeypatch: pytest.MonkeyPatch, key: str, value: str) -> None:
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize("value", ["0", "61"])
def test_activation_lifetime_is_bounded(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("APP_ACTIVATION_TOKEN_EXPIRE_MINUTES", value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


@pytest.mark.parametrize("value", ["-1", "11"])
def test_video_completion_tolerance_is_bounded(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("APP_VIDEO_COMPLETION_TOLERANCE_SECONDS", value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_jwt_secret_required_and_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(_env_file=None)
    secret = settings.jwt_secret_key.get_secret_value()
    assert secret not in repr(settings)
    assert secret not in settings.model_dump_json()
    monkeypatch.delenv("JWT_SECRET_KEY")
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
        Settings(_env_file=None)


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


# --------------------------- comma-separated list settings ---------------------------
# These are complex-typed settings fed by plain environment variables. They must be
# annotated NoDecode, or pydantic-settings JSON-decodes the value before the parsing
# validator runs and the documented comma-separated form fails to load at all.

VIDEO = "STORAGE_VIDEO_MIME_TYPES"
DOCUMENT = "STORAGE_DOCUMENT_MIME_TYPES"


def test_video_mime_types_parse_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(VIDEO, "video/mp4,video/webm,video/quicktime")

    settings = Settings(_env_file=None)

    assert settings.storage_video_mime_types == frozenset(
        {"video/mp4", "video/webm", "video/quicktime"})


def test_document_mime_types_parse_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(DOCUMENT, "application/pdf,application/msword")

    settings = Settings(_env_file=None)

    assert settings.storage_document_mime_types == frozenset(
        {"application/pdf", "application/msword"})


def test_mime_types_load_from_a_dotenv_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The reported symptom: these keys in .env used to abort settings loading."""
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join([
            f"{VIDEO}=video/mp4,video/webm",
            f"{DOCUMENT}=application/pdf,application/msword",
            "",
        ]),
        encoding="utf-8",
    )

    settings = Settings(_env_file=env_file)

    assert settings.storage_video_mime_types == frozenset({"video/mp4", "video/webm"})
    assert settings.storage_document_mime_types == frozenset(
        {"application/pdf", "application/msword"})


@pytest.mark.parametrize("value", [
    " video/mp4 , video/webm ",          # surrounding whitespace
    "video/mp4,video/webm,",             # trailing comma
    "video/mp4,,video/webm",             # empty element
    "VIDEO/MP4, Video/WebM",             # case is normalised
    "\tvideo/mp4,\nvideo/webm\n",        # stray whitespace characters
])
def test_mime_type_lists_tolerate_untidy_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv(VIDEO, value)

    assert Settings(_env_file=None).storage_video_mime_types == frozenset(
        {"video/mp4", "video/webm"})


def test_a_single_mime_type_needs_no_comma(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(VIDEO, "video/mp4")

    assert Settings(_env_file=None).storage_video_mime_types == frozenset({"video/mp4"})


def test_mime_types_keep_their_defaults_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(VIDEO, raising=False)
    monkeypatch.delenv(DOCUMENT, raising=False)

    settings = Settings(_env_file=None)

    assert settings.storage_video_mime_types == frozenset({"video/mp4"})
    assert settings.storage_document_mime_types == frozenset({"application/pdf"})


def test_mime_type_lists_stay_frozensets(monkeypatch: pytest.MonkeyPatch) -> None:
    """The public type is unchanged; only the decoding step was fixed."""
    monkeypatch.setenv(VIDEO, "video/mp4,video/webm")

    parsed = Settings(_env_file=None).storage_video_mime_types

    assert isinstance(parsed, frozenset)
    with pytest.raises(AttributeError):
        parsed.add("video/x-new")  # type: ignore[attr-defined]


@pytest.mark.parametrize("name", [VIDEO, DOCUMENT])
@pytest.mark.parametrize("value", ["", "   ", ",", " , "])
def test_an_empty_mime_type_list_is_rejected(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    """Existing rule, now actually reachable: at least one type must be allowed."""
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None)
    assert "At least one media type" in str(error.value)


@pytest.mark.parametrize("name", [VIDEO, DOCUMENT])
@pytest.mark.parametrize("value", [
    "video", "video/", "/mp4", "video/mp4/extra", "video mp4", "video/mp4,bogus",
])
def test_malformed_mime_types_are_rejected(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    """Existing validator, unchanged: entries must look like type/subtype."""
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None)
    assert "type/subtype" in str(error.value)


def test_json_list_syntax_is_no_longer_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    """Only the documented comma-separated form is supported, in either direction."""
    monkeypatch.setenv(VIDEO, '["video/mp4", "video/webm"]')

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_cors_origins_still_parse_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression guard: the sibling NoDecode setting is unaffected."""
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173, https://app.example.com")

    assert Settings(_env_file=None).cors_allowed_origins == (
        "http://localhost:5173", "https://app.example.com")


def test_all_comma_separated_settings_load_together(monkeypatch: pytest.MonkeyPatch) -> None:
    """A realistic .env sets every list setting at once."""
    monkeypatch.setenv(VIDEO, "video/mp4,video/webm")
    monkeypatch.setenv(DOCUMENT, "application/pdf,application/msword")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173")

    settings = Settings(_env_file=None)

    assert settings.storage_video_mime_types == frozenset({"video/mp4", "video/webm"})
    assert settings.storage_document_mime_types == frozenset(
        {"application/pdf", "application/msword"})
    assert settings.cors_allowed_origins == ("http://localhost:5173",)
