"""Refresh-token revocation lookups and persistence, without repository commits."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.revoked_token import RevokedRefreshToken


class RevokedTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def is_revoked(self, jti: UUID) -> bool:
        """Whether this token has been revoked. One indexed primary-key lookup."""
        return (
            await self.session.scalar(
                select(RevokedRefreshToken.jti).where(RevokedRefreshToken.jti == jti)
            )
        ) is not None

    async def revoke(self, jti: UUID, user_id: UUID, expires_at: datetime) -> None:
        """Record a revocation, ignoring one that is already recorded.

        Upserted rather than inserted so that logging out twice - or two tabs
        logging out at once with the same token - is a no-op instead of an
        integrity error. The first revocation is the one that counts, so the
        original ``revoked_at`` is deliberately left alone.
        """
        dialect = self.session.bind.dialect.name if self.session.bind is not None else ""
        insert = sqlite_insert if dialect == "sqlite" else postgres_insert
        await self.session.execute(
            insert(RevokedRefreshToken)
            .values(jti=jti, user_id=user_id, expires_at=expires_at)
            .on_conflict_do_nothing(index_elements=["jti"])
        )

    async def purge_expired(self, now: datetime) -> int:
        """Drop rows for tokens that have expired on their own.

        Not scheduled by the application: there is no job runner here, and
        inventing one for a table that grows by one row per logout would be out
        of proportion. Exposed so an operator or a future maintenance task can
        call it. Removing a row can never re-enable a token, because the JWT is
        refused on its own ``exp`` by then.
        """
        rows = await self.session.scalars(
            select(RevokedRefreshToken).where(RevokedRefreshToken.expires_at <= now)
        )
        count = 0
        for row in rows:
            await self.session.delete(row)
            count += 1
        return count
