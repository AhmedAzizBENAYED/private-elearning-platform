"""Ordered course modules; removing a module cascades only to its lessons."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class Module(Base):
    __tablename__ = "modules"
    __table_args__ = (
        UniqueConstraint("course_id", "position", name="uq_modules_course_position"),
        CheckConstraint("position > 0", name="ck_modules_position"),
        CheckConstraint("length(trim(title)) > 0", name="ck_modules_title"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("courses.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
