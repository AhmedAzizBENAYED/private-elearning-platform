"""The signed-in user's own writes: their name and their password."""

from uuid import UUID

from sqlalchemy import update

from app.models.user import User
from app.repositories.user_repository import UserRepository


class ProfileRepository(UserRepository):
    async def replace_password(self, user_id: UUID, expected_hash: str, new_hash: str) -> bool:
        """Swap the hash only if it is still the one the current password was checked against.

        Two concurrent changes presenting the same current password cannot both
        win: the second finds the hash already replaced and changes nothing.
        An account deactivated in the meantime is not written either. The
        session's copy of the user is synchronised, so nothing later in the same
        session reads the old hash.
        """
        changed = await self.session.scalar(
            update(User).where(
                User.id == user_id, User.hashed_password == expected_hash, User.is_active.is_(True),
            ).values(hashed_password=new_hash).returning(User.id)
        )
        return changed is not None
