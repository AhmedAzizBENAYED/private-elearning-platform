"""Create course, module and lesson catalog with explicit ownership/cascades.

Revision ID: f93c25d170ba
Revises: e82b14c069af
"""

from alembic import op
import sqlalchemy as sa

revision: str = "f93c25d170ba"
down_revision: str = "e82b14c069af"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("thumbnail_url", sa.String(2048), nullable=True),
        sa.Column("status", sa.Enum("DRAFT", "PUBLISHED", "ARCHIVED", name="course_status",
                                  native_enum=False, create_constraint=True, length=16),
                  server_default="DRAFT", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_courses"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="fk_courses_created_by_users", ondelete="RESTRICT"),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_courses_title"),
        sa.CheckConstraint("length(trim(description)) > 0", name="ck_courses_description"),
        sa.CheckConstraint("length(slug) > 0 AND slug = lower(trim(slug))", name="ck_courses_slug"),
        sa.CheckConstraint(
            "(status = 'DRAFT' AND published_at IS NULL AND archived_at IS NULL) OR "
            "(status = 'PUBLISHED' AND published_at IS NOT NULL AND archived_at IS NULL) OR "
            "(status = 'ARCHIVED' AND published_at IS NOT NULL AND archived_at IS NOT NULL "
            "AND archived_at >= published_at)", name="ck_courses_lifecycle",
        ),
    )
    op.create_index("ix_courses_slug", "courses", ["slug"], unique=True)
    op.create_index("ix_courses_status", "courses", ["status"])
    op.create_index("ix_courses_created_by", "courses", ["created_by"])
    op.create_table(
        "modules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_modules"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], name="fk_modules_course_id_courses", ondelete="RESTRICT"),
        sa.UniqueConstraint("course_id", "position", name="uq_modules_course_position"),
        sa.CheckConstraint("position > 0", name="ck_modules_position"),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_modules_title"),
    )
    op.create_table(
        "lessons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("content_type", sa.Enum("VIDEO", "DOCUMENT", "LINK", "TEXT", name="lesson_content_type",
                                        native_enum=False, create_constraint=True, length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("is_preview", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_lessons"),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], name="fk_lessons_module_id_modules", ondelete="CASCADE"),
        sa.UniqueConstraint("module_id", "position", name="uq_lessons_module_position"),
        sa.CheckConstraint("position > 0", name="ck_lessons_position"),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_lessons_title"),
        sa.CheckConstraint("length(trim(content)) > 0", name="ck_lessons_content"),
        sa.CheckConstraint("duration_seconds IS NULL OR duration_seconds > 0", name="ck_lessons_duration"),
        sa.CheckConstraint("content_type = 'VIDEO' OR duration_seconds IS NULL", name="ck_lessons_content_duration"),
    )
    # Database writers receive the same timestamp behavior as SQLAlchemy updates.
    op.execute("""
        CREATE FUNCTION set_catalog_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = statement_timestamp();
            RETURN NEW;
        END;
        $$
    """)
    for table in ("courses", "modules", "lessons"):
        op.execute(f"CREATE TRIGGER {table}_updated_at BEFORE UPDATE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION set_catalog_updated_at()")


def downgrade() -> None:
    for table in ("lessons", "modules", "courses"):
        op.execute(f"DROP TRIGGER {table}_updated_at ON {table}")
    op.execute("DROP FUNCTION set_catalog_updated_at()")
    op.drop_table("lessons")
    op.drop_table("modules")
    op.drop_index("ix_courses_created_by", table_name="courses")
    op.drop_index("ix_courses_status", table_name="courses")
    op.drop_index("ix_courses_slug", table_name="courses")
    op.drop_table("courses")
