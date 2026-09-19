"""Public authentication contracts, deliberately excluding password hashes."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator

from app.models.user import UserRole


class LoginRequest(BaseModel):
    email: EmailStr = Field(max_length=320)
    password: SecretStr = Field(min_length=1, max_length=1024)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class RefreshRequest(BaseModel):
    """Only the refresh token; the identity comes from the token itself."""

    model_config = ConfigDict(extra="forbid")

    # SecretStr keeps the credential out of reprs and validation error output,
    # matching how passwords and activation tokens are accepted elsewhere.
    refresh_token: SecretStr = Field(min_length=1, max_length=4096)


class AccessTokenResponse(BaseModel):
    """A renewed access token. Deliberately carries nothing else."""

    access_token: str = Field(repr=False)
    token_type: Literal["bearer"] = "bearer"


class TokenResponse(AccessTokenResponse):
    refresh_token: str = Field(repr=False)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    first_name: str
    last_name: str
    is_active: bool
    role: UserRole
    created_at: datetime
    updated_at: datetime
