"""In-memory storage adapter for local development and the test suite.

It implements the full port so business tests never need provider credentials.
It is not durable and is rejected by configuration in production.
"""

import hashlib
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from uuid import uuid4

from app.storage.base import StoragePort
from app.storage.exceptions import ObjectNotFound
from app.storage.keys import validate_storage_key
from app.storage.models import (
    AccessGrant, AccessKind, ByteRange, ObjectMetadata, ObjectRef, ObjectStream,
    StorageProvider, StoredObject,
)


class InMemoryStorage(StoragePort):
    """A dictionary of objects keyed by the reference the adapter handed out."""

    provider = StorageProvider.MEMORY

    def __init__(self, *, chunk_size: int = 64 * 1024) -> None:
        self._objects: dict[str, tuple[ObjectMetadata, bytes]] = {}
        self._chunk_size = chunk_size

    async def upload(
        self, storage_key: str, chunks: AsyncIterator[bytes], *,
        filename: str, mime_type: str,
    ) -> StoredObject:
        validate_storage_key(storage_key)
        digest, payload = hashlib.sha256(), bytearray()
        async for chunk in chunks:
            digest.update(chunk)
            payload.extend(chunk)
        reference = uuid4().hex
        ref = ObjectRef(storage_key=storage_key, provider_reference=reference)
        checksum = digest.hexdigest()
        self._objects[reference] = (
            ObjectMetadata(ref=ref, filename=filename, mime_type=mime_type,
                           size_bytes=len(payload), checksum=checksum,
                           modified_at=datetime.now(timezone.utc)),
            bytes(payload),
        )
        return StoredObject(ref=ref, filename=filename, mime_type=mime_type,
                            size_bytes=len(payload), checksum=checksum)

    def _load(self, ref: ObjectRef) -> tuple[ObjectMetadata, bytes]:
        try:
            return self._objects[ref.provider_reference]
        except KeyError:
            raise ObjectNotFound(f"No object for key {ref.storage_key}") from None

    async def metadata(self, ref: ObjectRef) -> ObjectMetadata:
        return self._load(ref)[0]

    async def exists(self, ref: ObjectRef) -> bool:
        return ref.provider_reference in self._objects

    async def access(self, ref: ObjectRef) -> AccessGrant:
        self._load(ref)
        return AccessGrant(kind=AccessKind.STREAM)

    async def open(self, ref: ObjectRef, byte_range: ByteRange | None = None) -> ObjectStream:
        metadata, payload = self._load(ref)
        start, end, total = 0, len(payload) - 1, len(payload)
        partial = False
        if byte_range is not None and total:
            start = min(byte_range.start, total - 1)
            end = total - 1 if byte_range.end is None else min(byte_range.end, total - 1)
            partial = True
        window = payload[start:end + 1]

        async def stream() -> AsyncIterator[bytes]:
            for offset in range(0, len(window), self._chunk_size):
                yield window[offset:offset + self._chunk_size]

        return ObjectStream(
            mime_type=metadata.mime_type, size_bytes=len(window), chunks=stream(),
            content_range=f"bytes {start}-{end}/{total}" if partial else None,
            partial=partial,
        )

    async def delete(self, ref: ObjectRef) -> None:
        self._objects.pop(ref.provider_reference, None)
