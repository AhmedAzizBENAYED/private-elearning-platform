"""Course ownership, publication lifecycle and catalog metadata."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class CourseStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0", name="ck_courses_title"),
        CheckConstraint("length(trim(description)) > 0", name="ck_courses_description"),
        CheckConstraint("length(slug) > 0 AND slug = lower(trim(slug))", name="ck_courses_slug"),
        CheckConstraint(
            "(status = 'DRAFT' AND published_at IS NULL AND archived_at IS NULL) OR "
            "(status = 'PUBLISHED' AND published_at IS NOT NULL AND archived_at IS NULL) OR "
            "(status = 'ARCHIVED' AND published_at IS NOT NULL AND archived_at IS NOT NULL "
            "AND archived_at >= published_at)", name="ck_courses_lifecycle",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text)
    thumbnail_url: Mapped[str | None] = mapped_column(String(2048))
    status: Mapped[CourseStatus] = mapped_column(
        Enum(CourseStatus, name="course_status", native_enum=False, create_constraint=True,
             validate_strings=True, length=16),
        default=CourseStatus.DRAFT, server_default=CourseStatus.DRAFT.value, index=True,
    )
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
