"""Database filtering, locks and atomic password setup for member management."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, or_, select, update

from app.models.user import User, UserRole
from app.repositories.user_repository import UserRepository
from app.schemas.member import MemberQuery


class MemberRepository(UserRepository):
    async def list_members(self, query: MemberQuery) -> tuple[list[User], int]:
        filters = [User.role == UserRole.MEMBER]
        if query.is_active is not None:
            filters.append(User.is_active == query.is_active)
        if query.search:
            # Treat SQL wildcard characters as literal user input.
            filters.append(or_(*(
                column.icontains(query.search.strip(), autoescape=True)
                for column in (User.email, User.first_name, User.last_name)
            )))
        total = await self.session.scalar(select(func.count()).select_from(User).where(*filters))
        rows = await self.session.scalars(
            select(User).where(*filters).order_by(User.created_at, User.id)
            .offset((query.page - 1) * query.page_size).limit(query.page_size)
        )
        return list(rows), total or 0

    async def lock_user(self, user_id: UUID) -> User | None:
        return await self.session.scalar(
            select(User).where(User.id == user_id).with_for_update()
            .execution_options(populate_existing=True)
        )

    async def lock_admins(self) -> list[User]:
        # Lock all admins in stable order, including inactive ones. Concurrent
        # status changes then observe committed states under READ COMMITTED.
        rows = await self.session.scalars(
            select(User).where(User.role == UserRole.ADMIN).order_by(User.id)
            .with_for_update().execution_options(populate_existing=True)
        )
        return list(rows)

    async def consume_activation(self, digest: str, password_hash: str, now: datetime) -> UUID | None:
        return await self.session.scalar(
            update(User).where(
                User.activation_token_hash == digest,
                User.activation_expires_at > now,
                User.is_active.is_(True),
                User.role == UserRole.MEMBER,
            ).values(
                hashed_password=password_hash, activation_token_hash=None,
                activation_expires_at=None,
            ).returning(User.id).execution_options(synchronize_session=False)
        )
