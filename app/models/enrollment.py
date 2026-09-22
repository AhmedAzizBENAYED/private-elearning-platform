"""A member's durable course enrollment and completion milestone.

``started_at`` and ``last_activity_at`` (BE-LEARNING-TRACKING-01) are the
per-course read model of the learning-event log: the first and the latest
learning event of this member in this course. Both are written in the same
transaction as the event itself, and only by learning events.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_enrollments_user_course"),
        CheckConstraint("completed_at IS NULL OR completed_at >= enrolled_at", name="ck_enrollments_completion_time"),
        CheckConstraint(
            "(started_at IS NULL AND last_activity_at IS NULL) OR "
            "(started_at IS NOT NULL AND last_activity_at IS NOT NULL AND last_activity_at >= started_at)",
            name="ck_enrollments_activity_time",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    course_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("courses.id", ondelete="RESTRICT"), index=True)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
