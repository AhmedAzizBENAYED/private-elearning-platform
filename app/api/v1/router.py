"""Version 1 router; include future feature routers here."""

from fastapi import APIRouter, HTTPException, status

from app.api.v1.auth import router as auth_router
from app.api.v1.admin.members import router as members_router
from app.api.v1.admin.courses import router as admin_courses_router
from app.api.v1.admin.modules import router as admin_modules_router
from app.api.v1.admin.learning import router as admin_learning_router
from app.api.v1.admin.lessons import router as admin_lessons_router
from app.api.v1.admin.resources import router as admin_resources_router
from app.api.v1.admin.structure import router as admin_structure_router
from app.api.v1.admin.thumbnails import router as admin_thumbnails_router
from app.api.v1.courses import router as catalog_router
from app.api.v1.enrollments import router as enrollments_router
from app.api.v1.learning_events import router as learning_events_router
from app.api.v1.resources import router as resources_router
from app.api.v1.thumbnails import router as thumbnails_router

from app.database.session import DatabaseSession, check_database_connection
from app.schemas.health import DatabaseHealthResponse, HealthResponse

router = APIRouter()
router.include_router(auth_router)
router.include_router(members_router)
router.include_router(admin_courses_router)
router.include_router(admin_modules_router)
router.include_router(admin_lessons_router)
router.include_router(admin_learning_router)
router.include_router(admin_resources_router)
router.include_router(admin_structure_router)
router.include_router(admin_thumbnails_router)
router.include_router(catalog_router)
router.include_router(enrollments_router)
router.include_router(learning_events_router)
router.include_router(resources_router)
router.include_router(thumbnails_router)


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
