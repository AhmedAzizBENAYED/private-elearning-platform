"""Provider-neutral storage value objects shared by the domain and the adapters.

Nothing here names a vendor concept. Adapters translate between these types and
their own API (Google Drive file IDs, S3 object versions, and so on), so the
business layer can move between providers without changing.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class StorageProvider(StrEnum):
    """Durable identity of the system that holds an object's bytes."""

    MEMORY = "memory"
    GOOGLE_DRIVE = "google_drive"


class AccessKind(StrEnum):
    """How a caller reaches an object's bytes for this provider."""

    REDIRECT = "redirect"
    """The provider issues a short-lived URL the client may fetch directly."""

    STREAM = "stream"
    """The provider has no shareable URL; the application must relay the bytes."""


@dataclass(frozen=True, slots=True)
class ObjectRef:
    """Everything needed to address a stored object again.

    ``storage_key`` is the application's stable, provider-independent path.
    ``provider_reference`` is an opaque handle the adapter assigned at upload
    time; key-addressable providers may simply repeat the key.
    """

    storage_key: str
    provider_reference: str


@dataclass(frozen=True, slots=True)
class StoredObject:
    """The result of a successful upload."""

    ref: ObjectRef
    filename: str
    mime_type: str
    size_bytes: int
    checksum: str | None = None

    @property
    def storage_key(self) -> str:
        return self.ref.storage_key

    @property
    def provider_reference(self) -> str:
        return self.ref.provider_reference


@dataclass(frozen=True, slots=True)
class ObjectMetadata:
    """Provider-reported facts about an object that already exists."""

    ref: ObjectRef
    filename: str
    mime_type: str
    size_bytes: int
    checksum: str | None = None
    modified_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class AccessGrant:
    """Temporary, never-persisted instructions for reading an object.

    ``url`` is populated only for :attr:`AccessKind.REDIRECT`. Grants are
    generated per request and must not be written to the database.
    """

    kind: AccessKind
    expires_at: datetime | None = None
    url: str | None = None


@dataclass(frozen=True, slots=True)
class ByteRange:
    """An inclusive, zero-based request for part of an object."""

    start: int
    end: int | None = None


@dataclass(slots=True)
class ObjectStream:
    """A lazily consumed download; ``chunks`` is never fully materialised."""

    mime_type: str
    size_bytes: int | None
    chunks: AsyncIterator[bytes]
    content_range: str | None = None
    partial: bool = False
