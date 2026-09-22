"""Authentication use cases and the single JWT issuance/validation boundary."""

import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Literal
from uuid import UUID, uuid4

import jwt
from anyio import CapacityLimiter, to_thread
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import Settings
from app.core.exceptions import BusinessError
from app.core.security import hash_password, verify_password
from app.models.user import User, UserRole
from app.repositories.revoked_token_repository import RevokedTokenRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import AccessTokenResponse, TokenResponse

TokenType = Literal["access", "refresh", "playback"]


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
    # Present only on playback tokens, binding one token to one lesson.
    lesson_id: UUID | None = None


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return hash_password(secrets.token_urlsafe(32))


def _check_password(password: str, user_hash: str | None) -> bool:
    # Unknown emails still pay the cost of an Argon2 verification.
    dummy = _dummy_password_hash()
    return verify_password(password, user_hash if user_hash is not None else dummy)


class AuthService:
    def __init__(
        self, settings: Settings, users: UserRepository,
        password_limiter: CapacityLimiter, revocations: RevokedTokenRepository,
    ) -> None:
        self.settings = settings
        self.users = users
        self.password_limiter = password_limiter
        # Required, not optional: `refresh` consults it on every call, and a
        # collaborator that could be omitted would be a revocation check that
        # could be omitted.
        self.revocations = revocations

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

    async def refresh(self, refresh_token: str) -> AccessTokenResponse:
        """Exchange a valid, unrevoked refresh token for a fresh access token.

        The refresh token is neither rotated nor extended, so it keeps exactly
        its original lifetime. The identity is reloaded from PostgreSQL rather
        than trusted from the token, which is what makes a deactivation or a
        role change take effect on the next refresh.

        Revocation is checked **before** any token is issued, and after the
        signature, expiry and type have been validated: a forged or expired
        token is refused on its own merits and never reaches the database.
        A token whose ``jti`` has been revoked is refused even though every
        cryptographic check passed - which is the whole point of the denylist.
        """
        claims = self.decode_token(refresh_token, expected_type="refresh")
        if await self.revocations.is_revoked(claims.jti):
            raise AuthenticationError("Invalid token")

        user = await self._active_user(claims)
        return AccessTokenResponse(access_token=self._encode(
            user, "access",
            timedelta(minutes=self.settings.access_token_expire_minutes),
        ))

    async def logout(self, refresh_token: str) -> None:
        """Revoke one refresh token, server-side and for good.

        Scoped to the token presented, so signing out in one browser leaves a
        session in another alone. There is no "sign out everywhere" here
        because the product has never offered one.

        Invalid, expired and wrong-type tokens are accepted silently rather
        than refused. RFC 7009 s2.2 takes the same position for token
        revocation - "invalid tokens do not cause an error response since the
        client cannot handle such an error in a reasonable way" - and there is
        nothing to protect: a token that cannot be decoded cannot be used to
        refresh either, and answering differently would turn sign-out into an
        oracle for whether a token is valid.

        An already-issued **access** token is deliberately untouched. It is a
        stateless bearer credential with a short life (15 minutes by default),
        and refusing it would mean a database lookup on every authenticated
        request - a different design, not a revocation fix.
        """
        try:
            claims = self.decode_token(refresh_token, expected_type="refresh")
        except AuthenticationError:
            return

        # The commit is the revocation. If it cannot be written, saying 204
        # would be a lie with a security consequence - the token would stay
        # usable while the caller believed the session was over - so the
        # failure is reported instead of swallowed.
        try:
            await self.revocations.revoke(
                claims.jti, claims.sub,
                datetime.fromtimestamp(claims.exp, tz=timezone.utc),
            )
            await self.revocations.session.commit()
        except SQLAlchemyError:
            await self.revocations.session.rollback()
            raise BusinessError(503, "Sign-out could not be completed") from None

    def issue_playback_token(self, user: User, lesson_id: UUID) -> str:
        """Mint a short-lived credential for streaming exactly one lesson's media.

        Deliberately not a session credential: it carries its own ``playback``
        type and a ``lesson_id``, so it cannot authenticate any other request,
        and a leaked media URL exposes one lesson to one member for minutes.
        """
        if not user.is_active:
            raise AuthenticationError("Inactive user")
        return self._encode(
            user, "playback",
            timedelta(minutes=self.settings.playback_token_expire_minutes),
            lesson_id=lesson_id,
        )

    def _encode(self, user: User, token_type: TokenType, lifetime: timedelta,
                lesson_id: UUID | None = None) -> str:
        now = datetime.now(timezone.utc)
        payload = {"sub": str(user.id), "role": user.role.value, "token_type": token_type,
                   "jti": str(uuid4()), "iat": now, "nbf": now, "exp": now + lifetime}
        if lesson_id is not None:
            payload["lesson_id"] = str(lesson_id)
        return jwt.encode(
            payload, self.settings.jwt_secret_key.get_secret_value(),
            algorithm=self.settings.jwt_algorithm,
        )

    def decode_token(self, token: str, expected_type: TokenType = "access",
                     lesson_id: UUID | None = None) -> TokenClaims:
        required = ["sub", "role", "token_type", "jti", "iat", "nbf", "exp"]
        if expected_type == "playback":
            required.append("lesson_id")
        try:
            payload = jwt.decode(
                token, self.settings.jwt_secret_key.get_secret_value(),
                algorithms=[self.settings.jwt_algorithm],
                options={"require": required},
            )
            claims = TokenClaims.model_validate(payload)
            if claims.token_type != expected_type or claims.exp <= claims.iat:
                raise AuthenticationError("Invalid token")
            # A playback token is bound to one lesson and is useless elsewhere.
            if lesson_id is not None and claims.lesson_id != lesson_id:
                raise AuthenticationError("Invalid token")
            return claims
        except (jwt.InvalidTokenError, ValidationError, ValueError, TypeError) as exc:
            raise AuthenticationError("Invalid token") from exc

    async def current_user(self, token: str) -> User:
        return await self._active_user(self.decode_token(token, expected_type="access"))

    async def playback_user(self, token: str, lesson_id: UUID) -> User:
        """Resolve the member a playback token was issued to, for this lesson only."""
        return await self._active_user(
            self.decode_token(token, expected_type="playback", lesson_id=lesson_id)
        )

    async def _active_user(self, claims: TokenClaims) -> User:
        user = await self.users.get_by_id(claims.sub)
        if user is None or not user.is_active:
            raise AuthenticationError("Invalid token")
        # The database role is authoritative, even if a JWT carries an old role.
        return user
