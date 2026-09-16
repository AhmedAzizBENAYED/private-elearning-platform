"""Typed configuration loaded once from environment variables and .env."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="APP_",
        extra="ignore",
        frozen=True,
    )

    name: str = Field(default="Private E-Learning Platform", min_length=1)
    description: str = "Private e-learning platform backend API."
    version: str = Field(default="0.1.0", min_length=1)
    environment: Literal["development", "test", "staging", "production"] = (
        "development"
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    docs_enabled: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Validate settings at startup and reuse them for this process."""
    return Settings()
