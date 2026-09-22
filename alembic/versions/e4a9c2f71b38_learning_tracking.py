"""Record member learning events, and each enrollment's started / last activity dates.

``learning_events`` is the append-only log the tracking logic asks for: course,
module and lesson openings, and VIDEO completions. ``enrollments`` gains
``started_at`` and ``last_activity_at``, the first and latest event of a member
in a course. Completion is not duplicated: it stays ``progress.completed_at``
and ``enrollments.completed_at``.

Existing enrollments keep NULL for both new columns: no event was recorded
before this revision, and no date is invented for them.

Revision ID: e4a9c2f71b38
Revises: c3f8a61d2e47
"""

from alembic import op
import sqlalchemy as sa

revision: str = "e4a9c2f71b38"
down_revision: str = "c3f8a61d2e47"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None

EVENT_TYPES = ("course_opened", "module_opened", "lesson_opened", "lesson_completed")


def upgrade() -> None:
    op.add_column("enrollments", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("enrollments", sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "ck_enrollments_activity_time", "enrollments",
        "(started_at IS NULL AND last_activity_at IS NULL) OR "
        "(started_at IS NOT NULL AND last_activity_at IS NOT NULL AND last_activity_at >= started_at)",
    )

    op.create_table(
        "learning_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.Enum(*EVENT_TYPES, name="learning_event_type", native_enum=False,
                                        create_constraint=True, length=32), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=True),
        sa.Column("lesson_id", sa.Uuid(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_learning_events"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_learning_events_user_id_users",
                                ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], name="fk_learning_events_course_id_courses",
                                ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], name="fk_learning_events_module_id_modules",
                                ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], name="fk_learning_events_lesson_id_lessons",
                                ondelete="RESTRICT"),
        sa.CheckConstraint(
            "(event_type = 'course_opened' AND module_id IS NULL AND lesson_id IS NULL) OR "
            "(event_type = 'module_opened' AND module_id IS NOT NULL AND lesson_id IS NULL) OR "
            "(event_type IN ('lesson_opened', 'lesson_completed') "
            "AND module_id IS NOT NULL AND lesson_id IS NOT NULL)",
            name="ck_learning_events_shape",
        ),
    )
    op.create_index("uq_learning_events_lesson_completed", "learning_events", ["user_id", "lesson_id"],
                    unique=True, postgresql_where=sa.text("event_type = 'lesson_completed'"))
    op.create_index("ix_learning_events_user_occurred", "learning_events", ["user_id", "occurred_at"])
    op.create_index("ix_learning_events_occurred_at", "learning_events", ["occurred_at"])
    op.create_index("ix_learning_events_course_occurred", "learning_events", ["course_id", "occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_learning_events_course_occurred", table_name="learning_events")
    op.drop_index("ix_learning_events_occurred_at", table_name="learning_events")
    op.drop_index("ix_learning_events_user_occurred", table_name="learning_events")
    op.drop_index("uq_learning_events_lesson_completed", table_name="learning_events")
    op.drop_table("learning_events")
    op.drop_constraint("ck_enrollments_activity_time", "enrollments", type_="check")
    op.drop_column("enrollments", "last_activity_at")
    op.drop_column("enrollments", "started_at")
