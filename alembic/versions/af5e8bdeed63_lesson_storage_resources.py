"""Add provider-neutral lesson storage metadata.

No column names a vendor: ``storage_provider`` plus ``storage_key`` and an
opaque ``provider_reference`` describe an object at any provider.

Revision ID: af5e8bdeed63
Revises: a04d36e281cb
"""

from alembic import op
import sqlalchemy as sa

revision: str = "af5e8bdeed63"
down_revision: str = "a04d36e281cb"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "lesson_resources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lesson_id", sa.Uuid(), nullable=False),
        sa.Column("storage_provider", sa.Enum("memory", "google_drive", name="storage_provider",
                                            native_enum=False, create_constraint=True, length=32),
                  nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("provider_reference", sa.String(512), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum", sa.String(128), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_lesson_resources"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"],
                                name="fk_lesson_resources_lesson_id_lessons", ondelete="RESTRICT"),
        sa.UniqueConstraint("lesson_id", name="uq_lesson_resources_lesson_id"),
        sa.CheckConstraint("file_size_bytes > 0", name="ck_lesson_resources_size"),
        sa.CheckConstraint("length(trim(storage_key)) > 0", name="ck_lesson_resources_storage_key"),
        sa.CheckConstraint("length(trim(original_filename)) > 0", name="ck_lesson_resources_filename"),
        sa.CheckConstraint("length(trim(mime_type)) > 0", name="ck_lesson_resources_mime_type"),
        sa.CheckConstraint("duration_seconds IS NULL OR duration_seconds > 0",
                           name="ck_lesson_resources_duration"),
    )
    op.create_index("ix_lesson_resources_storage_key", "lesson_resources", ["storage_key"])
    op.execute("""
        CREATE FUNCTION set_lesson_resources_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = statement_timestamp();
            RETURN NEW;
        END;
        $$
    """)
    op.execute("CREATE TRIGGER lesson_resources_updated_at BEFORE UPDATE ON lesson_resources "
               "FOR EACH ROW EXECUTE FUNCTION set_lesson_resources_updated_at()")


def downgrade() -> None:
    op.execute("DROP TRIGGER lesson_resources_updated_at ON lesson_resources")
    op.execute("DROP FUNCTION set_lesson_resources_updated_at()")
    op.drop_index("ix_lesson_resources_storage_key", table_name="lesson_resources")
    op.drop_table("lesson_resources")
