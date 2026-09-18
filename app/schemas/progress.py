"""Only watched time is client writable; completion fields are server owned."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    watched_seconds: int = Field(strict=True, ge=0, le=2147483647)


class ProgressResponse(BaseModel):
    lesson_id: UUID
    watched_seconds: int
    duration_seconds: int | None
    completed: bool
    completed_at: datetime | None


class CourseProgressResponse(BaseModel):
    course_id: UUID
    total_video_lessons: int
    completed_video_lessons: int
    progress_percent: float = Field(ge=0, le=100)
    completed: bool
