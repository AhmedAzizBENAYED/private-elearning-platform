"""Reusable authentication and authorization boundaries for FastAPI."""

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Annotated, Any

from uuid import UUID

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database.session import DatabaseSession
from app.models.user import User, UserRole
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthenticationError, AuthService
from app.repositories.member_repository import MemberRepository
from app.services.member_service import MemberService

bearer = HTTPBearer(auto_error=False)


def get_auth_service(request: Request, session: DatabaseSession) -> AuthService:
    return AuthService(
        request.app.state.settings, UserRepository(session), request.app.state.password_limiter
    )


AuthServiceDependency = Annotated[AuthService, Depends(get_auth_service)]


def get_member_service(request: Request, session: DatabaseSession) -> MemberService:
    return MemberService(
        request.app.state.settings, MemberRepository(session),
        request.app.state.password_limiter,
        getattr(request.app.state, "activation_delivery", None),
    )


MemberServiceDependency = Annotated[MemberService, Depends(get_member_service)]


def unauthorized(detail: str = "Invalid authentication credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    service: AuthServiceDependency,
) -> User:
    if credentials is None:
        raise unauthorized()
    try:
        return await service.current_user(credentials.credentials)
    except AuthenticationError:
        raise unauthorized() from None


CurrentUser = Annotated[User, Depends(get_current_user)]


MEDIA_ROLES = (UserRole.MEMBER, UserRole.ADMIN)


@dataclass(frozen=True, slots=True)
class MediaAccess:
    """Who is streaming, and which credential they presented."""

    user: User
    via_playback: bool


async def get_media_access(
    lesson_id: UUID,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    service: AuthServiceDependency,
    playback_token: Annotated[str | None, Query(
        description="Short-lived, lesson-scoped token from the lesson resource endpoint.",
    )] = None,
) -> MediaAccess:
    """Authenticate a media request by bearer header **or** playback token.

    An HTML media element cannot send an ``Authorization`` header, so a browser
    presents the lesson-scoped playback token instead. API clients keep using the
    bearer header, which wins when both are supplied. Either way this establishes
    *identity* only: enrollment and resource rules are enforced downstream,
    unchanged.
    """
    try:
        if credentials is not None:
            user, via_playback = await service.current_user(credentials.credentials), False
        elif playback_token:
            user, via_playback = await service.playback_user(playback_token, lesson_id), True
        else:
            raise unauthorized()
    except AuthenticationError:
        raise unauthorized() from None
    if user.role not in MEDIA_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient privileges")
    return MediaAccess(user=user, via_playback=via_playback)


MediaUser = Annotated[MediaAccess, Depends(get_media_access)]


def require_role(*roles: UserRole) -> Callable[..., Coroutine[Any, Any, User]]:
    """Require any of the supplied roles; an empty allowlist denies everyone."""
    async def check_role(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient privileges")
        return user

    return check_role
