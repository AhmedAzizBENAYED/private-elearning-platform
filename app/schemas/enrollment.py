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
    enrollment_id: UUID
    course_id: UUID
    title: str
    slug: str
    thumbnail_url: str | None
    enrolled_at: datetime
    completed_at: datetime | None
    progress_percent: float = Field(ge=0, le=100)
    completed: bool
