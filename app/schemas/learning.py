"""The member learning page: one course, its tree, and this member's progress.

Every field is either catalog metadata or the current user's own progress. No
lesson content reference, storage key, provider identifier or other member's
data appears here; files are still reached through the resource endpoint.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.course import CourseStatus
from app.schemas.lesson import CatalogLesson
from app.schemas.module import CatalogModule


class CourseContentLesson(CatalogLesson):
    """Catalog lesson metadata plus the current member's state for it.

    Progress exists only for VIDEO lessons, which is why the three progress
    fields are null for every other kind rather than a misleading zero.
    ``has_resource`` says whether a stored file exists, so a client knows
    whether ``GET /lessons/{id}/resource`` will succeed without asking first.
    """

    has_resource: bool
    watched_seconds: int | None
    completed: bool | None
    completed_at: datetime | None


class CourseContentModule(CatalogModule):
    lessons: list[CourseContentLesson]


class CourseContent(BaseModel):
    """A complete learning page; the aggregates match ``/courses/{id}/progress``."""

    course_id: UUID
    title: str
    slug: str
    description: str
    thumbnail_url: str | None
    status: CourseStatus
    published_at: datetime | None
    total_video_lessons: int
    completed_video_lessons: int
    progress_percent: float = Field(ge=0, le=100)
    completed: bool
    modules: list[CourseContentModule]
