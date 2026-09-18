"""Admin course contracts and safe member catalog projections."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints

from app.models.course import CourseStatus
from app.schemas.content import ContentInput, ContentPatch, Description, Title
from app.schemas.pagination import Pagination

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


class CourseQuery(CatalogQuery):
    status: CourseStatus | None = None


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
