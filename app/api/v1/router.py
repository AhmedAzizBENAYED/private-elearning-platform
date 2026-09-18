"""Version 1 router; include future feature routers here."""

from fastapi import APIRouter, HTTPException, status

from app.api.v1.auth import router as auth_router
from app.api.v1.admin.members import router as members_router

from app.database.session import DatabaseSession, check_database_connection
from app.schemas.health import DatabaseHealthResponse, HealthResponse

router = APIRouter()
router.include_router(auth_router)
router.include_router(members_router)


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check() -> HealthResponse:
    """Report process liveness; this does not check database readiness."""
    return HealthResponse(status="ok")


@router.get(
    "/health/db",
    response_model=DatabaseHealthResponse,
    tags=["health"],
    responses={503: {"description": "Database unavailable"}},
)
async def database_health_check(session: DatabaseSession) -> DatabaseHealthResponse:
    """Check PostgreSQL connectivity without modifying the database."""
    if not await check_database_connection(session):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )
    return DatabaseHealthResponse(database="connected")
