"""Module inputs and separate member/admin projections."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.content import ContentInput, ContentPatch, Description, Position, Title


class ModuleCreate(ContentInput):
    title: Title
    description: Description | None = None
    position: Position


class ModuleUpdate(ContentPatch):
    _nullable_fields = frozenset({"description"})

    title: Title | None = None
    description: Description | None = None
    position: Position | None = None


class CatalogModule(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    description: str | None
    position: int


class ModuleResponse(CatalogModule):
    course_id: UUID
    created_at: datetime
    updated_at: datetime
