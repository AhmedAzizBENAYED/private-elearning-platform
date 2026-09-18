"""Progress persistence and SQL-only video completion aggregation."""

from uuid import UUID

from sqlalchemy import Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enrollment import Enrollment
from app.models.lesson import ContentType, Lesson
from app.models.module import Module
from app.models.progress import Progress


def video_counts_query(user_id: UUID) -> Select:
    """Aggregate only this user's enrolled courses and VIDEO lessons."""
    return (
        select(Module.course_id.label("course_id"), func.count(Lesson.id).label("total_videos"),
               func.count(Progress.id).filter(Progress.completed.is_(True)).label("completed_videos"))
        .select_from(Lesson).join(Module, Module.id == Lesson.module_id)
        .join(Enrollment, and_(Enrollment.course_id == Module.course_id, Enrollment.user_id == user_id))
        .outerjoin(Progress, and_(Progress.lesson_id == Lesson.id, Progress.user_id == user_id))
        .where(Lesson.content_type == ContentType.VIDEO).group_by(Module.course_id)
    )


class ProgressRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: UUID, lesson_id: UUID, *, lock: bool = False) -> Progress | None:
        query = select(Progress).where(Progress.user_id == user_id, Progress.lesson_id == lesson_id)
        if lock:
            query = query.with_for_update()
        return await self.session.scalar(query.execution_options(populate_existing=True))

    async def save(self, progress: Progress) -> Progress:
        self.session.add(progress)
        await self.session.flush()
        await self.session.refresh(progress)
        return progress

    async def course_counts(self, user_id: UUID, course_id: UUID) -> tuple[int, int]:
        row = (await self.session.execute(video_counts_query(user_id).where(Module.course_id == course_id))).first()
        return (int(row.total_videos), int(row.completed_videos)) if row else (0, 0)
