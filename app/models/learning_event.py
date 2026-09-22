"""Append-only log of a member's learning events (BE-LEARNING-TRACKING-01).

One row per event: who, what (course, and module and lesson when relevant),
which kind, and when - always the server's time. Rows are never updated.

The log records *activity*. It is not a source of completion: whether a VIDEO
lesson is done is ``progress.completed_at`` and nothing else. A
``lesson_completed`` row is written, once, at the moment that column is first
set, so the log tells the story the progress table already holds.
"""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class LearningEventType(StrEnum):
    COURSE_OPENED = "course_opened"
    MODULE_OPENED = "module_opened"
    LESSON_OPENED = "lesson_opened"
    #: Server-written only, from the existing video completion.
    LESSON_COMPLETED = "lesson_completed"


class LearningEvent(Base):
    __tablename__ = "learning_events"
    __table_args__ = (
        # Each kind carries exactly the references it is about.
        CheckConstraint(
            "(event_type = 'course_opened' AND module_id IS NULL AND lesson_id IS NULL) OR "
            "(event_type = 'module_opened' AND module_id IS NOT NULL AND lesson_id IS NULL) OR "
            "(event_type IN ('lesson_opened', 'lesson_completed') "
            "AND module_id IS NOT NULL AND lesson_id IS NOT NULL)",
            name="ck_learning_events_shape",
        ),
        # A lesson is completed once per member, whatever the retries.
        Index("uq_learning_events_lesson_completed", "user_id", "lesson_id", unique=True,
              postgresql_where=text("event_type = 'lesson_completed'"),
              sqlite_where=text("event_type = 'lesson_completed'")),
        # A member's latest events, "recent activity", latest viewed lesson.
        Index("ix_learning_events_user_occurred", "user_id", "occurred_at"),
        # Everybody's recent events, for "active now".
        Index("ix_learning_events_occurred_at", "occurred_at"),
        Index("ix_learning_events_course_occurred", "course_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    event_type: Mapped[LearningEventType] = mapped_column(
        Enum(LearningEventType, name="learning_event_type", native_enum=False, create_constraint=True,
             validate_strings=True, length=32,
             values_callable=lambda enum: [member.value for member in enum]),
    )
    # RESTRICT, as progress does: events exist only for courses a member is
    # enrolled in, whose content can no longer be deleted.
    course_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("courses.id", ondelete="RESTRICT"))
    module_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("modules.id", ondelete="RESTRICT"))
    lesson_id: Mapped[UUID | None] = mapped_column(Uuid, ForeignKey("lessons.id", ondelete="RESTRICT"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
