"""Authentication use cases and the single JWT issuance/validation boundary."""

import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal
from uuid import UUID, uuid4

import jwt
from anyio import CapacityLimiter, to_thread
from pydantic import BaseModel, ConfigDict, ValidationError

from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.models.user import User, UserRole
from app.repositories.user_repository import UserRepository
from app.schemas.auth import TokenResponse

TokenType = Literal["access", "refresh"]


class AuthenticationError(Exception):
    """Invalid credentials, token, or unavailable identity."""


class TokenClaims(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sub: UUID
    role: UserRole
    token_type: TokenType
    jti: UUID
    iat: int
    nbf: int
    exp: int


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return hash_password(secrets.token_urlsafe(32))


def _check_password(password: str, user_hash: str | None) -> bool:
    # Unknown emails still pay the cost of an Argon2 verification.
    dummy = _dummy_password_hash()
    return verify_password(password, user_hash if user_hash is not None else dummy)


class AuthService:
    def __init__(
        self, settings: Settings, users: UserRepository, password_limiter: CapacityLimiter
    ) -> None:
        self.settings = settings
        self.users = users
        self.password_limiter = password_limiter

    async def login(self, email: str, password: str) -> TokenResponse:
        user = await self.users.get_by_email(email)
        valid = await to_thread.run_sync(
            _check_password, password, user.hashed_password if user else None,
            limiter=self.password_limiter,
        )
        if user is None or not valid or not user.is_active:
            raise AuthenticationError("Invalid email or password")
        return self.issue_tokens(user)

    def issue_tokens(self, user: User) -> TokenResponse:
        if not user.is_active:
            raise AuthenticationError("Inactive user")
        return TokenResponse(
            access_token=self._encode(user, "access", timedelta(
                minutes=self.settings.access_token_expire_minutes)),
            refresh_token=self._encode(user, "refresh", timedelta(
                days=self.settings.refresh_token_expire_days)),
        )

    def _encode(self, user: User, token_type: TokenType, lifetime: timedelta) -> str:
        now = datetime.now(timezone.utc)
        return jwt.encode(
            {"sub": str(user.id), "role": user.role.value, "token_type": token_type,
             "jti": str(uuid4()), "iat": now, "nbf": now, "exp": now + lifetime},
            self.settings.jwt_secret_key.get_secret_value(),
            algorithm=self.settings.jwt_algorithm,
        )

    def decode_token(self, token: str, expected_type: TokenType = "access") -> TokenClaims:
        try:
            payload = jwt.decode(
                token, self.settings.jwt_secret_key.get_secret_value(),
                algorithms=[self.settings.jwt_algorithm],
                options={"require": ["sub", "role", "token_type", "jti", "iat", "nbf", "exp"]},
            )
            claims = TokenClaims.model_validate(payload)
            if claims.token_type != expected_type or claims.exp <= claims.iat:
                raise AuthenticationError("Invalid token")
            return claims
        except (jwt.InvalidTokenError, ValidationError, ValueError, TypeError) as exc:
            raise AuthenticationError("Invalid token") from exc

    async def current_user(self, token: str) -> User:
        claims = self.decode_token(token, expected_type="access")
        user = await self.users.get_by_id(claims.sub)
        if user is None or not user.is_active:
            raise AuthenticationError("Invalid token")
        # The database role is authoritative, even if a JWT carries an old role.
        return user
