"""Reusable authentication and authorization boundaries for FastAPI."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database.session import DatabaseSession
from app.models.user import User, UserRole
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthenticationError, AuthService

bearer = HTTPBearer(auto_error=False)


def get_auth_service(request: Request, session: DatabaseSession) -> AuthService:
    return AuthService(
        request.app.state.settings, UserRepository(session), request.app.state.password_limiter
    )


AuthServiceDependency = Annotated[AuthService, Depends(get_auth_service)]


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


def require_role(*roles: UserRole) -> Callable[..., Coroutine[Any, Any, User]]:
    """Require any of the supplied roles; an empty allowlist denies everyone."""
    async def check_role(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient privileges")
        return user

    return check_role
