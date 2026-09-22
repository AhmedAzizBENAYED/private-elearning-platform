"""Course persistence, filtering and row locking; no commits."""

from uuid import UUID

from sqlalchemy import and_, case, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, CourseStatus
from app.models.enrollment import Enrollment
from app.models.lesson import ContentType, Lesson
from app.models.module import Module
from app.models.progress import Progress
from app.models.user import User, UserRole

#: The catalogue's enrollment states, as the SQL ``CASE`` below spells them.
NOT_ENROLLED, IN_PROGRESS, COMPLETED = "not_enrolled", "in_progress", "completed"


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

    @staticmethod
    def _filters(search: str | None, status: CourseStatus | None) -> list:
        filters = []
        if status is not None:
            filters.append(Course.status == status)
        if search and search.strip():
            filters.append(Course.title.icontains(search.strip(), autoescape=True))
        return filters

    @staticmethod
    def _order(newest_first: bool) -> tuple:
        # The id breaks ties, so a page boundary cannot repeat or skip a row
        # when several courses share a creation timestamp.
        if newest_first:
            return (Course.created_at.desc(), Course.id.desc())
        return (Course.created_at, Course.id)

    async def count(self, search: str | None, status: CourseStatus | None) -> int:
        filters = self._filters(search, status)
        return await self.session.scalar(select(func.count()).select_from(Course).where(*filters)) or 0

    async def list(
        self, page: int, page_size: int, search: str | None, status: CourseStatus | None,
        *, newest_first: bool = False,
    ) -> tuple[list[Course], int]:
        filters = self._filters(search, status)
        total = await self.count(search, status)
        rows = await self.session.scalars(select(Course).where(*filters)
            .order_by(*self._order(newest_first)).offset((page - 1) * page_size).limit(page_size))
        return list(rows), total

    async def list_with_counts(
        self, page: int, page_size: int, search: str | None, status: CourseStatus | None,
        *, newest_first: bool = False,
    ) -> tuple[list[tuple[Course, int, int]], int]:
        """The same page, plus how many modules and lessons each course holds.

        Both counts are correlated scalar subqueries on the one statement that
        reads the page, so a listing costs a single round trip however many
        rows it returns - never a query per course, and never one per module.

        Lessons are counted through ``modules`` because a lesson belongs to a
        module, not directly to a course.
        """
        filters = self._filters(search, status)
        modules = (select(func.count()).select_from(Module)
                   .where(Module.course_id == Course.id).scalar_subquery())
        lessons = (select(func.count()).select_from(Lesson).join(Module, Lesson.module_id == Module.id)
                   .where(Module.course_id == Course.id).scalar_subquery())

        total = await self.count(search, status)
        result = await self.session.execute(
            select(Course, modules.label("module_count"), lessons.label("lesson_count"))
            .where(*filters).order_by(*self._order(newest_first))
            .offset((page - 1) * page_size).limit(page_size)
        )
        return [(row[0], row[1], row[2]) for row in result.all()], total

    async def catalog_page(
        self, user_id: UUID, page: int, page_size: int, search: str | None, enrollment: str | None,
    ) -> tuple[list[tuple[Course, int, int]], dict[str, int]]:
        """A page of the published catalogue for one caller, with its tab counts.

        Returns the page's rows - each course with its module count and its
        VIDEO lesson count - and how many published courses matching
        ``search`` are in each enrollment state for ``user_id``.

        Two statements whatever the page size: one groups the matching courses
        by state, one reads the page. Every figure is a correlated subquery on
        the course row, so there is never a query per course or per module.
        The filtered total is the matching group's count, so the page and its
        total cannot disagree.

        The state follows the one completion rule the API already uses
        (``completion_summary``, ``video_counts_query``): enrolled with every
        VIDEO lesson completed is ``completed``; enrolled otherwise - a course
        with no video included - is ``in_progress``. Lessons are reached
        through ``modules``: a lesson belongs to a module, not to a course.
        """
        modules = (select(func.count()).select_from(Module)
                   .where(Module.course_id == Course.id).scalar_subquery())
        videos = (select(func.count()).select_from(Lesson).join(Module, Lesson.module_id == Module.id)
                  .where(Module.course_id == Course.id, Lesson.content_type == ContentType.VIDEO)
                  .scalar_subquery())
        completed_videos = (
            select(func.count()).select_from(Progress)
            .join(Lesson, Progress.lesson_id == Lesson.id).join(Module, Lesson.module_id == Module.id)
            .where(Module.course_id == Course.id, Lesson.content_type == ContentType.VIDEO,
                   Progress.user_id == user_id, Progress.completed.is_(True))
            .scalar_subquery()
        )
        enrolled = exists().where(Enrollment.course_id == Course.id, Enrollment.user_id == user_id)
        state = case(
            (~enrolled, NOT_ENROLLED),
            (and_(videos > 0, completed_videos == videos), COMPLETED),
            else_=IN_PROGRESS,
        )
        filters = self._filters(search, CourseStatus.PUBLISHED)

        states = select(state.label("state")).where(*filters).subquery()
        grouped = await self.session.execute(select(states.c.state, func.count()).group_by(states.c.state))
        counts = {NOT_ENROLLED: 0, IN_PROGRESS: 0, COMPLETED: 0}
        for name, count in grouped.all():
            counts[name] = int(count)
        counts["all"] = sum(counts.values())

        query = select(Course, modules.label("module_count"), videos.label("total_video_lessons")).where(*filters)
        if enrollment is not None:
            query = query.where(state == enrollment)
        result = await self.session.execute(
            query.order_by(*self._order(False)).offset((page - 1) * page_size).limit(page_size)
        )
        return [(row[0], int(row[1]), int(row[2])) for row in result.all()], counts

    async def save(self, course: Course) -> Course:
        self.session.add(course)
        await self.session.flush()
        await self.session.refresh(course)
        return course
