"""Thin HTTP adapters for authentication use cases."""

from fastapi import APIRouter, Response

from app.core.dependencies import AuthServiceDependency, CurrentUser, unauthorized
from app.schemas.auth import LoginRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthenticationError

router = APIRouter(prefix="/auth", tags=["authentication"])


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
