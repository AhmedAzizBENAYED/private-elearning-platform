"""Ordered lesson persistence and publication-filtered reads."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, CourseStatus
from app.models.module import Module
from app.models.lesson import Lesson


class LessonRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, lesson_id: UUID, *, published: bool = False) -> Lesson | None:
        query = select(Lesson).where(Lesson.id == lesson_id)
        if published:
            query = query.join(Module).join(Course).where(Course.status == CourseStatus.PUBLISHED)
        return await self.session.scalar(query.execution_options(populate_existing=True))

    async def list(self, module_id: UUID, page: int, page_size: int, *, published: bool = False) -> tuple[list[Lesson], int]:
        query = select(Lesson).join(Module).join(Course).where(Lesson.module_id == module_id)
        if published:
            query = query.where(Course.status == CourseStatus.PUBLISHED)
        total = await self.session.scalar(select(func.count()).select_from(query.subquery()))
        rows = await self.session.scalars(query.order_by(Lesson.position, Lesson.id)
            .offset((page - 1) * page_size).limit(page_size))
        return list(rows), total or 0

    async def save(self, lesson: Lesson) -> Lesson:
        self.session.add(lesson)
        await self.session.flush()
        await self.session.refresh(lesson)
        return lesson

    async def delete(self, lesson: Lesson) -> None:
        await self.session.delete(lesson)
        await self.session.flush()
