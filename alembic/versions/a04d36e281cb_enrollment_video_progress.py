"""Add member enrollment and video progress without a course-progress table.

Revision ID: a04d36e281cb
Revises: f93c25d170ba
"""

from alembic import op
import sqlalchemy as sa

revision: str = "a04d36e281cb"
down_revision: str = "f93c25d170ba"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "enrollments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_enrollments"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_enrollments_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], name="fk_enrollments_course_id_courses", ondelete="RESTRICT"),
        sa.UniqueConstraint("user_id", "course_id", name="uq_enrollments_user_course"),
        sa.CheckConstraint("completed_at IS NULL OR completed_at >= enrolled_at", name="ck_enrollments_completion_time"),
    )
    op.create_index("ix_enrollments_course_id", "enrollments", ["course_id"])
    op.create_table(
        "progress",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("lesson_id", sa.Uuid(), nullable=False),
        sa.Column("watched_seconds", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("completed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_progress"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_progress_user_id_users", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], name="fk_progress_lesson_id_lessons", ondelete="RESTRICT"),
        sa.UniqueConstraint("user_id", "lesson_id", name="uq_progress_user_lesson"),
        sa.CheckConstraint("watched_seconds >= 0", name="ck_progress_watched_seconds"),
        sa.CheckConstraint(
            "(completed AND completed_at IS NOT NULL) OR (NOT completed AND completed_at IS NULL)",
            name="ck_progress_completion_time",
        ),
    )
    op.create_index("ix_progress_lesson_id", "progress", ["lesson_id"])
    op.execute("""
        CREATE FUNCTION set_progress_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = statement_timestamp();
            RETURN NEW;
        END;
        $$
    """)
    op.execute("CREATE TRIGGER progress_updated_at BEFORE UPDATE ON progress "
               "FOR EACH ROW EXECUTE FUNCTION set_progress_updated_at()")


def downgrade() -> None:
    op.execute("DROP TRIGGER progress_updated_at ON progress")
    op.execute("DROP FUNCTION set_progress_updated_at()")
    op.drop_index("ix_progress_lesson_id", table_name="progress")
    op.drop_table("progress")
    op.drop_index("ix_enrollments_course_id", table_name="enrollments")
    op.drop_table("enrollments")
