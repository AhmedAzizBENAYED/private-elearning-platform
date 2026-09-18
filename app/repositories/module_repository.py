"""Ordered module persistence; database cascades remove dependent lessons."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, CourseStatus
from app.models.module import Module


class ModuleRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, module_id: UUID, *, published: bool = False) -> Module | None:
        query = select(Module).where(Module.id == module_id)
        if published:
            query = query.join(Course).where(Course.status == CourseStatus.PUBLISHED)
        return await self.session.scalar(query.execution_options(populate_existing=True))

    async def list(self, course_id: UUID, page: int, page_size: int, *, published: bool = False) -> tuple[list[Module], int]:
        query = select(Module).join(Course).where(Module.course_id == course_id)
        if published:
            query = query.where(Course.status == CourseStatus.PUBLISHED)
        total = await self.session.scalar(select(func.count()).select_from(query.subquery()))
        rows = await self.session.scalars(query.order_by(Module.position, Module.id)
            .offset((page - 1) * page_size).limit(page_size))
        return list(rows), total or 0

    async def save(self, module: Module) -> Module:
        self.session.add(module)
        await self.session.flush()
        await self.session.refresh(module)
        return module

    async def delete(self, module: Module) -> None:
        await self.session.delete(module)
        await self.session.flush()
