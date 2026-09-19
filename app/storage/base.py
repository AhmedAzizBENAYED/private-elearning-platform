"""The storage port: the only storage contract the business layer may import."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.storage.models import (
    AccessGrant, ByteRange, ObjectMetadata, ObjectRef, ObjectStream, StorageProvider, StoredObject,
)


class StoragePort(ABC):
    """Upload, read, inspect and delete opaque objects at a provider.

    Implementations must be safe to share across requests within one worker and
    must raise only :mod:`app.storage.exceptions` types. Uploads and downloads
    are streamed: no implementation may hold a whole object in memory.
    """

    provider: StorageProvider

    @abstractmethod
    async def upload(
        self, storage_key: str, chunks: AsyncIterator[bytes], *,
        filename: str, mime_type: str,
    ) -> StoredObject:
        """Consume ``chunks`` into a new object and return its durable identity.

        The caller owns key generation and size limits; the adapter only stores.
        """

    @abstractmethod
    async def metadata(self, ref: ObjectRef) -> ObjectMetadata:
        """Return provider-reported facts, or raise ``ObjectNotFound``."""

    @abstractmethod
    async def exists(self, ref: ObjectRef) -> bool:
        """Report whether the object is still present at the provider."""

    @abstractmethod
    async def access(self, ref: ObjectRef) -> AccessGrant:
        """Return short-lived read instructions; never persist the result."""

    @abstractmethod
    async def open(self, ref: ObjectRef, byte_range: ByteRange | None = None) -> ObjectStream:
        """Open a streaming read, honouring ``byte_range`` where supported."""

    @abstractmethod
    async def delete(self, ref: ObjectRef) -> None:
        """Remove the object. Deleting an absent object must succeed quietly."""

    async def aclose(self) -> None:
        """Release adapter-held resources during application shutdown."""
