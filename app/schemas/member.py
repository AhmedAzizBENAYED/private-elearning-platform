"""Strict member inputs and explicit safe response allowlists."""

from typing import Annotated

from pydantic import (
    BaseModel, ConfigDict, EmailStr, Field, SecretStr, StringConstraints,
    field_validator, model_validator,
)

from app.schemas.auth import UserResponse
from app.schemas.pagination import Pagination

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class MemberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("email", mode="before", check_fields=False)
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class MemberCreate(MemberInput):
    email: EmailStr = Field(max_length=320)
    first_name: Name
    last_name: Name


class MemberUpdate(MemberInput):
    email: EmailStr | None = Field(default=None, max_length=320)
    first_name: Name | None = None
    last_name: Name | None = None

    @model_validator(mode="after")
    def require_changes(self) -> "MemberUpdate":
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Provide at least one non-null profile field")
        return self


class MemberStatus(MemberInput):
    is_active: bool = Field(strict=True)


class MemberQuery(Pagination):
    search: str | None = Field(default=None, max_length=320, description="Literal substring in name or email")
    is_active: bool | None = None


class MemberResponse(UserResponse):
    pass


class MemberCreated(BaseModel):
    member: MemberResponse
    activation_token: str | None = Field(
        default=None, repr=False, description="One-time password setup token; development/test only"
    )


class PasswordSetup(MemberInput):
    token: SecretStr = Field(min_length=43, max_length=43)
    password: SecretStr = Field(min_length=12, max_length=1024)
