"""The administrator learning reads (BE-LEARNING-TRACKING-02).

This service reports; it decides nothing new. Percentages come from
``completion_summary`` and statuses from ``course_status`` - the functions the
member endpoints already use - so an administrator screen and a member's own
page can never disagree about the same course.
"""

from uuid import UUID

from sqlalchemy import Row

from app.core.exceptions import BusinessError
from app.models.course import CourseStatus
from app.repositories.course_repository import CourseRepository
from app.repositories.learning_report_repository import LearningReportRepository
from app.schemas.tracking import (
    CourseLearningSummary, CourseRef, LearningActivityPage, LearningActivityQuery, LearningEventEntry,
    LearningProgressPage, LearningProgressQuery, LearningStatusCounts, LessonRef, MemberActivity,
    MemberCourseProgress, MemberLearningResponse, MemberRef,
)
from app.services.enrollment_service import completion_summary
from app.services.tracking_service import CourseLearningStatus, course_status

#: Events shown on a member's page (Data-Needs: "the last 5 to 10 events").
RECENT_EVENTS = 10


def _pair(row: Row) -> MemberCourseProgress:
    """One member x course row, with the percentage the whole backend uses."""
    percent, _ = completion_summary(row.total_videos, row.completed_videos)
    return MemberCourseProgress(
        member=MemberRef.model_validate(row[0]), course=CourseRef.model_validate(row[1]),
        # Recomputed in Python from the same figures the SQL filtered on, so
        # one definition of the status stands.
        status=course_status(row.started_at is not None, row.total_videos, row.completed_videos),
        progress_percent=percent,
        completed_video_lessons=row.completed_videos, total_video_lessons=row.total_videos,
        completed_modules=row.completed_modules, total_modules=row.total_modules,
        started_at=row.started_at, last_activity_at=row.last_activity_at, completed_at=row.completed_at,
    )


def _activity(row: Row) -> MemberActivity:
    """One member's latest lesson, and where that course stands for them."""
    member, last_activity_at, course, lesson, module = row[0], row[1], row[2], row[3], row[4]
    if course is None or lesson is None or module is None:
        return MemberActivity(member=MemberRef.model_validate(member), last_activity_at=last_activity_at,
                              course=None, lesson=None, status=None)
    percent, _ = completion_summary(row.total_videos, row.completed_videos)
    return MemberActivity(
        member=MemberRef.model_validate(member), last_activity_at=last_activity_at,
        course=CourseRef.model_validate(course),
        lesson=LessonRef(id=lesson.id, title=lesson.title, module_id=module.id,
                         module_title=module.title, module_position=module.position),
        status=course_status(row.started_at is not None, row.total_videos, row.completed_videos),
        progress_percent=percent, completed_video_lessons=row.completed_videos,
        total_video_lessons=row.total_videos,
    )


class LearningReportService:
    def __init__(self, reports: LearningReportRepository, courses: CourseRepository) -> None:
        self.reports = reports
        self.courses = courses

    async def progress(self, query: LearningProgressQuery) -> LearningProgressPage:
        """The matrix and the list: one page of member x published-course pairs."""
        rows = await self.reports.pairs(query)
        counts = await self.reports.counts(query)
        total = counts["all"] if query.status is None else counts[query.status.value.lower()]
        return LearningProgressPage(
            items=[_pair(row) for row in rows], total=total,
            page=query.page, page_size=query.page_size, counts=LearningStatusCounts(**counts),
        )

    async def activity(self, query: LearningActivityQuery) -> LearningActivityPage:
        """What each member is using now, or used most recently."""
        rows, total, with_activity, active = await self.reports.activity(
            query.search, query.page, query.page_size, query.active_since, query.only_active,
        )
        return LearningActivityPage(
            items=[_activity(row) for row in rows], total=total, page=query.page,
            page_size=query.page_size, members_with_activity=with_activity, active_members=active,
        )

    async def member(self, member_id: UUID) -> MemberLearningResponse:
        """One member: every published course, their last lesson, their last events."""
        member = await self.reports.member(member_id)
        if member is None:
            raise BusinessError(404, "Member not found")
        query = LearningProgressQuery(member_id=member_id)
        rows = await self.reports.pairs(query, paginate=False)
        counts = await self.reports.counts(query)
        latest = await self.reports.member_activity(member_id)
        events = await self.reports.recent_events(member_id, RECENT_EVENTS)
        activity = None if latest is None else _activity(latest)
        # "No course opened yet": a member with no recorded lesson has no
        # latest location, only the (empty) dates below.
        return MemberLearningResponse(
            member=MemberRef.model_validate(member), counts=LearningStatusCounts(**counts),
            last_activity_at=None if activity is None else activity.last_activity_at,
            latest=None if activity is None or activity.course is None else activity,
            courses=[_pair(row) for row in rows],
            recent_events=[
                LearningEventEntry(
                    id=event.id, type=event.event_type, occurred_at=event.occurred_at,
                    course_id=event.course_id, course_title=title, module_id=event.module_id,
                    module_title=module_title, lesson_id=event.lesson_id, lesson_title=lesson_title,
                )
                for event, title, module_title, lesson_title in events
            ],
        )

    async def course(self, course_id: UUID) -> CourseLearningSummary:
        """One published course: how its members stand, and how far they got."""
        course = await self.courses.get(course_id)
        if course is None or course.status != CourseStatus.PUBLISHED:
            # The screens report on the catalogue; a draft has no member figures.
            raise BusinessError(404, "Published course not found")
        figures = await self.reports.course_figures(course_id)
        started = figures.in_progress + figures.completed
        return CourseLearningSummary(
            course=CourseRef.model_validate(course),
            total_modules=int(figures.total_modules or 0), total_video_lessons=int(figures.total_videos or 0),
            counts=LearningStatusCounts(
                all=figures.all, not_started=figures.not_started, in_progress=figures.in_progress,
                completed=figures.completed, started=started,
            ),
            # "of members who started", and "completed / started" - the board's
            # own definitions; both 0 while nobody has started.
            average_progress_percent=round(float(figures.average_started or 0), 2),
            completion_rate_percent=round(figures.completed * 100 / started, 2) if started else 0.0,
        )


__all__ = ["CourseLearningStatus", "LearningReportService", "RECENT_EVENTS"]
