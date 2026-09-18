"""Thin HTTP adapters for authentication use cases."""

from fastapi import APIRouter, Response

from app.core.dependencies import AuthServiceDependency, CurrentUser, unauthorized
from app.schemas.auth import LoginRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthenticationError
from app.core.dependencies import MemberServiceDependency
from app.schemas.member import PasswordSetup

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


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, service: AuthServiceDependency) -> TokenResponse:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    try:
        return await service.login(str(payload.email), payload.password.get_secret_value())
    except AuthenticationError:
        raise unauthorized("Invalid email or password") from None


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser, response: Response) -> UserResponse:
    response.headers["Cache-Control"] = "no-store"
    return UserResponse.model_validate(user)
