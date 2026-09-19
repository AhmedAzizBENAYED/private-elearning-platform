"""Assemble a member's learning page from existing enrollment and progress rules.

This service adds no business rules. Enrollment is enforced by
``EnrollmentService``, course visibility follows the same convention as the
other enrollment-gated reads (progress, lesson resources): the enrollment is
the gate, so a course stays readable after it is archived. Completion
percentages come from the same aggregation ``/courses/{id}/progress`` and
``/me/enrollments`` use, so the three endpoints can never disagree.
"""

from uuid import UUID

from app.models.lesson import ContentType
from app.repositories.learning_repository import LearningRepository
from app.repositories.progress_repository import ProgressRepository
from app.schemas.learning import CourseContent, CourseContentLesson, CourseContentModule
from app.schemas.lesson import CatalogLesson
from app.schemas.module import CatalogModule
from app.services.enrollment_service import EnrollmentService, completion_summary


class LearningService:
    def __init__(
        self, tree: LearningRepository, progress: ProgressRepository, enrollments: EnrollmentService,
    ) -> None:
        self.tree = tree
        self.progress = progress
        self.enrollments = enrollments

    async def course_content(self, user_id: UUID, course_id: UUID) -> CourseContent:
        """One request per course page: three reads, never one per module or lesson."""
        # Enrollment first, so a course the member cannot reach is indistinguishable
        # from one that does not exist.
        await self.enrollments.require_enrollment(user_id, course_id)
        course = await self.enrollments.courses.require_course(course_id)
        total, completed_count = await self.progress.course_counts(user_id, course_id)
        percent, completed = completion_summary(total, completed_count)
        return CourseContent(
            course_id=course.id, title=course.title, slug=course.slug, description=course.description,
            thumbnail_url=course.thumbnail_url, status=course.status, published_at=course.published_at,
            total_video_lessons=total, completed_video_lessons=completed_count,
            progress_percent=percent, completed=completed,
            modules=await self._modules(user_id, course_id),
        )

    async def _modules(self, user_id: UUID, course_id: UUID) -> list[CourseContentModule]:
        modules: dict[UUID, CourseContentModule] = {}
        for module, lesson, watched, lesson_completed, completed_at, resource_id in \
                await self.tree.course_tree(user_id, course_id):
            entry = modules.get(module.id)
            if entry is None:
                entry = modules[module.id] = CourseContentModule(
                    **CatalogModule.model_validate(module).model_dump(), lessons=[])
            if lesson is None:  # An outer-joined module that holds no lessons yet.
                continue
            video = lesson.content_type == ContentType.VIDEO
            entry.lessons.append(CourseContentLesson(
                **CatalogLesson.model_validate(lesson).model_dump(),
                has_resource=resource_id is not None,
                watched_seconds=(watched or 0) if video else None,
                completed=bool(lesson_completed) if video else None,
                completed_at=completed_at if video else None,
            ))
        return list(modules.values())

