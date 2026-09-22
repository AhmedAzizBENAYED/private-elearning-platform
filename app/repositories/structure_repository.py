"""Whole-course structure reads and the flushes a reorganisation needs; no commits."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson import Lesson
from app.models.module import Module


class StructureRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def modules(self, course_id: UUID) -> list[Module]:
        """Every module of the course, in stored order, read fresh."""
        rows = await self.session.scalars(
            select(Module).where(Module.course_id == course_id)
            .order_by(Module.position, Module.id).execution_options(populate_existing=True)
        )
        return list(rows)

    async def lessons(self, module_ids: list[UUID]) -> list[Lesson]:
        """Every lesson of those modules, grouped by module and in stored order, read fresh."""
        if not module_ids:
            return []
        rows = await self.session.scalars(
            select(Lesson).where(Lesson.module_id.in_(module_ids))
            .order_by(Lesson.module_id, Lesson.position, Lesson.id).execution_options(populate_existing=True)
        )
        return list(rows)

    async def flush(self) -> None:
        await self.session.flush()
