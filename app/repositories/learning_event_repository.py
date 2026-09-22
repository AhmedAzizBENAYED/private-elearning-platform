"""Learning-event persistence and the reads the activity screens will need.

Every method is one statement. Recording an event never loads a course tree:
the relationship check is one join, the enrollment touch one ``UPDATE``, the
event one ``INSERT``.
"""

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, and_, case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enrollment import Enrollment
from app.models.learning_event import LearningEvent, LearningEventType
from app.models.lesson import ContentType, Lesson
from app.models.module import Module
from app.models.progress import Progress


class LearningEventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------ recording

    async def module_course(self, module_id: UUID) -> UUID | None:
        """The course a module belongs to, or ``None`` if there is no such module."""
        return await self.session.scalar(select(Module.course_id).where(Module.id == module_id))

    async def lesson_location(self, lesson_id: UUID) -> Row | None:
        """``(module_id, course_id, content_type)`` of a lesson, in one join."""
        return (await self.session.execute(
            select(Lesson.module_id, Module.course_id, Lesson.content_type)
            .join(Module, Module.id == Lesson.module_id)
            .where(Lesson.id == lesson_id)
        )).first()

    async def touch_enrollment(self, user_id: UUID, course_id: UUID, now: datetime) -> bool:
        """Set ``started_at`` once and move ``last_activity_at`` forward, atomically.

        Returns ``False`` when the member is not enrolled in the course. One
        statement, so two concurrent events can neither reset ``started_at``
        nor move ``last_activity_at`` backwards.
        """
        result = await self.session.execute(
            update(Enrollment)
            .where(Enrollment.user_id == user_id, Enrollment.course_id == course_id)
            .values(
                started_at=func.coalesce(Enrollment.started_at, now),
                last_activity_at=case(
                    (Enrollment.last_activity_at.is_(None), now),
                    (Enrollment.last_activity_at < now, now),
                    else_=Enrollment.last_activity_at,
                ),
            )
            .execution_options(synchronize_session=False)
        )
        return result.rowcount == 1

    async def add(self, event: LearningEvent) -> LearningEvent:
        self.session.add(event)
        await self.session.flush()
        return event

    # ---------------------------------------------------------------- reads

    async def latest(self, user_id: UUID, *, course_id: UUID | None = None,
                     event_type: LearningEventType | None = None) -> LearningEvent | None:
        """The member's most recent event, optionally in one course or of one kind."""
        query = select(LearningEvent).where(LearningEvent.user_id == user_id)
        if course_id is not None:
            query = query.where(LearningEvent.course_id == course_id)
        if event_type is not None:
            query = query.where(LearningEvent.event_type == event_type)
        return await self.session.scalar(query.order_by(LearningEvent.occurred_at.desc()).limit(1))

    async def recent(self, user_id: UUID, limit: int) -> Sequence[LearningEvent]:
        """The member's latest ``limit`` events, newest first."""
        return (await self.session.scalars(
            select(LearningEvent).where(LearningEvent.user_id == user_id)
            .order_by(LearningEvent.occurred_at.desc()).limit(limit)
        )).all()

    async def active_user_ids(self, since: datetime) -> set[UUID]:
        """Members with at least one learning event at or after ``since``."""
        return set((await self.session.scalars(
            select(LearningEvent.user_id).where(LearningEvent.occurred_at >= since).distinct()
        )).all())

    async def module_video_counts(self, user_id: UUID, course_id: UUID) -> Sequence[Row]:
        """``(module_id, total_videos, completed_videos)`` for every module, in one query.

        Only VIDEO lessons are counted, exactly as the course figures are; a
        module with no video counts 0 and 0.
        """
        return (await self.session.execute(
            select(Module.id.label("module_id"), func.count(Lesson.id).label("total_videos"),
                   func.count(Progress.id).filter(Progress.completed.is_(True)).label("completed_videos"))
            .select_from(Module)
            .outerjoin(Lesson, and_(Lesson.module_id == Module.id, Lesson.content_type == ContentType.VIDEO))
            .outerjoin(Progress, and_(Progress.lesson_id == Lesson.id, Progress.user_id == user_id))
            .where(Module.course_id == course_id)
            .group_by(Module.id, Module.position)
            .order_by(Module.position, Module.id)
        )).all()
