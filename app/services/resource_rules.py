"""File validation for storage-backed lessons, independent of any provider.

Client-declared media types are treated as a claim, not a fact: the declared
type must be configured, must agree with the filename extension, and must match
the bytes actually uploaded.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

from app.core.exceptions import BusinessError
from app.models.lesson import ContentType
from app.storage.keys import EXTENSIONS

# Only these lesson kinds have stored bytes. LINK stays an external URL and
# TEXT stays in the database, as Ticket 5 defined them.
STORAGE_FOLDERS: dict[ContentType, str] = {
    ContentType.VIDEO: "videos",
    ContentType.DOCUMENT: "documents",
}
MAX_FILENAME_LENGTH = 255
UNSAFE_FILENAME = re.compile(r"[\x00-\x1f\x7f/\\]")
# Enough leading bytes to identify every format we sniff.
SIGNATURE_BYTES = 16


def _is_mp4(head: bytes) -> bool:
    return len(head) >= 12 and head[4:8] == b"ftyp"


SIGNATURES: dict[str, Callable[[bytes], bool]] = {
    "video/mp4": _is_mp4,
    "video/quicktime": _is_mp4,
    "video/webm": lambda head: head.startswith(b"\x1a\x45\xdf\xa3"),
    "application/pdf": lambda head: head.startswith(b"%PDF-"),
}


@dataclass(frozen=True, slots=True)
class UploadRules:
    """Configured limits, resolved once per request from settings."""

    max_bytes: int
    video_mime_types: frozenset[str]
    document_mime_types: frozenset[str]

    def allowed(self, content_type: ContentType) -> frozenset[str]:
        return (self.video_mime_types if content_type == ContentType.VIDEO
                else self.document_mime_types)


def require_storage_lesson(content_type: ContentType) -> str:
    """Return the key folder for a storable lesson, or reject the lesson kind."""
    folder = STORAGE_FOLDERS.get(content_type)
    if folder is None:
        raise BusinessError(409, "Only VIDEO and DOCUMENT lessons can hold a stored file")
    return folder


def validate_filename(filename: str | None) -> str:
    """Accept a display name only; it never influences the storage key."""
    name = (filename or "").strip()
    if not name or len(name) > MAX_FILENAME_LENGTH:
        raise BusinessError(422, "A filename between 1 and 255 characters is required")
    if UNSAFE_FILENAME.search(name) or name in {".", ".."}:
        raise BusinessError(422, "Filename must not contain path separators or control characters")
    return name


def validate_mime_type(content_type: ContentType, mime_type: str | None, filename: str,
                       rules: UploadRules) -> str:
    """Check the declared type against configuration and the filename extension."""
    declared = (mime_type or "").split(";", 1)[0].strip().lower()
    allowed = rules.allowed(content_type)
    if declared not in allowed:
        raise BusinessError(415, f"Unsupported media type for a {content_type.value} lesson")
    expected = EXTENSIONS.get(declared)
    if expected and not filename.lower().endswith(expected):
        raise BusinessError(422, f"Filename extension does not match {declared}")
    return declared


def validate_signature(mime_type: str, head: bytes) -> None:
    """Reject content whose leading bytes contradict the declared media type.

    Types without a registered signature are accepted on configuration alone;
    adding one to the allowlist is an explicit administrative decision.
    """
    matches = SIGNATURES.get(mime_type)
    if matches is not None and not matches(head):
        raise BusinessError(422, f"File content does not look like {mime_type}")
