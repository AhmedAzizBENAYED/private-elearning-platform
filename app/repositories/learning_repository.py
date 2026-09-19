"""The whole learning tree of one course for one member, in a single query."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import Row, and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson import Lesson
from app.models.module import Module
from app.models.progress import Progress
from app.models.resource import LessonResource


class LearningRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def course_tree(self, user_id: UUID, course_id: UUID) -> Sequence[Row]:
        """Modules with their lessons, this member's progress and file presence.

        Outer joins throughout, so an empty module, a lesson never watched and a
        lesson without a stored file all still appear. Ordering matches the
        paginated catalog endpoints, so the tree and the lists agree.
        """
        return (await self.session.execute(
            select(Module, Lesson, Progress.watched_seconds, Progress.completed,
                   Progress.completed_at, LessonResource.id.label("resource_id"))
            .select_from(Module)
            .outerjoin(Lesson, Lesson.module_id == Module.id)
            .outerjoin(Progress, and_(Progress.lesson_id == Lesson.id, Progress.user_id == user_id))
            .outerjoin(LessonResource, LessonResource.lesson_id == Lesson.id)
            .where(Module.course_id == course_id)
            .order_by(Module.position, Module.id, Lesson.position, Lesson.id)
        )).all()
