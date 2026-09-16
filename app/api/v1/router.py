"""Version 1 router; include future feature routers here."""

from fastapi import APIRouter

from app.schemas.health import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check() -> HealthResponse:
    """Report process liveness; this does not check database readiness."""
    return HealthResponse(status="ok")
