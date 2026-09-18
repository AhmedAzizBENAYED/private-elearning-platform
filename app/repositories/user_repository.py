"""Read-only identity persistence; no user administration operations."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_email(self, email: str) -> User | None:
        return await self.session.scalar(select(User).where(User.email == email.strip().lower()))

    async def get_by_id(self, user_id: UUID) -> User | None:
        return await self.session.get(User, user_id)
