"""Current-user enrollment queries and persistence without repository commits."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.module import Module
from app.repositories.progress_repository import video_counts_query


class EnrollmentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: UUID, course_id: UUID, *, lock: bool = False) -> Enrollment | None:
        query = select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == course_id)
        if lock:
            query = query.with_for_update()
        return await self.session.scalar(query.execution_options(populate_existing=True))

    async def save(self, enrollment: Enrollment) -> Enrollment:
        self.session.add(enrollment)
        await self.session.flush()
        await self.session.refresh(enrollment)
        return enrollment

    async def list_for_user(
        self, user_id: UUID, page: int, page_size: int,
    ) -> tuple[list[tuple[Enrollment, Course, int, int, int]], int]:
        """The page of enrollments, each with its course's module and video counts.

        Still one statement for the page: the module count is a correlated
        subquery beside the existing video aggregate, never a query per row.
        """
        total = await self.session.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.user_id == user_id))
        counts = video_counts_query(user_id).subquery()
        modules = (select(func.count()).select_from(Module)
                   .where(Module.course_id == Course.id).scalar_subquery())
        result = await self.session.execute(
            select(Enrollment, Course, func.coalesce(counts.c.total_videos, 0),
                   func.coalesce(counts.c.completed_videos, 0), modules)
            .join(Course, Course.id == Enrollment.course_id)
            .outerjoin(counts, counts.c.course_id == Enrollment.course_id)
            .where(Enrollment.user_id == user_id).order_by(Enrollment.enrolled_at, Enrollment.id)
            .offset((page - 1) * page_size).limit(page_size)
        )
        return [(enrollment, course, int(videos), int(completed), int(module_count))
                for enrollment, course, videos, completed, module_count in result], total or 0
