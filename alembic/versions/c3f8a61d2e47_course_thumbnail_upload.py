"""Remember which stored object an uploaded course thumbnail is.

``thumbnail_url`` is unchanged and still accepts any external address. When the
thumbnail was uploaded instead (BE-THUMBNAIL-UPLOAD-01), the application must
read and later delete the object, and a provider such as Google Drive addresses
it by an opaque handle that cannot be derived from the key. These three
nullable, provider-neutral columns hold that - the same trio ``lesson_resources``
uses. Existing rows keep NULLs: no URL is rewritten.

Revision ID: c3f8a61d2e47
Revises: b7d41e9c3a20
"""

from alembic import op
import sqlalchemy as sa

revision: str = "c3f8a61d2e47"
down_revision: str = "b7d41e9c3a20"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("thumbnail_storage_provider", sa.String(32), nullable=True))
    op.add_column("courses", sa.Column("thumbnail_storage_key", sa.String(512), nullable=True))
    op.add_column("courses", sa.Column("thumbnail_provider_reference", sa.String(512), nullable=True))
    op.create_check_constraint(
        "ck_courses_thumbnail_storage_provider", "courses",
        "thumbnail_storage_provider IS NULL OR thumbnail_storage_provider IN ('memory', 'google_drive')",
    )
    op.create_check_constraint(
        "ck_courses_thumbnail_object", "courses",
        "(thumbnail_storage_provider IS NULL AND thumbnail_storage_key IS NULL "
        "AND thumbnail_provider_reference IS NULL) OR "
        "(thumbnail_storage_provider IS NOT NULL AND thumbnail_storage_key IS NOT NULL "
        "AND thumbnail_provider_reference IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_courses_thumbnail_object", "courses", type_="check")
    op.drop_constraint("ck_courses_thumbnail_storage_provider", "courses", type_="check")
    op.drop_column("courses", "thumbnail_provider_reference")
    op.drop_column("courses", "thumbnail_storage_key")
    op.drop_column("courses", "thumbnail_storage_provider")
