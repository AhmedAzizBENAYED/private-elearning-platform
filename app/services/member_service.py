"""Member lifecycle rules and transaction boundaries, independent of HTTP/email providers."""

import hashlib
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Protocol
from uuid import UUID

from anyio import CapacityLimiter, to_thread
from pydantic import SecretStr
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.config import Settings
from app.core.exceptions import BusinessError
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.repositories.member_repository import MemberRepository
from app.schemas.member import MemberCreate, MemberCreated, MemberQuery, MemberResponse, MemberUpdate
from app.schemas.pagination import Page

# An invalid Argon2 encoding: no password can authenticate a pending account.
PENDING_PASSWORD = "!activation-pending"


class ActivationDelivery(Protocol):
    """Future delivery adapter; implementations must never log/persist raw tokens."""

    async def send(self, email: str, token: SecretStr, expires_at: datetime) -> None: ...


class MemberService:
    def __init__(
        self, settings: Settings, members: MemberRepository,
        password_limiter: CapacityLimiter, delivery: ActivationDelivery | None = None,
    ) -> None:
        self.settings = settings
        self.members = members
        self.password_limiter = password_limiter
        self.delivery = delivery

    @asynccontextmanager
    async def _write(self) -> AsyncIterator[None]:
        try:
            yield
            await self.members.session.commit()
        except IntegrityError:
            await self.members.session.rollback()
            raise BusinessError(409, "Account conflicts with an existing member") from None
        except SQLAlchemyError:
            await self.members.session.rollback()
            raise BusinessError(503, "Member storage temporarily unavailable") from None
        except Exception:
            await self.members.session.rollback()
            raise

    async def _unique_email(self, email: str, user_id: UUID | None = None) -> None:
        existing = await self.members.get_by_email(email)
        if existing is not None and existing.id != user_id:
            raise BusinessError(409, "Email already in use")

    async def _member(self, user_id: UUID, *, lock: bool = False) -> User:
        user = await (self.members.lock_user(user_id) if lock else self.members.get_by_id(user_id))
        if user is None or user.role != UserRole.MEMBER:
            raise BusinessError(404, "Member not found")
        return user

    async def create(self, payload: MemberCreate) -> MemberResponse:
        """Open an active MEMBER account with the password the administrator chose.

        The account can sign in immediately: no invitation is issued and no
        activation token is stored. Role and status are set here and nowhere
        else - the request schema cannot carry them.

        The password is hashed before the transaction opens, exactly as
        ``setup_password`` does, so a slow Argon2 run never holds a row lock,
        and it runs under the same limiter that bounds concurrent hashing.
        """
        password_hash = await to_thread.run_sync(
            hash_password, payload.password.get_secret_value(), limiter=self.password_limiter,
        )
        async with self._write():
            await self._unique_email(str(payload.email))
            user = User(
                **payload.model_dump(exclude={"password"}),
                role=UserRole.MEMBER, is_active=True, hashed_password=password_hash,
                activation_token_hash=None, activation_expires_at=None,
            )
            self.members.session.add(user)
            await self.members.session.flush()
            await self.members.session.refresh(user)
            result = MemberResponse.model_validate(user)
        return result

    async def reissue_activation(self, user_id: UUID) -> MemberCreated:
        """Replace an expired/lost invitation; never reset an established password.

        Legacy since MEMBERS-01: new accounts are created with a password and
        never wait for one, so this only serves an account opened under the
        former invitation flow. An account created with a password is refused
        with 409 by the check below - reissuing can never replace a password.
        """
        token, expires_at = self._new_activation()
        async with self._write():
            user = await self._member(user_id, lock=True)
            if user.hashed_password != PENDING_PASSWORD or not user.is_active:
                raise BusinessError(409, "Activation requires an active account awaiting password setup")
            user.activation_token_hash = hashlib.sha256(token.encode()).hexdigest()
            user.activation_expires_at = expires_at
            await self.members.session.flush()
            await self.members.session.refresh(user)
            result = MemberResponse.model_validate(user)
        return await self._deliver_activation(result, token, expires_at)

    def _new_activation(self) -> tuple[str, datetime]:
        development = self.settings.environment in {"development", "test"}
        if not development and self.delivery is None:
            raise BusinessError(503, "Activation delivery is not configured")
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=self.settings.activation_token_expire_minutes
        )
        return token, expires_at

    async def _deliver_activation(
        self, result: MemberResponse, token: str, expires_at: datetime,
    ) -> MemberCreated:
        if self.delivery is not None:
            try:
                await self.delivery.send(result.email, SecretStr(token), expires_at)
            except Exception:
                # Provider exceptions can contain credentials; do not log them.
                raise BusinessError(503, "Account saved but activation delivery failed; reissue invitation") from None
        return MemberCreated(
            member=result,
            activation_token=token if self.settings.environment in {"development", "test"} else None,
        )

    async def list(self, query: MemberQuery) -> Page[MemberResponse]:
        users, total = await self.members.list_members(query)
        return Page[MemberResponse](
            items=[MemberResponse.model_validate(user) for user in users], total=total,
            page=query.page, page_size=query.page_size,
        )

    async def get(self, user_id: UUID) -> MemberResponse:
        return MemberResponse.model_validate(await self._member(user_id))

    async def update(self, user_id: UUID, payload: MemberUpdate) -> MemberResponse:
        async with self._write():
            user = await self._member(user_id, lock=True)
            changes = payload.model_dump(exclude_unset=True)
            if "email" in changes and changes["email"] != user.email:
                await self._unique_email(changes["email"], user.id)
                if user.hashed_password == PENDING_PASSWORD:
                    # An invitation delivered to the old address must stop working.
                    user.activation_token_hash = None
                    user.activation_expires_at = None
            for field, value in changes.items():
                setattr(user, field, value)
            await self.members.session.flush()
            await self.members.session.refresh(user)
            result = MemberResponse.model_validate(user)
        return result

    async def set_status(self, user_id: UUID, is_active: bool, actor_id: UUID) -> MemberResponse:
        async with self._write():
            admins = await self.members.lock_admins()
            if not any(admin.id == actor_id and admin.is_active for admin in admins):
                raise BusinessError(403, "Administrator is no longer active")
            user = await self.members.lock_user(user_id)
            if user is None:
                raise BusinessError(404, "Member not found")
            if user.role == UserRole.ADMIN and user.is_active and not is_active:
                if sum(admin.is_active for admin in admins) <= 1:
                    raise BusinessError(409, "Cannot deactivate the last active administrator")
            if user.is_active != is_active:
                user.is_active = is_active
                await self.members.session.flush()
                await self.members.session.refresh(user)
            result = MemberResponse.model_validate(user)
        return result

    async def setup_password(self, token: str, password: str) -> None:
        password_hash = await to_thread.run_sync(
            hash_password, password, limiter=self.password_limiter,
        )
        async with self._write():
            user_id = await self.members.consume_activation(
                hashlib.sha256(token.encode()).hexdigest(), password_hash,
                datetime.now(timezone.utc),
            )
            if user_id is None:
                raise BusinessError(400, "Invalid or expired activation token")
