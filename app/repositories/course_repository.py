"""Course persistence, filtering and row locking; no commits."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, CourseStatus
from app.models.user import User, UserRole


class CourseRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def active_admin_exists(self, user_id: UUID) -> bool:
        return await self.session.scalar(select(User.id).where(
            User.id == user_id, User.role == UserRole.ADMIN, User.is_active.is_(True),
        ).with_for_update()) is not None

    async def get(self, course_id: UUID, *, lock: bool = False, published: bool = False) -> Course | None:
        query = select(Course).where(Course.id == course_id)
        if published:
            query = query.where(Course.status == CourseStatus.PUBLISHED)
        if lock:
            query = query.with_for_update()
        return await self.session.scalar(query.execution_options(populate_existing=True))

    async def list(
        self, page: int, page_size: int, search: str | None, status: CourseStatus | None,
    ) -> tuple[list[Course], int]:
        filters = []
        if status is not None:
            filters.append(Course.status == status)
        if search and search.strip():
            filters.append(Course.title.icontains(search.strip(), autoescape=True))
        total = await self.session.scalar(select(func.count()).select_from(Course).where(*filters))
        rows = await self.session.scalars(select(Course).where(*filters)
            .order_by(Course.created_at, Course.id).offset((page - 1) * page_size).limit(page_size))
        return list(rows), total or 0

    async def save(self, course: Course) -> Course:
        self.session.add(course)
        await self.session.flush()
        await self.session.refresh(course)
        return course
