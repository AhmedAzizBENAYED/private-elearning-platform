"""Member learning tracking (BE-LEARNING-TRACKING-01), per Admin-Tracking-Logic.

What already existed is reused and stays the only source of each fact:

* whether a VIDEO lesson is done: ``progress.completed_at``, set once by
  ``ProgressService.update`` when enough of the video was watched;
* the course figures: ``video_counts_query`` and ``completion_summary``;
* the course completion date: ``enrollments.completed_at``, set once.

What this module adds is *activity*: an append-only ``learning_events`` log,
and the per-course ``enrollments.started_at`` / ``last_activity_at`` that the
log moves forward. Opening a course, module or lesson is activity only - it
never completes anything and never changes a percentage.

The user and the time are always the server's: the acting member comes from
authentication and ``occurred_at`` from the server clock, and the request
schema has no field for either.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.learning_event import LearningEvent, LearningEventType
from app.repositories.learning_event_repository import LearningEventRepository
from app.repositories.progress_repository import ProgressRepository
from app.schemas.learning_event import (
    CourseOpened, LearningEventCreate, LearningEventResponse, LessonOpened, ModuleOpened,
)
from app.services.content_rules import content_write
from app.services.enrollment_service import EnrollmentService, completion_summary


class CourseLearningStatus(StrEnum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


def course_status(started: bool, total_videos: int, completed_videos: int) -> CourseLearningStatus:
    """A member's status in a course, from the tracking-logic rules.

    Completed: every VIDEO lesson is completed - ``completion_summary``'s own
    rule, so a course with no video never completes, as everywhere else.
    In progress: any learning event, or any completed video (a member who
    completed videos before events were recorded has plainly started).
    Not started: neither.
    """
    _, complete = completion_summary(total_videos, completed_videos)
    if complete:
        return CourseLearningStatus.COMPLETED
    if started or completed_videos > 0:
        return CourseLearningStatus.IN_PROGRESS
    return CourseLearningStatus.NOT_STARTED


@dataclass(frozen=True, slots=True)
class CourseLearningState:
    """Everything the progress screens read for one member in one course."""

    course_id: UUID
    status: CourseLearningStatus
    total_video_lessons: int
    completed_video_lessons: int
    progress_percent: float
    started_at: datetime | None
    last_activity_at: datetime | None
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class ModuleLearningProgress:
    """A module's VIDEO lessons for one member; done only when it has one and all are completed."""

    module_id: UUID
    total_video_lessons: int
    completed_video_lessons: int

    @property
    def completed(self) -> bool:
        return completion_summary(self.total_video_lessons, self.completed_video_lessons)[1]


@dataclass(frozen=True, slots=True)
class LearningLocation:
    """The lesson a member opened last, and where it sits."""

    course_id: UUID
    module_id: UUID
    lesson_id: UUID
    occurred_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def record_lesson_completed(events: LearningEventRepository, user_id: UUID, course_id: UUID,
                                  module_id: UUID, lesson_id: UUID, now: datetime) -> None:
    """Log the completion ``ProgressService`` has just recorded, in its transaction.

    Called only on the transition to completed, so it happens once per lesson;
    a unique index on completed events makes a second one impossible anyway.
    """
    await events.touch_enrollment(user_id, course_id, now)
    await events.add(LearningEvent(user_id=user_id, event_type=LearningEventType.LESSON_COMPLETED,
                                   course_id=course_id, module_id=module_id, lesson_id=lesson_id,
                                   occurred_at=now))


class LearningTrackingService:
    def __init__(self, events: LearningEventRepository, progress: ProgressRepository,
                 enrollments: EnrollmentService) -> None:
        self.events = events
        self.progress = progress
        self.enrollments = enrollments

    # ------------------------------------------------------------ recording

    async def record(self, user_id: UUID, payload: LearningEventCreate) -> LearningEventResponse:
        """Record one course, module or lesson opening by the authenticated member.

        The enrollment is checked first, as every member read does, so a course
        the member cannot reach answers exactly as one that does not exist.
        Then the module must be in that course, and the lesson in that module.
        """
        async with content_write(self.events.session, "Learning event conflict; retry the request"):
            now = _now()
            if not await self.events.touch_enrollment(user_id, payload.course_id, now):
                raise BusinessError(404, "Enrollment not found")
            module_id = lesson_id = None
            if isinstance(payload, ModuleOpened):
                if await self.events.module_course(payload.module_id) != payload.course_id:
                    raise BusinessError(404, "Module not found in this course")
                module_id = payload.module_id
            elif isinstance(payload, LessonOpened):
                location = await self.events.lesson_location(payload.lesson_id)
                if (location is None or location.course_id != payload.course_id
                        or location.module_id != payload.module_id):
                    raise BusinessError(404, "Lesson not found in this module")
                module_id, lesson_id = payload.module_id, payload.lesson_id
            else:
                assert isinstance(payload, CourseOpened)
            event = await self.events.add(LearningEvent(
                user_id=user_id, event_type=LearningEventType(payload.type), course_id=payload.course_id,
                module_id=module_id, lesson_id=lesson_id, occurred_at=now,
            ))
            result = LearningEventResponse(
                id=event.id, type=event.event_type, course_id=event.course_id, module_id=event.module_id,
                lesson_id=event.lesson_id, occurred_at=event.occurred_at,
            )
        return result

    # ---------------------------------------------------------------- reads

    async def course_state(self, user_id: UUID, course_id: UUID) -> CourseLearningState:
        """Status, figures and dates of one enrolled member in one course: two queries."""
        enrollment = await self.enrollments.require_enrollment(user_id, course_id)
        total, completed_count = await self.progress.course_counts(user_id, course_id)
        percent, _ = completion_summary(total, completed_count)
        return CourseLearningState(
            course_id=course_id,
            status=course_status(enrollment.started_at is not None, total, completed_count),
            total_video_lessons=total, completed_video_lessons=completed_count, progress_percent=percent,
            started_at=enrollment.started_at, last_activity_at=enrollment.last_activity_at,
            completed_at=enrollment.completed_at,
        )

    async def module_progress(self, user_id: UUID, course_id: UUID) -> list[ModuleLearningProgress]:
        """Every module of an enrolled course, with its VIDEO figures, in one query."""
        await self.enrollments.require_enrollment(user_id, course_id)
        return [ModuleLearningProgress(row.module_id, int(row.total_videos), int(row.completed_videos))
                for row in await self.events.module_video_counts(user_id, course_id)]

    async def latest_location(self, user_id: UUID, course_id: UUID | None = None) -> LearningLocation | None:
        """The last lesson the member opened - overall, or in one course."""
        event = await self.events.latest(user_id, course_id=course_id,
                                         event_type=LearningEventType.LESSON_OPENED)
        if event is None:
            return None
        return LearningLocation(event.course_id, event.module_id, event.lesson_id, event.occurred_at)

    async def last_activity_at(self, user_id: UUID) -> datetime | None:
        """The member's latest learning event, in any course."""
        event = await self.events.latest(user_id)
        return None if event is None else event.occurred_at

    async def recent_events(self, user_id: UUID, limit: int = 10) -> list[LearningEvent]:
        return list(await self.events.recent(user_id, limit))

    async def active_user_ids(self, since: datetime) -> set[UUID]:
        """Members with a learning event since ``since`` - the basis of "Active now".

        The window is the caller's: the design's 5 minutes is still TO CONFIRM.
        """
        return await self.events.active_user_ids(since)
