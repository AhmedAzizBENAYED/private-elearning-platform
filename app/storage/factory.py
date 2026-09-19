"""Build the configured storage adapter without leaking provider details."""

from app.core.config import Settings
from app.storage.base import StoragePort
from app.storage.memory import InMemoryStorage
from app.storage.models import StorageProvider


def create_storage(settings: Settings) -> StoragePort:
    """Return the adapter named by ``STORAGE_PROVIDER``.

    Google credentials are read here and nowhere else in the application; the
    adapter keeps them in memory and never returns or logs them.
    """
    if settings.storage_provider == StorageProvider.GOOGLE_DRIVE:
        # Imported lazily so the memory provider needs no HTTP client at all.
        from app.storage.google_drive import GoogleDriveStorage

        return GoogleDriveStorage(
            client_id=settings.google_drive_client_id,
            client_secret=settings.google_drive_client_secret.get_secret_value(),
            refresh_token=settings.google_drive_refresh_token.get_secret_value(),
            root_folder_id=settings.google_drive_root_folder_id,
            chunk_bytes=settings.storage_upload_chunk_bytes,
            timeout_seconds=settings.google_drive_timeout_seconds,
        )
    return InMemoryStorage()
