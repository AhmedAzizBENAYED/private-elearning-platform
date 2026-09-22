"""Administrator read contracts for member learning progress (BE-LEARNING-TRACKING-02).

Every figure here is derived from what BE-LEARNING-TRACKING-01 already stores -
``progress.completed_at`` for a finished VIDEO, ``enrollments`` for the dates,
``learning_events`` for the activity - with the rules those tickets fixed:
only VIDEO lessons count, percentages keep two decimals, and a course with no
video never completes.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.learning_event import LearningEventType
from app.schemas.pagination import Page, Pagination
from app.services.tracking_service import CourseLearningStatus


class MemberRef(BaseModel):
    """Who the row is about; the same identity fields the member screens show."""

    model_config = ConfigDict(from_attributes=True)
    id: UUID
    first_name: str
    last_name: str
    email: str
    is_active: bool


class CourseRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    slug: str


class LessonRef(BaseModel):
    id: UUID
    title: str
    module_id: UUID
    module_title: str
    module_position: int


class MemberCourseProgress(BaseModel):
    """One member in one published course: the matrix cell and the list row.

    ``completed_modules`` counts the modules whose VIDEO lessons are all done;
    a module without video is never one of them, exactly as a course without
    video never completes. The dates are ``null`` for a pair with no activity.
    """

    member: MemberRef
    course: CourseRef
    status: CourseLearningStatus
    progress_percent: float = Field(ge=0, le=100)
    completed_video_lessons: int = Field(ge=0)
    total_video_lessons: int = Field(ge=0)
    completed_modules: int = Field(ge=0)
    total_modules: int = Field(ge=0)
    started_at: datetime | None
    last_activity_at: datetime | None
    completed_at: datetime | None


class LearningStatusCounts(BaseModel):
    """How the filtered pairs split, for the header figures of the two screens."""

    all: int = Field(ge=0)
    not_started: int = Field(ge=0)
    in_progress: int = Field(ge=0)
    completed: int = Field(ge=0)
    started: int = Field(ge=0)


class LearningProgressSort(StrEnum):
    """The board's own sort options; rows with no activity always sort last."""

    LAST_ACTIVITY = "-last_activity"
    STARTED = "-started"
    COMPLETED = "-completed"
    PROGRESS_DESC = "-progress"
    PROGRESS_ASC = "progress"
    MEMBER = "member"


class LearningProgressQuery(Pagination):
    """``GET /admin/learning/progress``: the matrix and the list, filtered."""

    search: str | None = Field(default=None, max_length=200)
    course_id: UUID | None = None
    member_id: UUID | None = None
    status: CourseLearningStatus | None = None
    #: Keeps the pairs whose last activity is at or after this instant. The
    #: caller chooses the window: no "active now" threshold is fixed here.
    active_since: datetime | None = None
    sort: LearningProgressSort = LearningProgressSort.LAST_ACTIVITY


class LearningProgressPage(Page[MemberCourseProgress]):
    """A page of pairs, plus the counts of the whole filtered set."""

    counts: LearningStatusCounts


class MemberActivity(BaseModel):
    """What one member is using now, or used most recently (Admin-Activity).

    ``last_activity_at`` is the latest learning event of the member, in any
    course. ``course`` and ``lesson`` come from the last ``lesson_opened``
    event, so they are the last lesson actually opened - never a guess. All of
    them are ``null`` for a member who has no recorded activity.
    """

    member: MemberRef
    last_activity_at: datetime | None
    course: CourseRef | None
    lesson: LessonRef | None
    status: CourseLearningStatus | None
    progress_percent: float | None = Field(default=None, ge=0, le=100)
    completed_video_lessons: int | None = Field(default=None, ge=0)
    total_video_lessons: int | None = Field(default=None, ge=0)


class LearningActivityQuery(Pagination):
    search: str | None = Field(default=None, max_length=200)
    #: Counts (and, with ``only_active``, keeps) the members whose last event is
    #: at or after this instant - the data behind "Active now" and "Active
    #: learners", whose windows the caller decides.
    active_since: datetime | None = None
    only_active: bool = False


class LearningActivityPage(Page[MemberActivity]):
    members_with_activity: int = Field(ge=0)
    #: How many members are active since ``active_since``; ``null`` without it.
    active_members: int | None = Field(default=None, ge=0)


class LearningEventEntry(BaseModel):
    """One recorded event, named for the activity list of a member's page."""

    id: UUID
    type: LearningEventType
    occurred_at: datetime
    course_id: UUID
    course_title: str
    module_id: UUID | None
    module_title: str | None
    lesson_id: UUID | None
    lesson_title: str | None


class MemberLearningResponse(BaseModel):
    """``GET /admin/members/{id}/learning``: one member's whole learning picture.

    ``courses`` holds every PUBLISHED course - the ones the member never opened
    included, as "Not started" - which is what the member page lists.
    """

    member: MemberRef
    counts: LearningStatusCounts
    last_activity_at: datetime | None
    latest: MemberActivity | None
    courses: list[MemberCourseProgress]
    recent_events: list[LearningEventEntry]


class CourseLearningSummary(BaseModel):
    """``GET /admin/courses/{id}/learning``: the course's own figures.

    ``average_progress_percent`` averages the members who started, as the board
    states ("of members who started"), and ``completion_rate_percent`` is
    completed ÷ started. Both are ``0`` when nobody started.
    """

    course: CourseRef
    total_modules: int = Field(ge=0)
    total_video_lessons: int = Field(ge=0)
    counts: LearningStatusCounts
    average_progress_percent: float = Field(ge=0, le=100)
    completion_rate_percent: float = Field(ge=0, le=100)
