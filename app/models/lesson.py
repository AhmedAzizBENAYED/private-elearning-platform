"""Ordered lesson content references; no storage or upload integration."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class ContentType(StrEnum):
    VIDEO = "VIDEO"
    DOCUMENT = "DOCUMENT"
    LINK = "LINK"
    TEXT = "TEXT"


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (
        UniqueConstraint("module_id", "position", name="uq_lessons_module_position"),
        CheckConstraint("position > 0", name="ck_lessons_position"),
        CheckConstraint("length(trim(title)) > 0", name="ck_lessons_title"),
        CheckConstraint("length(trim(content)) > 0", name="ck_lessons_content"),
        CheckConstraint("duration_seconds IS NULL OR duration_seconds > 0", name="ck_lessons_duration"),
        CheckConstraint("content_type = 'VIDEO' OR duration_seconds IS NULL", name="ck_lessons_content_duration"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    module_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("modules.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[ContentType] = mapped_column(
        Enum(ContentType, name="lesson_content_type", native_enum=False,
             create_constraint=True, validate_strings=True, length=16),
    )
    content: Mapped[str] = mapped_column(Text)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer)
    is_preview: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
