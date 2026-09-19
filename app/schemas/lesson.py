"""Lesson input types; content semantics are validated by the service."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.lesson import ContentType
from app.schemas.content import ContentInput, ContentPatch, Description, Position, Title

Content = Annotated[str, StringConstraints(min_length=1, max_length=100000)]
Duration = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


class LessonCreate(ContentInput):
    title: Title
    description: Description | None = None
    content_type: ContentType
    content: Content
    duration_seconds: Duration | None = None
    position: Position
    is_preview: bool = Field(default=False, strict=True)


class LessonUpdate(ContentPatch):
    _nullable_fields = frozenset({"description", "duration_seconds"})

    title: Title | None = None
    description: Description | None = None
    content_type: ContentType | None = None
    content: Content | None = None
    duration_seconds: Duration | None = None
    position: Position | None = None
    is_preview: bool | None = Field(default=None, strict=True)


class CatalogLesson(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    description: str | None
    content_type: ContentType
    duration_seconds: int | None
    position: int
    is_preview: bool


class CatalogLessonContent(CatalogLesson):
    """Member projection of a single lesson.

    ``content`` is null for VIDEO and DOCUMENT lessons: their payload is a
    storage reference, which is platform-internal and meaningless to a client.
    Members reach those files through ``GET /lessons/{id}/resource`` instead,
    which requires enrollment and returns no provider vocabulary.
    """

    content: str | None


class LessonResponse(CatalogLesson):
    """Administrator projection; the stored content reference is always present."""

    content: str
    module_id: UUID
    created_at: datetime
    updated_at: datetime
