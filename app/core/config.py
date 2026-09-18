"""Typed configuration loaded once from environment variables and .env."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

PROJECT_ROOT = Path(__file__).resolve().parents[2]


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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Validate settings at startup and reuse them for this process."""
    return Settings()
