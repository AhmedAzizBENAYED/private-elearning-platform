"""Add one-time member password setup credentials.

Revision ID: e82b14c069af
Revises: c71a92e045bd
"""

from alembic import op
import sqlalchemy as sa

revision: str = "e82b14c069af"
down_revision: str = "c71a92e045bd"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("activation_token_hash", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("activation_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_users_activation_token_hash", "users", ["activation_token_hash"])


def downgrade() -> None:
    op.drop_constraint("uq_users_activation_token_hash", "users", type_="unique")
    op.drop_column("users", "activation_expires_at")
    op.drop_column("users", "activation_token_hash")
