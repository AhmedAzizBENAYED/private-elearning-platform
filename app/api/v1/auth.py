"""Thin HTTP adapters for authentication use cases."""

from fastapi import APIRouter, Response

from app.core.dependencies import AuthServiceDependency, CurrentUser, unauthorized
from app.schemas.auth import AccessTokenResponse, LoginRequest, RefreshRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthenticationError
from app.core.dependencies import MemberServiceDependency, ProfileServiceDependency
from app.schemas.member import PasswordChange, PasswordSetup, ProfileUpdate

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post(
    "/setup-password", status_code=204,
    responses={400: {"description": "Invalid, expired, consumed token or inactive account"},
               503: {"description": "Member storage unavailable"}},
)
async def setup_password(payload: PasswordSetup, service: MemberServiceDependency) -> Response:
    """Set an invited member's initial password using a one-time activation token.

    No account is created by this endpoint. Send the token in the body, never a URL.
    """
    await service.setup_password(payload.token.get_secret_value(), payload.password.get_secret_value())
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("/login", response_model=TokenResponse, responses={
    401: {"description": "Invalid email or password, or inactive account"},
})
async def login(payload: LoginRequest, response: Response, service: AuthServiceDependency) -> TokenResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    try:
        return await service.login(str(payload.email), payload.password.get_secret_value())
    except AuthenticationError:
        raise unauthorized("Invalid email or password") from None


@router.post("/refresh", response_model=AccessTokenResponse, responses={
    401: {"description": "Missing, invalid, expired or wrong-type refresh token"},
})
async def refresh(
    payload: RefreshRequest, response: Response, service: AuthServiceDependency,
) -> AccessTokenResponse:
    """Renew an access token without re-entering credentials.

    Accepts only a token whose type is ``refresh``: access and playback tokens
    are rejected. The refresh token itself is not rotated and its lifetime is
    not extended, so the session still ends when it expires.
    """
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    try:
        return await service.refresh(payload.refresh_token.get_secret_value())
    except AuthenticationError:
        raise unauthorized() from None


@router.post("/logout", status_code=204, responses={
    204: {"description": "The refresh token is revoked, or was not usable anyway"},
    503: {"description": "The revocation could not be recorded"},
})
async def logout(payload: RefreshRequest, service: AuthServiceDependency) -> Response:
    """Revoke a refresh token server-side, ending that session for good.

    The token travels in the body, never in the URL, exactly as it does on
    ``/auth/refresh``: a URL reaches logs, proxies and referrers.

    Always answers 204. Revoking a token that is invalid, expired or already
    revoked changes nothing and is not an error the caller could act on, and
    answering differently would let anyone test tokens against this endpoint.
    Signing out therefore never fails, which is the behaviour a client needs
    from it.

    Only the presented session ends. Other browsers keep their own refresh
    tokens, and an access token already issued stays valid until it expires.
    """
    await service.logout(payload.refresh_token.get_secret_value())
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/me", response_model=UserResponse, responses={
    401: {"description": "Missing, invalid or expired access token, or inactive account"},
})
async def me(user: CurrentUser, response: Response) -> UserResponse:
    response.headers["Cache-Control"] = "no-store"
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse, responses={
    401: {"description": "Missing, invalid or expired access token, or inactive account"},
    422: {"description": "Empty change, invalid name, or a field that cannot be changed here"},
    503: {"description": "Profile storage unavailable"},
})
async def update_me(
    payload: ProfileUpdate, user: CurrentUser, response: Response, service: ProfileServiceDependency,
) -> UserResponse:
    """Change the signed-in user's own first and/or last name.

    Self-service only: there is no identifier to target, so the account edited
    is always the caller's. Email, role, status and password are refused (422).
    """
    response.headers["Cache-Control"] = "no-store"
    return await service.update(user, payload)


@router.post("/change-password", status_code=204, responses={
    400: {"description": "Current password is incorrect"},
    401: {"description": "Missing, invalid or expired access token, or inactive account"},
    422: {"description": "Missing field, or a new password outside the password policy"},
    503: {"description": "Profile storage unavailable"},
})
async def change_password(
    payload: PasswordChange, user: CurrentUser, service: ProfileServiceDependency,
) -> Response:
    """Replace the signed-in user's own password, after verifying the current one.

    Sessions already open, this one included, stay signed in.
    """
    await service.change_password(user, payload)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
