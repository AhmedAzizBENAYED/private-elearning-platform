"""Create user identities and enforce timestamps for all database writers.

Revision ID: c71a92e045bd
Revises: afaf2d923ee7
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "c71a92e045bd"
down_revision: str | Sequence[str] | None = "afaf2d923ee7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("hashed_password", sa.String(512), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("role", sa.Enum(
            "ADMIN", "MEMBER", name="user_role", native_enum=False,
            create_constraint=True, length=32,
        ), server_default="MEMBER", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.CheckConstraint("email = lower(trim(email))", name="ck_users_email_normalized"),
        sa.CheckConstraint("length(email) > 3", name="ck_users_email_length"),
        sa.CheckConstraint("length(first_name) > 0", name="ck_users_first_name"),
        sa.CheckConstraint("length(last_name) > 0", name="ck_users_last_name"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.execute("""
        CREATE FUNCTION set_users_updated_at() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at = statement_timestamp();
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_users_updated_at()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER users_updated_at ON users")
    op.execute("DROP FUNCTION set_users_updated_at()")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
