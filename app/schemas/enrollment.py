"""Enrollment responses scoped to the current identity."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EnrollmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    course_id: UUID
    enrolled_at: datetime
    completed_at: datetime | None


class EnrollmentSummary(BaseModel):
    """One of the caller's enrollments, with the size and progress of its course.

    ``module_count``, ``total_video_lessons`` and ``completed_video_lessons``
    (G05) are the figures behind ``progress_percent`` and ``completed`` - they
    were already computed for those two and are now returned alongside them,
    with the names ``CourseContent`` and ``CourseProgressResponse`` use.
    """

    enrollment_id: UUID
    course_id: UUID
    title: str
    slug: str
    thumbnail_url: str | None
    enrolled_at: datetime
    completed_at: datetime | None
    progress_percent: float = Field(ge=0, le=100)
    completed: bool
    module_count: int = Field(ge=0)
    total_video_lessons: int = Field(ge=0)
    completed_video_lessons: int = Field(ge=0)
