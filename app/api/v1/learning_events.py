"""The authenticated member's learning events (BE-LEARNING-TRACKING-01)."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends

from app.api.v1.content_dependencies import CatalogUser, EnrollmentDependency, catalog_access, no_cache
from app.database.session import DatabaseSession
from app.repositories.learning_event_repository import LearningEventRepository
from app.repositories.progress_repository import ProgressRepository
from app.schemas.learning_event import LearningEventCreate, LearningEventResponse
from app.services.tracking_service import LearningTrackingService


def get_tracking_service(session: DatabaseSession, enrollments: EnrollmentDependency) -> LearningTrackingService:
    return LearningTrackingService(LearningEventRepository(session), ProgressRepository(session), enrollments)


TrackingDependency = Annotated[LearningTrackingService, Depends(get_tracking_service)]

router = APIRouter(tags=["learning activity"], dependencies=[Depends(catalog_access), Depends(no_cache)], responses={
    401: {"description": "Missing/invalid credentials or inactive account"},
    403: {"description": "MEMBER or ADMIN role required"},
    404: {"description": "Enrollment not found, or the module/lesson is not in that course/module"},
    409: {"description": "Write conflict; retry the request"},
    422: {"description": "Unknown event type, missing reference, or a field the server owns (user, time)"},
})


@router.post("/me/learning-events", response_model=LearningEventResponse, status_code=201)
async def record_learning_event(
    payload: Annotated[LearningEventCreate, Body()], user: CatalogUser, service: TrackingDependency,
) -> LearningEventResponse:
    """Record that the current member opened a course, a module or a lesson.

    Requires an enrollment in the course. Opening is activity only: it sets the
    course's started date the first time, moves its last activity, and never
    completes anything or changes progress. VIDEO completion stays
    ``PUT /lessons/{id}/progress``, which logs ``lesson_completed`` itself.
    """
    return await service.record(user.id, payload)
