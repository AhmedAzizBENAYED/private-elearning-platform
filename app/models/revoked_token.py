"""Refresh tokens that have been revoked before their natural expiry."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class RevokedRefreshToken(Base):
    """One revoked refresh token, identified by the ``jti`` claim it carries.

    A denylist rather than a session table: refresh tokens are stateless JWTs,
    so the smallest thing that makes revocation possible is a record of the
    ones that must no longer be honoured. Nothing here is needed to *accept* a
    token - only to refuse one - so a lost row degrades to the behaviour that
    existed before this table, never to a locked-out member.

    The token string itself is never stored. ``jti`` is a random UUID minted per
    token and is meaningless without the signature, so this table holds no
    credential: an attacker reading it gains nothing that logs anyone in.

    ``expires_at`` is the token's own ``exp``. A row is only useful until then -
    afterwards the JWT is refused on expiry alone - so expired rows can be
    deleted by maintenance without ever invalidating a live token.
    """

    __tablename__ = "revoked_refresh_tokens"
    __table_args__ = (
        # Revocation is read on every refresh; expiry drives the purge.
        Index("ix_revoked_refresh_tokens_expires_at", "expires_at"),
    )

    #: The token's own ``jti``. Primary key, so revoking twice is a no-op
    #: rather than a duplicate row.
    jti: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    #: The moment the revoked token would have expired on its own.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
