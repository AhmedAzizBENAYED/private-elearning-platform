"""Lesson resource persistence and batch reads; no commits, no storage calls."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson import Lesson
from app.models.module import Module
from app.models.resource import LessonResource


class LessonResourceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, lesson_id: UUID, *, lock: bool = False) -> LessonResource | None:
        query = select(LessonResource).where(LessonResource.lesson_id == lesson_id)
        if lock:
            query = query.with_for_update()
        return await self.session.scalar(query.execution_options(populate_existing=True))

    async def save(self, resource: LessonResource) -> LessonResource:
        self.session.add(resource)
        await self.session.flush()
        await self.session.refresh(resource)
        return resource

    async def delete(self, resource: LessonResource) -> None:
        await self.session.delete(resource)
        await self.session.flush()

    async def list_for_course(self, course_id: UUID) -> Sequence[LessonResource]:
        """One query for a whole course, so callers never loop lesson by lesson."""
        return (await self.session.scalars(
            select(LessonResource)
            .join(Lesson, Lesson.id == LessonResource.lesson_id)
            .join(Module, Module.id == Lesson.module_id)
            .where(Module.course_id == course_id)
            .order_by(Module.position, Lesson.position, LessonResource.id)
        )).all()
