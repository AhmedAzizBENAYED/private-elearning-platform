"""Provider-neutral storage metadata for a lesson's primary file.

One lesson has at most one resource. Columns describe the object in vendor-free
terms so a provider migration rewrites rows, not the learning domain. Temporary
download URLs are never stored: they expire, and persisting them would tie the
schema to one provider's URL format.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Uuid, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.storage.models import StorageProvider


class LessonResource(Base):
    __tablename__ = "lesson_resources"
    __table_args__ = (
        CheckConstraint("file_size_bytes > 0", name="ck_lesson_resources_size"),
        CheckConstraint("length(trim(storage_key)) > 0", name="ck_lesson_resources_storage_key"),
        CheckConstraint("length(trim(original_filename)) > 0", name="ck_lesson_resources_filename"),
        CheckConstraint("length(trim(mime_type)) > 0", name="ck_lesson_resources_mime_type"),
        CheckConstraint("duration_seconds IS NULL OR duration_seconds > 0",
                        name="ck_lesson_resources_duration"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    # RESTRICT, not CASCADE: deleting a lesson must not silently orphan bytes at
    # the provider. Administrators remove the resource first, which also removes
    # the stored object.
    lesson_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("lessons.id", ondelete="RESTRICT"), unique=True,
    )
    storage_provider: Mapped[StorageProvider] = mapped_column(
        # values_callable stores the lowercase member values; SQLAlchemy would
        # otherwise persist the member *names* and contradict the migration.
        Enum(StorageProvider, name="storage_provider", native_enum=False,
             create_constraint=True, validate_strings=True, length=32,
             values_callable=lambda enum: [member.value for member in enum]),
    )
    # Indexed for provider reconciliation, which looks objects up by key.
    storage_key: Mapped[str] = mapped_column(String(512), index=True)
    # Opaque handle assigned by the provider at upload time; never a URL.
    provider_reference: Mapped[str] = mapped_column(String(512))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(255))
    file_size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum: Mapped[str | None] = mapped_column(String(128))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
