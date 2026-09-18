"""Current-user enrollment and progress HTTP adapters."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.v1.content_dependencies import CourseDependency, LessonDependency, catalog_access, no_cache
from app.database.session import DatabaseSession
from app.models.user import User
from app.repositories.enrollment_repository import EnrollmentRepository
from app.repositories.progress_repository import ProgressRepository
from app.schemas.enrollment import EnrollmentResponse, EnrollmentSummary
from app.schemas.pagination import Page, Pagination
from app.schemas.progress import CourseProgressResponse, ProgressResponse, ProgressUpdate
from app.services.enrollment_service import EnrollmentService
from app.services.progress_service import ProgressService

LearningUser = Annotated[User, Depends(catalog_access)]


def get_enrollment_service(session: DatabaseSession, courses: CourseDependency) -> EnrollmentService:
    return EnrollmentService(EnrollmentRepository(session), courses)


EnrollmentDependency = Annotated[EnrollmentService, Depends(get_enrollment_service)]


def get_progress_service(
    session: DatabaseSession, enrollments: EnrollmentDependency, lessons: LessonDependency, request: Request,
) -> ProgressService:
    return ProgressService(ProgressRepository(session), enrollments, lessons, request.app.state.settings)


ProgressDependency = Annotated[ProgressService, Depends(get_progress_service)]

router = APIRouter(dependencies=[Depends(catalog_access), Depends(no_cache)], responses={
    401: {"description": "Missing/invalid credentials or inactive account"},
    403: {"description": "MEMBER or ADMIN role required"},
    404: {"description": "Resource or current-user enrollment not found"},
    409: {"description": "Course not published, lesson not a configured video, or write conflict"},
    422: {"description": "Invalid identifier or watched time; completion fields are read-only"},
    503: {"description": "Storage temporarily unavailable"},
})


@router.post("/courses/{course_id}/enroll", response_model=EnrollmentResponse, tags=["enrollments"])
async def enroll(course_id: UUID, user: LearningUser, service: EnrollmentDependency) -> EnrollmentResponse:
    """Enroll the current user in a published course; repeat requests return the existing enrollment (200)."""
    return await service.enroll(user.id, course_id)


@router.get("/me/enrollments", response_model=Page[EnrollmentSummary], tags=["enrollments"])
async def enrollments(
    query: Annotated[Pagination, Query()], user: LearningUser, service: EnrollmentDependency,
) -> Page[EnrollmentSummary]:
    """Current user's enrollments, including archived history; aggregate progress uses only videos."""
    return await service.list(user.id, query)


@router.get("/courses/{course_id}/enrollment", response_model=EnrollmentResponse, tags=["enrollments"])
async def enrollment(course_id: UUID, user: LearningUser, service: EnrollmentDependency) -> EnrollmentResponse:
    return await service.get(user.id, course_id)


@router.get("/courses/{course_id}/progress", response_model=CourseProgressResponse, tags=["video progress"])
async def course_progress(course_id: UUID, user: LearningUser, service: ProgressDependency) -> CourseProgressResponse:
    return await service.course_progress(user.id, course_id)


@router.get("/lessons/{lesson_id}/progress", response_model=ProgressResponse, tags=["video progress"])
async def video_progress(lesson_id: UUID, user: LearningUser, service: ProgressDependency) -> ProgressResponse:
    """Return video progress, or an unwritten zero-progress projection; enrollment is required."""
    return await service.get(user.id, lesson_id)


@router.put("/lessons/{lesson_id}/progress", response_model=ProgressResponse, tags=["video progress"])
async def update_video_progress(
    lesson_id: UUID, payload: ProgressUpdate, user: LearningUser, service: ProgressDependency,
) -> ProgressResponse:
    """Record maximum watched time, clamped to duration; completion and timestamps are server-calculated."""
    return await service.update(user.id, lesson_id, payload.watched_seconds)
