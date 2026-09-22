"""Aggregated reads for the administrator learning screens (BE-LEARNING-TRACKING-02).

Everything is grouped SQL. A page of the matrix costs one statement for its
rows and one for its counts, whatever the number of members, courses, modules
or lessons: the per-course video totals, the member's completed videos and the
member's completed modules are three grouped subqueries joined once, never a
query per row.

No rule is redefined here. Only VIDEO lessons are counted, a module is complete
when it has videos and they are all done, and "started" is a recorded event or
a completed video - the same statements ``tracking_service`` makes in Python.
"""

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, Select, and_, case, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course, CourseStatus
from app.models.enrollment import Enrollment
from app.models.learning_event import LearningEvent, LearningEventType
from app.models.lesson import ContentType, Lesson
from app.models.module import Module
from app.models.progress import Progress
from app.models.user import User, UserRole
from app.schemas.tracking import LearningProgressQuery, LearningProgressSort
from app.services.tracking_service import CourseLearningStatus


def _course_totals():
    """Per course: how many modules it holds and how many VIDEO lessons."""
    return (
        select(Module.course_id.label("course_id"),
               func.count(func.distinct(Module.id)).label("total_modules"),
               func.count(Lesson.id).label("total_videos"))
        .select_from(Module)
        .outerjoin(Lesson, and_(Lesson.module_id == Module.id, Lesson.content_type == ContentType.VIDEO))
        .group_by(Module.course_id).subquery()
    )


def _completed_videos():
    """Per member and course: the VIDEO lessons that member has completed."""
    return (
        select(Progress.user_id.label("user_id"), Module.course_id.label("course_id"),
               func.count(Progress.id).label("completed_videos"))
        .select_from(Progress)
        .join(Lesson, Lesson.id == Progress.lesson_id)
        .join(Module, Module.id == Lesson.module_id)
        .where(Progress.completed.is_(True), Lesson.content_type == ContentType.VIDEO)
        .group_by(Progress.user_id, Module.course_id).subquery()
    )


def _completed_modules():
    """Per member and course: the modules whose every VIDEO lesson is done.

    Counted per module first - a module with no video can never reach its own
    total, so it is never complete - then folded up to the course.
    """
    per_module = (
        select(User.id.label("user_id"), Module.course_id.label("course_id"), Module.id.label("module_id"),
               func.count(Lesson.id).label("videos"),
               func.count(Progress.id).filter(Progress.completed.is_(True)).label("done"))
        .select_from(User)
        .join(Module, true())
        .join(Lesson, and_(Lesson.module_id == Module.id, Lesson.content_type == ContentType.VIDEO))
        .outerjoin(Progress, and_(Progress.lesson_id == Lesson.id, Progress.user_id == User.id))
        .where(User.role == UserRole.MEMBER)
        .group_by(User.id, Module.course_id, Module.id).subquery()
    )
    return (
        select(per_module.c.user_id, per_module.c.course_id,
               func.count().label("completed_modules"))
        .where(per_module.c.videos > 0, per_module.c.done == per_module.c.videos)
        .group_by(per_module.c.user_id, per_module.c.course_id).subquery()
    )


class LearningReportRepository:
    """Member x published-course figures, and the activity behind them."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------- the pair matrix

    @staticmethod
    def _pairs() -> tuple[Select, dict]:
        """Every member and every published course, with their figures."""
        totals, videos, modules = _course_totals(), _completed_videos(), _completed_modules()
        completed_videos = func.coalesce(videos.c.completed_videos, 0)
        total_videos = func.coalesce(totals.c.total_videos, 0)
        columns = {
            "completed_videos": completed_videos,
            "total_videos": total_videos,
            "completed_modules": func.coalesce(modules.c.completed_modules, 0),
            "total_modules": func.coalesce(totals.c.total_modules, 0),
            # The rules of BE-LEARNING-TRACKING-01, in SQL, so a page can be
            # filtered and ordered by them without reading every row.
            "is_completed": and_(total_videos > 0, completed_videos == total_videos),
            "is_started": or_(Enrollment.started_at.is_not(None), completed_videos > 0),
        }
        columns["status"] = case(
            (columns["is_completed"], CourseLearningStatus.COMPLETED.value),
            (columns["is_started"], CourseLearningStatus.IN_PROGRESS.value),
            else_=CourseLearningStatus.NOT_STARTED.value,
        )
        query = (
            select(User, Course, Enrollment.started_at, Enrollment.last_activity_at,
                   Enrollment.completed_at,
                   columns["completed_videos"].label("completed_videos"),
                   columns["total_videos"].label("total_videos"),
                   columns["completed_modules"].label("completed_modules"),
                   columns["total_modules"].label("total_modules"),
                   columns["status"].label("pair_status"))
            .select_from(User)
            # One row per member and published course, as the matrix draws it.
            .join(Course, true())
            .outerjoin(Enrollment, and_(Enrollment.user_id == User.id, Enrollment.course_id == Course.id))
            .outerjoin(totals, totals.c.course_id == Course.id)
            .outerjoin(videos, and_(videos.c.user_id == User.id, videos.c.course_id == Course.id))
            .outerjoin(modules, and_(modules.c.user_id == User.id, modules.c.course_id == Course.id))
            .where(User.role == UserRole.MEMBER, Course.status == CourseStatus.PUBLISHED)
        )
        return query, columns

    @staticmethod
    def _filtered(query: Select, columns: dict, filters: LearningProgressQuery,
                  *, with_status: bool = True) -> Select:
        if filters.course_id is not None:
            query = query.where(Course.id == filters.course_id)
        if filters.member_id is not None:
            query = query.where(User.id == filters.member_id)
        if filters.search:
            text = filters.search.strip()
            query = query.where(or_(
                User.email.icontains(text, autoescape=True),
                User.first_name.icontains(text, autoescape=True),
                User.last_name.icontains(text, autoescape=True),
                Course.title.icontains(text, autoescape=True),
            ))
        if filters.active_since is not None:
            query = query.where(Enrollment.last_activity_at >= filters.active_since)
        if with_status and filters.status is not None:
            query = query.where(columns["status"] == filters.status.value)
        return query

    @staticmethod
    def _ordered(query: Select, columns: dict, sort: LearningProgressSort) -> Select:
        share = func.coalesce(columns["completed_videos"] * 1.0 / func.nullif(columns["total_videos"], 0), 0)
        order = {
            # "rows without activity sort last" (Admin-Progress-List).
            LearningProgressSort.LAST_ACTIVITY: (Enrollment.last_activity_at.desc().nullslast(),),
            LearningProgressSort.STARTED: (Enrollment.started_at.desc().nullslast(),),
            LearningProgressSort.COMPLETED: (Enrollment.completed_at.desc().nullslast(),),
            LearningProgressSort.PROGRESS_DESC: (share.desc(),),
            LearningProgressSort.PROGRESS_ASC: (share.asc(),),
            LearningProgressSort.MEMBER: (User.first_name, User.last_name),
        }[sort]
        # A stable tail, so pages never overlap or skip a pair.
        return query.order_by(*order, User.id, Course.id)

    async def pairs(self, filters: LearningProgressQuery, *, paginate: bool = True) -> Sequence[Row]:
        """One page of pairs, or - for a member's own page - all of theirs."""
        query, columns = self._pairs()
        query = self._ordered(self._filtered(query, columns, filters), columns, filters.sort)
        if paginate:
            query = query.offset((filters.page - 1) * filters.page_size).limit(filters.page_size)
        return (await self.session.execute(query)).all()

    async def counts(self, filters: LearningProgressQuery) -> dict[str, int]:
        """The whole filtered set by status, in one grouped statement.

        The status filter itself is left out, exactly as the catalogue's tab
        counts are, so every tab can show its size at once.
        """
        query, columns = self._pairs()
        base = self._filtered(query, columns, filters, with_status=False).subquery()
        row = (await self.session.execute(
            select(func.count().label("all"),
                   func.count().filter(base.c.pair_status == CourseLearningStatus.NOT_STARTED.value).label("not_started"),
                   func.count().filter(base.c.pair_status == CourseLearningStatus.IN_PROGRESS.value).label("in_progress"),
                   func.count().filter(base.c.pair_status == CourseLearningStatus.COMPLETED.value).label("completed"))
            .select_from(base)
        )).one()
        return {"all": row.all, "not_started": row.not_started, "in_progress": row.in_progress,
                "completed": row.completed, "started": row.in_progress + row.completed}

    async def course_figures(self, course_id: UUID) -> Row:
        """One course's status split and its average progress, in one statement."""
        query, columns = self._pairs()
        base = query.where(Course.id == course_id).add_columns(
            func.coalesce(columns["completed_videos"] * 100.0 / func.nullif(columns["total_videos"], 0), 0)
            .label("percent")
        ).subquery()
        started = base.c.pair_status != CourseLearningStatus.NOT_STARTED.value
        return (await self.session.execute(
            select(func.count().label("all"),
                   func.count().filter(base.c.pair_status == CourseLearningStatus.NOT_STARTED.value).label("not_started"),
                   func.count().filter(base.c.pair_status == CourseLearningStatus.IN_PROGRESS.value).label("in_progress"),
                   func.count().filter(base.c.pair_status == CourseLearningStatus.COMPLETED.value).label("completed"),
                   func.avg(base.c.percent).filter(started).label("average_started"),
                   func.max(base.c.total_modules).label("total_modules"),
                   func.max(base.c.total_videos).label("total_videos"))
            .select_from(base)
        )).one()

    # ----------------------------------------------------------- the members

    def _activity_subquery(self):
        """Each member's latest learning event time, from the enrollment dates."""
        return (
            select(Enrollment.user_id.label("user_id"),
                   func.max(Enrollment.last_activity_at).label("last_activity_at"))
            .group_by(Enrollment.user_id).subquery()
        )

    async def activity(self, search: str | None = None, page: int = 1, page_size: int = 20,
                       active_since: datetime | None = None, only_active: bool = False,
                       member_id: UUID | None = None) -> tuple[Sequence[Row], int, int, int | None]:
        """One row per member: their latest event time and their last lesson.

        The last lesson is the newest ``lesson_opened`` of that member, picked
        by a window function - one statement for the whole page, not one per
        member - and the course figures beside it are that course's own.
        """
        activity = self._activity_subquery()
        ranked = (
            select(LearningEvent.user_id, LearningEvent.course_id, LearningEvent.module_id,
                   LearningEvent.lesson_id,
                   func.row_number().over(partition_by=LearningEvent.user_id,
                                          order_by=LearningEvent.occurred_at.desc()).label("rank"))
            .where(LearningEvent.event_type == LearningEventType.LESSON_OPENED).subquery()
        )
        latest = select(ranked).where(ranked.c.rank == 1).subquery()
        totals, videos = _course_totals(), _completed_videos()

        query = (
            select(User, activity.c.last_activity_at, Course, Lesson, Module,
                   func.coalesce(videos.c.completed_videos, 0).label("completed_videos"),
                   func.coalesce(totals.c.total_videos, 0).label("total_videos"),
                   Enrollment.started_at)
            .select_from(User)
            .outerjoin(activity, activity.c.user_id == User.id)
            .outerjoin(latest, latest.c.user_id == User.id)
            .outerjoin(Course, Course.id == latest.c.course_id)
            .outerjoin(Module, Module.id == latest.c.module_id)
            .outerjoin(Lesson, Lesson.id == latest.c.lesson_id)
            .outerjoin(Enrollment, and_(Enrollment.user_id == User.id, Enrollment.course_id == Course.id))
            .outerjoin(totals, totals.c.course_id == Course.id)
            .outerjoin(videos, and_(videos.c.user_id == User.id, videos.c.course_id == Course.id))
            .where(User.role == UserRole.MEMBER)
        )
        if member_id is not None:
            query = query.where(User.id == member_id)
        if search:
            text = search.strip()
            query = query.where(or_(*(
                column.icontains(text, autoescape=True)
                for column in (User.email, User.first_name, User.last_name)
            )))
        if only_active and active_since is not None:
            query = query.where(activity.c.last_activity_at >= active_since)

        rows = (await self.session.execute(
            query.order_by(activity.c.last_activity_at.desc().nullslast(), User.id)
            .offset((page - 1) * page_size).limit(page_size)
        )).all()
        if member_id is not None:
            return rows, len(rows), 0, None
        return (rows, await self._count(query.subquery()),
                await self._count_members(activity, None),
                None if active_since is None else await self._count_members(activity, active_since))

    async def _count(self, base) -> int:
        return int(await self.session.scalar(select(func.count()).select_from(base)) or 0)

    async def _count_members(self, activity, since: datetime | None) -> int:
        """Members with any activity, or - with ``since`` - with activity since then."""
        query = (
            select(activity.c.user_id).join(User, User.id == activity.c.user_id)
            .where(User.role == UserRole.MEMBER,
                   activity.c.last_activity_at.is_not(None) if since is None
                   else activity.c.last_activity_at >= since)
        )
        return await self._count(query.subquery())

    async def member_activity(self, user_id: UUID) -> Row | None:
        """The same row, for one member."""
        rows, _, _, _ = await self.activity(member_id=user_id, page_size=1)
        return rows[0] if rows else None

    async def recent_events(self, user_id: UUID, limit: int) -> Sequence[Row]:
        """A member's latest events, with the titles the activity list shows."""
        return (await self.session.execute(
            select(LearningEvent, Course.title, Module.title.label("module_title"),
                   Lesson.title.label("lesson_title"))
            .select_from(LearningEvent)
            .join(Course, Course.id == LearningEvent.course_id)
            .outerjoin(Module, Module.id == LearningEvent.module_id)
            .outerjoin(Lesson, Lesson.id == LearningEvent.lesson_id)
            .where(LearningEvent.user_id == user_id)
            .order_by(LearningEvent.occurred_at.desc()).limit(limit)
        )).all()

    async def member(self, member_id: UUID) -> User | None:
        return await self.session.scalar(
            select(User).where(User.id == member_id, User.role == UserRole.MEMBER)
        )
