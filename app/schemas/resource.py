"""Lesson resource responses. No provider credentials, IDs or URLs are exposed."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.lesson import ContentType


class ResourceResponse(BaseModel):
    """Administrator view of stored metadata.

    ``storage_provider`` and ``storage_key`` are the platform's own vocabulary,
    not a vendor's. ``provider_reference`` is deliberately absent: it is an
    internal handle with no meaning to any client.
    """

    model_config = ConfigDict(from_attributes=True)
    resource_id: UUID = Field(validation_alias="id")
    lesson_id: UUID
    storage_provider: str
    storage_key: str
    filename: str = Field(validation_alias="original_filename")
    mime_type: str
    size_bytes: int = Field(validation_alias="file_size_bytes")
    checksum: str | None
    duration_seconds: int | None
    created_at: datetime
    updated_at: datetime


class MemberResourceResponse(BaseModel):
    """What an enrolled member needs to render or download a lesson's file.

    ``download_url`` always points back at this API, never at the provider, so
    switching providers cannot change the client contract.
    """

    lesson_id: UUID
    resource_id: UUID
    content_type: ContentType
    filename: str
    mime_type: str
    size_bytes: int
    duration_seconds: int | None
    download_url: str
