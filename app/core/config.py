"""Typed configuration loaded once from environment variables and .env."""

import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

from app.storage.models import StorageProvider

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MEDIA_TYPE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$")
# A browser Origin is scheme://host[:port] exactly: no path, no trailing slash.
ORIGIN = re.compile(r"^https?://(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$")
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "[::1]"})


def origin_host(origin: str) -> str:
    """Return an origin's host, dropping the scheme and any port."""
    host = origin.split("://", 1)[-1]
    if host.startswith("["):
        return host[: host.index("]") + 1]
    return host.rsplit(":", 1)[0] if ":" in host else host


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="APP_",
        extra="ignore",
        frozen=True,
        populate_by_name=True,
        hide_input_in_errors=True,
    )

    name: str = Field(default="Private E-Learning Platform", min_length=1)
    description: str = "Private e-learning platform backend API."
    version: str = Field(default="0.1.0", min_length=1)
    environment: Literal["development", "test", "staging", "production"] = (
        "development"
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    docs_enabled: bool = True
    activation_token_expire_minutes: int = Field(default=30, ge=1, le=60)
    video_completion_tolerance_seconds: int = Field(default=2, ge=0, le=10)

    jwt_secret_key: SecretStr = Field(validation_alias="JWT_SECRET_KEY", repr=False)
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = Field(
        default="HS256", validation_alias="JWT_ALGORITHM"
    )
    access_token_expire_minutes: int = Field(
        default=15, ge=1, le=60, validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES"
    )
    refresh_token_expire_days: int = Field(
        default=7, ge=1, le=90, validation_alias="REFRESH_TOKEN_EXPIRE_DAYS"
    )
    # Lesson-scoped media playback only; never long enough to be a session.
    playback_token_expire_minutes: int = Field(
        default=30, ge=1, le=240, validation_alias="PLAYBACK_TOKEN_EXPIRE_MINUTES"
    )

    @model_validator(mode="after")
    def validate_jwt_key(self) -> "Settings":
        minimum_bytes = {"HS256": 32, "HS384": 48, "HS512": 64}[self.jwt_algorithm]
        if len(self.jwt_secret_key.get_secret_value().encode("utf-8")) < minimum_bytes:
            raise ValueError(f"JWT_SECRET_KEY must contain at least {minimum_bytes} bytes")
        return self

    # Explicit aliases keep database variables independent of the APP_ prefix.
    database_url: SecretStr = Field(validation_alias="DATABASE_URL", repr=False)
    database_pool_size: int = Field(
        default=5, ge=1, validation_alias="DATABASE_POOL_SIZE"
    )
    database_max_overflow: int = Field(
        default=10, ge=0, validation_alias="DATABASE_MAX_OVERFLOW"
    )
    database_pool_timeout: float = Field(
        default=30.0, gt=0, allow_inf_nan=False,
        validation_alias="DATABASE_POOL_TIMEOUT",
    )
    database_connect_timeout: float = Field(
        default=5.0, gt=0, allow_inf_nan=False,
        validation_alias="DATABASE_CONNECT_TIMEOUT",
    )

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            url = make_url(value.get_secret_value())
        except (ArgumentError, ValueError):
            raise ValueError("DATABASE_URL must be a valid PostgreSQL asyncpg URL") from None
        if url.drivername != "postgresql+asyncpg" or not url.host or not url.database:
            raise ValueError(
                "DATABASE_URL must use postgresql+asyncpg and include a host and database"
            )
        return value


    # Storage stays provider neutral: only the adapter reads the Google settings.
    storage_provider: StorageProvider = Field(
        default=StorageProvider.MEMORY, validation_alias="STORAGE_PROVIDER"
    )
    storage_max_upload_bytes: int = Field(
        default=2 * 1024**3, ge=1024**2, le=64 * 1024**3,
        validation_alias="STORAGE_MAX_UPLOAD_BYTES",
    )
    storage_upload_chunk_bytes: int = Field(
        default=8 * 1024**2, ge=256 * 1024, le=64 * 1024**2,
        validation_alias="STORAGE_UPLOAD_CHUNK_BYTES",
    )
    # NoDecode for the same reason as CORS_ALLOWED_ORIGINS below: without it
    # pydantic-settings JSON-decodes these complex-typed environment variables
    # before parse_mime_types runs, so the documented comma-separated form fails.
    storage_video_mime_types: Annotated[frozenset[str], NoDecode] = Field(
        default=frozenset({"video/mp4"}), validation_alias="STORAGE_VIDEO_MIME_TYPES"
    )
    storage_document_mime_types: Annotated[frozenset[str], NoDecode] = Field(
        default=frozenset({"application/pdf"}), validation_alias="STORAGE_DOCUMENT_MIME_TYPES"
    )

    google_drive_client_id: str | None = Field(
        default=None, validation_alias="GOOGLE_DRIVE_CLIENT_ID"
    )
    google_drive_client_secret: SecretStr | None = Field(
        default=None, validation_alias="GOOGLE_DRIVE_CLIENT_SECRET", repr=False
    )
    google_drive_refresh_token: SecretStr | None = Field(
        default=None, validation_alias="GOOGLE_DRIVE_REFRESH_TOKEN", repr=False
    )
    google_drive_root_folder_id: str | None = Field(
        default=None, validation_alias="GOOGLE_DRIVE_ROOT_FOLDER_ID"
    )
    google_drive_timeout_seconds: float = Field(
        default=30.0, gt=0, le=600, allow_inf_nan=False,
        validation_alias="GOOGLE_DRIVE_TIMEOUT_SECONDS",
    )

    # Browser origins permitted to call this API. The default serves the local
    # Vite dev server; production must name its own origin. Never a wildcard.
    # NoDecode: without it pydantic-settings JSON-decodes a complex-typed
    # environment variable before any validator runs, so a comma-separated
    # CORS_ALLOWED_ORIGINS would fail to load from .env.
    cors_allowed_origins: Annotated[tuple[str, ...], NoDecode] = Field(
        default=("http://localhost:5173",), validation_alias="CORS_ALLOWED_ORIGINS"
    )

    @field_validator("storage_video_mime_types", "storage_document_mime_types", mode="before")
    @classmethod
    def parse_mime_types(cls, value: object) -> object:
        """Accept a comma-separated environment list of lowercase media types."""
        if isinstance(value, str):
            return frozenset(part.strip().lower() for part in value.split(",") if part.strip())
        return value

    @field_validator("storage_video_mime_types", "storage_document_mime_types")
    @classmethod
    def validate_mime_types(cls, value: frozenset[str]) -> frozenset[str]:
        if not value:
            raise ValueError("At least one media type must be allowed")
        if any(not MEDIA_TYPE.fullmatch(item) for item in value):
            raise ValueError("Allowed media types must look like type/subtype")
        return value

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        """Accept a comma-separated environment list of browser origins."""
        if isinstance(value, str):
            return tuple(part.strip() for part in value.split(",") if part.strip())
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_origins(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        """Reject wildcards and anything that is not an exact origin.

        ``*`` is refused outright: this API is private, and a wildcard would let
        any site on the internet read authenticated responses from a browser.
        """
        for origin in value:
            if not ORIGIN.fullmatch(origin):
                raise ValueError(
                    "CORS_ALLOWED_ORIGINS entries must look like https://app.example.com: "
                    "an exact scheme://host[:port] with no path, trailing slash or wildcard"
                )
        return value

    @model_validator(mode="after")
    def validate_cors(self) -> "Settings":
        """Stop a production deployment from inheriting the development origin."""
        if self.environment != "production":
            return self
        if not self.cors_allowed_origins:
            raise ValueError(
                "CORS_ALLOWED_ORIGINS must name the frontend origin in production"
            )
        if any(origin_host(origin) in LOOPBACK_HOSTS for origin in self.cors_allowed_origins):
            raise ValueError(
                "CORS_ALLOWED_ORIGINS must not allow a loopback origin in production"
            )
        return self

    @model_validator(mode="after")
    def validate_storage(self) -> "Settings":
        """Fail fast instead of discovering missing storage credentials at upload time."""
        if self.storage_provider == StorageProvider.MEMORY and self.environment == "production":
            raise ValueError("STORAGE_PROVIDER must be a durable provider in production")
        if self.storage_provider == StorageProvider.GOOGLE_DRIVE:
            missing = [
                name for name, value in (
                    ("GOOGLE_DRIVE_CLIENT_ID", self.google_drive_client_id),
                    ("GOOGLE_DRIVE_CLIENT_SECRET", self.google_drive_client_secret),
                    ("GOOGLE_DRIVE_REFRESH_TOKEN", self.google_drive_refresh_token),
                    ("GOOGLE_DRIVE_ROOT_FOLDER_ID", self.google_drive_root_folder_id),
                )
                if value is None
            ]
            if missing:
                raise ValueError(f"STORAGE_PROVIDER=google_drive requires {', '.join(missing)}")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Validate settings at startup and reuse them for this process."""
    return Settings()
