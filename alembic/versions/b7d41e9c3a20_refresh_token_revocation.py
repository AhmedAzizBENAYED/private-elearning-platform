"""Record revoked refresh tokens so sign-out ends a session server-side.

A denylist keyed by the token's own ``jti``. The token string is never stored:
``jti`` is a random UUID that is worthless without the signature, so this table
holds no credential. Rows are only meaningful until ``expires_at``, after which
the JWT is refused on its own expiry and the row can be purged.

Revision ID: b7d41e9c3a20
Revises: af5e8bdeed63
"""

from alembic import op
import sqlalchemy as sa

revision: str = "b7d41e9c3a20"
down_revision: str = "af5e8bdeed63"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "revoked_refresh_tokens",
        sa.Column("jti", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        # The jti is the identity, so revoking twice collides instead of
        # inserting a second row.
        sa.PrimaryKeyConstraint("jti", name="pk_revoked_refresh_tokens"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"],
                                name="fk_revoked_refresh_tokens_user_id_users",
                                ondelete="RESTRICT"),
    )
    op.create_index("ix_revoked_refresh_tokens_user_id", "revoked_refresh_tokens", ["user_id"])
    op.create_index("ix_revoked_refresh_tokens_expires_at", "revoked_refresh_tokens", ["expires_at"])


def downgrade() -> None:
    # Reversible, and safe: dropping the denylist restores the previous
    # behaviour (refresh tokens live until they expire) and destroys no member
    # data - every row here describes a credential that is already unwanted.
    op.drop_index("ix_revoked_refresh_tokens_expires_at", table_name="revoked_refresh_tokens")
    op.drop_index("ix_revoked_refresh_tokens_user_id", table_name="revoked_refresh_tokens")
    op.drop_table("revoked_refresh_tokens")
