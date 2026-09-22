"""Admin course contracts and safe member catalog projections."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints

from app.models.course import CourseStatus
from app.schemas.content import ContentInput, ContentPatch, Description, Title
from app.schemas.pagination import Page, Pagination

Slug = Annotated[str, StringConstraints(min_length=1, max_length=200, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]
Thumbnail = Annotated[HttpUrl, Field(max_length=2048)]


class CourseCreate(ContentInput):
    title: Title
    description: Description
    slug: Slug | None = None
    thumbnail_url: Thumbnail | None = None


class CourseUpdate(ContentPatch):
    _nullable_fields = frozenset({"thumbnail_url"})

    title: Title | None = None
    description: Description | None = None
    slug: Slug | None = None
    thumbnail_url: Thumbnail | None = None


class CatalogQuery(Pagination):
    search: str | None = Field(default=None, max_length=200)


class CourseSort(StrEnum):
    """How an administrator listing is ordered.

    The default is the order this endpoint has always returned - oldest first -
    so adding the parameter changes nothing for a caller that omits it.
    """

    CREATED_ASC = "created_at"
    CREATED_DESC = "-created_at"


class EnrollmentFilter(StrEnum):
    """Which of the caller's own courses a catalogue page keeps (G04).

    The three states partition the published catalogue for one member, with the
    rule every other progress read already uses: enrolled and every VIDEO
    lesson completed is ``completed``; enrolled otherwise - including a course
    with no video, which never completes - is ``in_progress``.
    """

    NOT_ENROLLED = "not_enrolled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class CatalogListQuery(CatalogQuery):
    """``GET /courses``: the catalogue query, plus the optional enrollment tab."""

    enrollment: EnrollmentFilter | None = None


class CourseQuery(CatalogQuery):
    status: CourseStatus | None = None
    sort: CourseSort = CourseSort.CREATED_ASC


class CatalogCourse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    slug: str
    description: str
    thumbnail_url: str | None
    status: CourseStatus
    published_at: datetime | None


class CourseResponse(CatalogCourse):
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class CourseListItem(CourseResponse):
    """A row of the administrator listing, with the size of the course.

    The two counts exist on the listing and nowhere else. They are aggregates
    over other tables rather than columns of a course, so they are computed for
    the page being returned - one statement, two correlated subqueries - and
    are not carried on the single-course responses, where nothing displays them
    and every write would have to recount.

    ``lesson_count`` spans the whole course, not one module: it counts the
    lessons of every module the course owns.
    """

    module_count: int = Field(ge=0)
    lesson_count: int = Field(ge=0)


class CatalogCourseListItem(CatalogCourse):
    """A catalogue row, with the size of the course (G05).

    Counted from the database for the page being returned, exactly as the
    administrator listing counts: every module the course owns, and every
    VIDEO lesson across those modules - the lessons that decide completion, the
    same figure ``CourseContent.total_video_lessons`` reports. An empty course
    counts 0 and 0. Not carried by ``GET /courses/{id}``, which is unchanged.
    """

    module_count: int = Field(ge=0)
    total_video_lessons: int = Field(ge=0)


class CatalogEnrollmentCounts(BaseModel):
    """How many published courses fall in each tab, for the caller (G04).

    Computed with the page's ``search`` but without its ``enrollment`` filter or
    its pagination, so every tab can show its size at once. ``all`` is always
    the sum of the other three.
    """

    all: int = Field(ge=0)
    not_enrolled: int = Field(ge=0)
    in_progress: int = Field(ge=0)
    completed: int = Field(ge=0)


class CatalogPage(Page[CatalogCourseListItem]):
    """``Page[CatalogCourseListItem]`` plus the tab counts; ``total`` is the filtered total."""

    enrollment_counts: CatalogEnrollmentCounts
