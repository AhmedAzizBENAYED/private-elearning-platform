"""Monotonic video progress and atomic enrollment completion."""

from datetime import datetime, timezone
from uuid import UUID

from app.core.config import Settings
from app.core.exceptions import BusinessError
from app.models.course import CourseStatus
from app.models.lesson import ContentType, Lesson
from app.models.progress import Progress
from app.repositories.learning_event_repository import LearningEventRepository
from app.repositories.progress_repository import ProgressRepository
from app.schemas.progress import CourseProgressResponse, ProgressResponse
from app.services.content_rules import content_write
from app.services.enrollment_service import EnrollmentService, completion_summary
from app.services.lesson_service import LessonService
from app.services.tracking_service import record_lesson_completed


class ProgressService:
    def __init__(
        self, progress: ProgressRepository, enrollments: EnrollmentService,
        lessons: LessonService, settings: Settings,
    ) -> None:
        self.progress = progress
        self.enrollments = enrollments
        self.lessons = lessons
        self.settings = settings
        # The completion below is also a learning event (BE-LEARNING-TRACKING-01),
        # logged in the same transaction as the progress row it describes.
        self.events = LearningEventRepository(progress.session)

    async def _locate(self, lesson_id: UUID) -> tuple[Lesson, UUID]:
        """Resolve a lesson and its course without applying content rules yet."""
        lesson = await self.lessons.require_lesson(lesson_id)
        module = await self.lessons.modules.require_module(lesson.module_id)
        return lesson, module.course_id

    @staticmethod
    def _require_video(lesson: Lesson) -> None:
        # Checked after enrollment, so non-members learn nothing about lesson content.
        if lesson.content_type != ContentType.VIDEO:
            raise BusinessError(409, "Progress is only available for VIDEO lessons")

    @staticmethod
    def _response(lesson: Lesson, progress: Progress | None) -> ProgressResponse:
        return ProgressResponse(
            lesson_id=lesson.id, duration_seconds=lesson.duration_seconds,
            watched_seconds=progress.watched_seconds if progress else 0,
            completed=progress.completed if progress else False,
            completed_at=progress.completed_at if progress else None,
        )

    async def get(self, user_id: UUID, lesson_id: UUID) -> ProgressResponse:
        lesson, course_id = await self._locate(lesson_id)
        await self.enrollments.require_enrollment(user_id, course_id)
        self._require_video(lesson)
        return self._response(lesson, await self.progress.get(user_id, lesson_id))

    async def course_progress(self, user_id: UUID, course_id: UUID) -> CourseProgressResponse:
        await self.enrollments.require_enrollment(user_id, course_id)
        total, completed_count = await self.progress.course_counts(user_id, course_id)
        percent, completed = completion_summary(total, completed_count)
        return CourseProgressResponse(course_id=course_id, total_video_lessons=total,
            completed_video_lessons=completed_count, progress_percent=percent, completed=completed)

    async def update(self, user_id: UUID, lesson_id: UUID, watched_seconds: int) -> ProgressResponse:
        if watched_seconds < 0:
            raise BusinessError(422, "watched_seconds cannot be negative")
        async with content_write(self.progress.session, "Progress conflict; retry the request"):
            _, course_id = await self._locate(lesson_id)
            course = await self.enrollments.courses.require_course(course_id, lock=True)
            enrollment = await self.enrollments.require_enrollment(user_id, course_id, lock=True)
            if course.status != CourseStatus.PUBLISHED:
                raise BusinessError(409, "Progress updates require a PUBLISHED course")
            # Refresh after the lifecycle lock, before trusting lesson metadata.
            lesson, _ = await self._locate(lesson_id)
            self._require_video(lesson)
            duration = lesson.duration_seconds
            if duration is None or duration <= 0:
                raise BusinessError(409, "Video duration must be configured before recording progress")
            progress = await self.progress.get(user_id, lesson_id, lock=True)
            if progress is None:
                progress = Progress(user_id=user_id, lesson_id=lesson_id, watched_seconds=0, completed=False)
            progress.watched_seconds = min(duration, max(progress.watched_seconds, watched_seconds))
            # Never mark an unwatched short video complete when tolerance >= duration.
            threshold = max(1, duration - self.settings.video_completion_tolerance_seconds)
            now = datetime.now(timezone.utc)
            newly_completed = not progress.completed and progress.watched_seconds >= threshold
            if newly_completed:
                progress.completed = True
                progress.completed_at = now
            await self.progress.save(progress)
            if newly_completed:
                # Once per lesson: only the transition is logged, never a replay.
                await record_lesson_completed(self.events, user_id, course_id, lesson.module_id, lesson.id, now)
            total, completed_count = await self.progress.course_counts(user_id, course_id)
            if total > 0 and completed_count == total and enrollment.completed_at is None:
                enrollment.completed_at = now
                await self.enrollments.enrollments.save(enrollment)
            result = self._response(lesson, progress)
        return result
