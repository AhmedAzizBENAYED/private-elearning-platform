"""Administrator reads of member learning progress (BE-LEARNING-TRACKING-02).

Four reads, each one the whole of a screen's data:

    GET /admin/learning/progress        the matrix and the list, one page of
                                        member x published-course pairs
    GET /admin/learning/activity        what each member is using now or used last
    GET /admin/learning/members/{id}    one member: every course, and their events
    GET /admin/courses/{id}/learning    one published course's own figures

They read; they never write. No event is recorded by looking at a screen.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.v1.content_dependencies import admin_access, no_cache
from app.database.session import DatabaseSession
from app.repositories.course_repository import CourseRepository
from app.repositories.learning_report_repository import LearningReportRepository
from app.schemas.tracking import (
    CourseLearningSummary, LearningActivityPage, LearningActivityQuery, LearningProgressPage,
    LearningProgressQuery, MemberLearningResponse,
)
from app.services.learning_report_service import LearningReportService


def get_learning_report_service(session: DatabaseSession) -> LearningReportService:
    return LearningReportService(LearningReportRepository(session), CourseRepository(session))


ReportDependency = Annotated[LearningReportService, Depends(get_learning_report_service)]

router = APIRouter(prefix="/admin", tags=["admin learning progress"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses={
    401: {"description": "Missing/invalid credentials or inactive account"},
    403: {"description": "ADMIN role required"},
    404: {"description": "Member or published course not found"},
    422: {"description": "Invalid filter, sort or pagination"},
})


@router.get("/learning/progress", response_model=LearningProgressPage)
async def learning_progress(
    query: Annotated[LearningProgressQuery, Query()], service: ReportDependency,
) -> LearningProgressPage:
    """How far every member has come in every published course.

    One row per member and published course, the pairs with no activity
    included - that is what "Not started" means on the board. `counts` sizes
    the whole filtered set by status, ignoring `status` itself, so every tab
    can show its size at once.

    `active_since` keeps the pairs whose last activity is at or after that
    instant; the window is the caller's, since no "active now" threshold is
    settled yet.
    """
    return await service.progress(query)


@router.get("/learning/activity", response_model=LearningActivityPage)
async def learning_activity(
    query: Annotated[LearningActivityQuery, Query()], service: ReportDependency,
) -> LearningActivityPage:
    """Each member's latest learning event, and the last lesson they opened.

    Ordered by last activity, members with none last. `active_since` counts
    (and with `only_active`, keeps) the members whose latest event is at or
    after that instant: the data behind "Active now" and "Active learners",
    without fixing either window here.
    """
    return await service.activity(query)


@router.get("/learning/members/{member_id}", response_model=MemberLearningResponse)
async def member_learning(member_id: UUID, service: ReportDependency) -> MemberLearningResponse:
    """One member: every published course with its figures, and their last events.

    Courses are not paginated: the page lists the catalogue as it is, and the
    catalogue is bounded. 404 when the member does not exist or is not a MEMBER.
    """
    return await service.member(member_id)


@router.get("/courses/{course_id}/learning", response_model=CourseLearningSummary)
async def course_learning(course_id: UUID, service: ReportDependency) -> CourseLearningSummary:
    """One published course: members, started, in progress, completed, averages.

    The member rows behind these figures are
    `GET /admin/learning/progress?course_id=...`, so there is one definition of
    a row. 404 for a DRAFT or ARCHIVED course, which no member can reach.
    """
    return await service.course(course_id)
