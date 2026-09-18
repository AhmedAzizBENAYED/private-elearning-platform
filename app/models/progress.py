"""Per-member video progress; course progress is derived, never stored separately."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class Progress(Base):
    __tablename__ = "progress"
    __table_args__ = (
        UniqueConstraint("user_id", "lesson_id", name="uq_progress_user_lesson"),
        CheckConstraint("watched_seconds >= 0", name="ck_progress_watched_seconds"),
        CheckConstraint(
            "(completed AND completed_at IS NOT NULL) OR (NOT completed AND completed_at IS NULL)",
            name="ck_progress_completion_time",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    lesson_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("lessons.id", ondelete="RESTRICT"), index=True)
    watched_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
