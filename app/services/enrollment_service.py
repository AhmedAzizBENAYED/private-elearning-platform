"""Idempotent self-enrollment and private enrollment read models."""

from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.course import CourseStatus
from app.models.enrollment import Enrollment
from app.repositories.enrollment_repository import EnrollmentRepository
from app.schemas.enrollment import EnrollmentResponse, EnrollmentSummary
from app.schemas.pagination import Page, Pagination
from app.services.content_rules import content_write
from app.services.course_service import CourseService


def completion_summary(total: int, completed: int) -> tuple[float, bool]:
    """Zero-video courses never complete; percentages describe completed videos."""
    return (round(completed * 100 / total, 2), completed == total) if total else (0.0, False)


class EnrollmentService:
    def __init__(self, enrollments: EnrollmentRepository, courses: CourseService) -> None:
        self.enrollments = enrollments
        self.courses = courses

    async def require_enrollment(self, user_id: UUID, course_id: UUID, *, lock: bool = False) -> Enrollment:
        enrollment = await self.enrollments.get(user_id, course_id, lock=lock)
        if enrollment is None:
            raise BusinessError(404, "Enrollment not found")
        return enrollment

    async def enroll(self, user_id: UUID, course_id: UUID) -> EnrollmentResponse:
        async with content_write(self.enrollments.session, "Enrollment conflict; retry the request"):
            # Shared by all enrollment/progress writes and lifecycle operations.
            # Even the absent-enrollment case is serialized by this parent lock.
            course = await self.courses.require_course(course_id, lock=True)
            if course.status != CourseStatus.PUBLISHED:
                raise BusinessError(409, "Enrollment requires a PUBLISHED course")
            enrollment = await self.enrollments.get(user_id, course_id)
            if enrollment is None:
                enrollment = await self.enrollments.save(Enrollment(user_id=user_id, course_id=course_id))
            result = EnrollmentResponse.model_validate(enrollment)
        return result

    async def get(self, user_id: UUID, course_id: UUID) -> EnrollmentResponse:
        return EnrollmentResponse.model_validate(await self.require_enrollment(user_id, course_id))

    async def list(self, user_id: UUID, query: Pagination) -> Page[EnrollmentSummary]:
        rows, total = await self.enrollments.list_for_user(user_id, query.page, query.page_size)
        items = []
        for enrollment, course, video_count, completed_count in rows:
            percent, completed = completion_summary(video_count, completed_count)
            items.append(EnrollmentSummary(
                enrollment_id=enrollment.id, course_id=course.id, title=course.title, slug=course.slug,
                thumbnail_url=course.thumbnail_url, enrolled_at=enrollment.enrolled_at,
                completed_at=enrollment.completed_at, progress_percent=percent, completed=completed,
            ))
        return Page[EnrollmentSummary](items=items, total=total, page=query.page, page_size=query.page_size)
