"""Strict member inputs and explicit safe response allowlists."""

from typing import Annotated

from pydantic import (
    BaseModel, ConfigDict, EmailStr, Field, SecretStr, StringConstraints,
    field_validator, model_validator,
)

from app.schemas.auth import UserResponse
from app.schemas.pagination import Pagination

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

# The platform's one password policy. Every place a password is chosen - an
# administrator creating an account, a member finishing an invitation - reads
# it from here, so the rules cannot drift apart. Length only: no composition
# rule is enforced anywhere in the backend. SecretStr keeps the value out of
# reprs, validation errors and logs.
Password = Annotated[SecretStr, Field(min_length=12, max_length=1024)]


class MemberInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("email", mode="before", check_fields=False)
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class MemberCreate(MemberInput):
    """What an administrator provides to open an account.

    The initial password is set here, by the administrator, and the account is
    usable at once: there is no invitation to deliver and nothing to activate.
    Role and status are deliberately absent - `extra="forbid"` rejects them -
    because the server decides both.
    """

    email: EmailStr = Field(max_length=320)
    first_name: Name
    last_name: Name
    password: Password


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
    password: Password


class ProfileUpdate(MemberInput):
    """What a signed-in user may change about themselves: their name, nothing else.

    `extra="forbid"` refuses email, role, status, id and any password field,
    so this contract cannot be used to escalate or to bypass the password
    change's current-password check.
    """

    first_name: Name | None = None
    last_name: Name | None = None

    @model_validator(mode="after")
    def require_changes(self) -> "ProfileUpdate":
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Provide at least one non-null profile field")
        return self


class PasswordChange(MemberInput):
    """A signed-in user replacing their own password.

    The current password is required and verified, so a session left open is
    not enough to lock its owner out. It is accepted like a sign-in password
    (any non-empty value): the policy applies only to the one being chosen.
    """

    current_password: SecretStr = Field(min_length=1, max_length=1024)
    new_password: Password
