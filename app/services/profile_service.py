"""Self-service account use cases: a signed-in user editing their own profile.

There is no user identifier anywhere in this module's inputs. Every method
acts on the ``User`` the access token resolved to, so it cannot be pointed at
somebody else's account - not by a MEMBER, and not by an ADMIN either, who
manages other accounts through ``/admin/members`` only.
"""

from anyio import CapacityLimiter, to_thread
from sqlalchemy.exc import SQLAlchemyError

from app.core.exceptions import BusinessError
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.repositories.profile_repository import ProfileRepository
from app.schemas.auth import UserResponse
from app.schemas.member import PasswordChange, ProfileUpdate

UNAVAILABLE = "Profile storage temporarily unavailable"
WRONG_PASSWORD = "Current password is incorrect"


class ProfileService:
    def __init__(self, users: ProfileRepository, password_limiter: CapacityLimiter) -> None:
        self.users = users
        self.password_limiter = password_limiter

    async def update(self, user: User, payload: ProfileUpdate) -> UserResponse:
        """Apply the name fields that were sent; the schema admits nothing else."""
        try:
            for field, value in payload.model_dump(exclude_unset=True).items():
                setattr(user, field, value)
            await self.users.session.flush()
            await self.users.session.refresh(user)
            result = UserResponse.model_validate(user)
            await self.users.session.commit()
        except SQLAlchemyError:
            await self.users.session.rollback()
            raise BusinessError(503, UNAVAILABLE) from None
        return result

    async def change_password(self, user: User, payload: PasswordChange) -> None:
        """Replace the password after verifying the current one.

        Both Argon2 runs happen outside the transaction and under the limiter
        shared with sign-in, exactly as account creation does. A wrong current
        password is a 400, never a 401: the session is valid, and a 401 would
        tell the client to refresh and replay the request.

        Sessions are left as they are - the current one and any other. The
        platform has no per-user revocation, and adding one is a change to
        authentication, not to the profile.
        """
        expected_hash = user.hashed_password
        valid = await to_thread.run_sync(
            verify_password, payload.current_password.get_secret_value(), expected_hash,
            limiter=self.password_limiter,
        )
        if not valid:
            raise BusinessError(400, WRONG_PASSWORD)
        new_hash = await to_thread.run_sync(
            hash_password, payload.new_password.get_secret_value(), limiter=self.password_limiter,
        )
        try:
            replaced = await self.users.replace_password(user.id, expected_hash, new_hash)
            if not replaced:
                # Changed by a concurrent request since it was verified: the
                # password presented is no longer the current one.
                await self.users.session.rollback()
                raise BusinessError(400, WRONG_PASSWORD)
            # Reload the server-computed `updated_at` now, inside the
            # transaction: an expired attribute would otherwise be lazy-loaded
            # later, which async SQLAlchemy cannot do.
            await self.users.session.refresh(user)
            await self.users.session.commit()
        except SQLAlchemyError:
            await self.users.session.rollback()
            raise BusinessError(503, UNAVAILABLE) from None
