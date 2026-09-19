"""Application-generated storage keys.

Keys are derived from stable identifiers only. Client filenames never reach the
key, so a hostile upload cannot choose where its bytes land or escape the course
prefix. Course titles are excluded on purpose: titles change, keys must not.
"""

import re
from uuid import UUID, uuid4

from app.storage.exceptions import InvalidStorageKey

MAX_KEY_LENGTH = 512
SEGMENT = r"[A-Za-z0-9][A-Za-z0-9._-]*"
STORAGE_KEY = re.compile(rf"^{SEGMENT}(?:/{SEGMENT})*$")
# Extensions are an allowlist, not a parse of whatever the client sent.
EXTENSIONS: dict[str, str] = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "application/pdf": ".pdf",
}


def validate_storage_key(key: str) -> str:
    """Reject absolute paths, traversal, control characters and empty segments."""
    if not key or len(key) > MAX_KEY_LENGTH:
        raise InvalidStorageKey("Storage key must be between 1 and 512 characters")
    if not STORAGE_KEY.fullmatch(key):
        raise InvalidStorageKey("Storage key must contain only safe path segments")
    if any(segment in {".", ".."} for segment in key.split("/")):
        raise InvalidStorageKey("Storage key must not contain traversal segments")
    return key


def build_storage_key(course_id: UUID, folder: str, mime_type: str) -> str:
    """Return ``courses/<course-id>/<folder>/<uuid><ext>`` for a new object.

    A fresh UUID per upload makes replacement collision-free and keeps a failed
    replacement from overwriting the object that is still in use.
    """
    return validate_storage_key(
        f"courses/{course_id}/{folder}/{uuid4()}{EXTENSIONS.get(mime_type, '')}"
    )


def key_prefix(key: str) -> tuple[str, ...]:
    """Directory segments of a key, for providers that model folders."""
    return tuple(validate_storage_key(key).split("/")[:-1])


def key_name(key: str) -> str:
    """Final segment of a key, used as the provider-side object name."""
    return validate_storage_key(key).rsplit("/", 1)[-1]
