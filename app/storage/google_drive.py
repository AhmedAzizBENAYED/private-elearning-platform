"""Google Drive adapter. The only module in the application aware of Drive.

Authentication uses an OAuth 2.0 *installed application* refresh token rather
than a service account: a service account owns no My Drive quota, so files it
creates in a personal Drive folder are unusable. See ``docs/storage.md`` for the
one-time authorization procedure.

Everything Drive-specific stays here: file IDs, folder lookups, resumable upload
sessions and ``alt=media`` downloads. Callers see only ``app.storage.models``.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone

import httpx

from app.storage.base import StoragePort
from app.storage.exceptions import ObjectNotFound, StorageAuthError, StorageUnavailable
from app.storage.keys import key_name, key_prefix, validate_storage_key
from app.storage.models import (
    AccessGrant, AccessKind, ByteRange, ObjectMetadata, ObjectRef, ObjectStream,
    StorageProvider, StoredObject,
)

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_URL = "https://www.googleapis.com/drive/v3"
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"
FILE_FIELDS = "id,name,mimeType,size,md5Checksum,modifiedTime"
# Drive requires every non-final resumable chunk to be a multiple of 256 KiB.
CHUNK_MULTIPLE = 256 * 1024
TOKEN_EXPIRY_MARGIN = timedelta(seconds=60)
# The platform's own folder, created by the setup script rather than by hand.
ROOT_FOLDER_NAME = "Private E-Learning Platform"


def _quote(value: str) -> str:
    """Escape a literal for a Drive ``q`` search expression."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


async def ensure_root_folder(
    client: httpx.AsyncClient, access_token: str, name: str = ROOT_FOLDER_NAME,
) -> tuple[str, bool]:
    """Find or create the platform's root folder, returning ``(id, created)``.

    Used once, by ``scripts/google_drive_authorize.py``. The ``drive.file`` scope
    grants per-file access to files the application itself created, so the root
    **must** be created through the API: a folder the user made by hand is
    invisible to the application and rejects every write into it.

    The search is not restricted to ``root``, so an operator may freely move or
    nest the folder afterwards without a second one being created. Under
    ``drive.file`` a listing only ever returns application-created files, so the
    name lookup cannot match an unrelated folder of the user's own.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    query = (f"name = '{_quote(name)}' and mimeType = '{FOLDER_MIME}' and trashed = false")
    try:
        found = await client.get(f"{API_URL}/files", headers=headers, params={
            "q": query, "fields": "files(id)", "pageSize": 1,
            "orderBy": "createdTime", "supportsAllDrives": "true",
        })
        if found.status_code != 200:
            logger.error("Root folder lookup failed", extra={"status_code": found.status_code})
            raise StorageUnavailable("Could not look up the storage root folder")
        if files := found.json().get("files", []):
            return files[0]["id"], False
        created = await client.post(f"{API_URL}/files", headers=headers,
                                    params={"fields": "id", "supportsAllDrives": "true"},
                                    json={"name": name, "mimeType": FOLDER_MIME})
    except httpx.HTTPError as exc:
        raise StorageUnavailable("The storage provider could not be reached") from exc
    if created.status_code not in {200, 201}:
        logger.error("Root folder creation failed", extra={"status_code": created.status_code})
        raise StorageUnavailable("Could not create the storage root folder")
    return created.json()["id"], True


class GoogleDriveStorage(StoragePort):
    """Stores objects under one configurable Drive folder owned by the platform."""

    provider = StorageProvider.GOOGLE_DRIVE

    def __init__(
        self, *, client_id: str, client_secret: str, refresh_token: str,
        root_folder_id: str, chunk_bytes: int, timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._refresh_token = refresh_token
        self._root_folder_id = root_folder_id
        self._chunk_bytes = max(CHUNK_MULTIPLE, (chunk_bytes // CHUNK_MULTIPLE) * CHUNK_MULTIPLE)
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None
        self._access_token: str | None = None
        self._token_expires_at = datetime.min.replace(tzinfo=timezone.utc)
        self._token_lock = asyncio.Lock()
        self._folders: dict[tuple[str, ...], str] = {(): root_folder_id}
        self._folder_lock = asyncio.Lock()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # ---------------------------------------------------------------- auth

    async def _token(self) -> str:
        """Exchange the refresh token for a short-lived access token, once."""
        async with self._token_lock:
            now = datetime.now(timezone.utc)
            if self._access_token is not None and now < self._token_expires_at:
                return self._access_token
            try:
                response = await self._client.post(TOKEN_URL, data={
                    "client_id": self._client_id, "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token, "grant_type": "refresh_token",
                })
            except httpx.HTTPError as exc:
                raise StorageAuthError("Could not reach the storage token endpoint") from exc
            if response.status_code != 200:
                # The body echoes the client secret on some errors; never log it.
                logger.error("Storage token refresh rejected", extra={"status_code": response.status_code})
                raise StorageAuthError("Storage credentials were rejected")
            payload = response.json()
            self._access_token = payload["access_token"]
            self._token_expires_at = now + timedelta(seconds=int(payload.get("expires_in", 3600))) - TOKEN_EXPIRY_MARGIN
            return self._access_token

    async def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        return {"Authorization": f"Bearer {await self._token()}", **(extra or {})}

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Issue an authorized request, translating transport failures."""
        headers = await self._headers(kwargs.pop("headers", None))
        try:
            response = await self._client.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise StorageUnavailable("The storage provider could not be reached") from exc
        if response.status_code in {401, 403}:
            self._access_token = None
            logger.error("Storage request denied", extra={"status_code": response.status_code})
            raise StorageAuthError("Storage credentials were rejected")
        return response

    @staticmethod
    def _fail(response: httpx.Response, action: str) -> None:
        logger.error("Storage %s failed", action, extra={"status_code": response.status_code})
        raise StorageUnavailable(f"Storage {action} failed")

    # ------------------------------------------------------------- folders

    async def _folder(self, path: tuple[str, ...]) -> str:
        """Resolve, creating if needed, the Drive folder for a key prefix."""
        if (cached := self._folders.get(path)) is not None:
            return cached
        async with self._folder_lock:
            if (cached := self._folders.get(path)) is not None:
                return cached
            parent = self._root_folder_id
            for depth, name in enumerate(path, start=1):
                prefix = path[:depth]
                if (known := self._folders.get(prefix)) is not None:
                    parent = known
                    continue
                parent = await self._find_or_create_folder(name, parent)
                self._folders[prefix] = parent
            return parent

    async def _find_or_create_folder(self, name: str, parent_id: str) -> str:
        query = (f"name = '{_quote(name)}' and '{_quote(parent_id)}' in parents "
                 f"and mimeType = '{FOLDER_MIME}' and trashed = false")
        response = await self._request("GET", f"{API_URL}/files", params={
            "q": query, "fields": "files(id)", "pageSize": 1,
            "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
        })
        if response.status_code != 200:
            self._fail(response, "folder lookup")
        if files := response.json().get("files", []):
            return files[0]["id"]
        created = await self._request("POST", f"{API_URL}/files", params={
            "fields": "id", "supportsAllDrives": "true",
        }, json={"name": name, "mimeType": FOLDER_MIME, "parents": [parent_id]})
        if created.status_code not in {200, 201}:
            self._fail(created, "folder creation")
        return created.json()["id"]

    # -------------------------------------------------------------- upload

    async def upload(
        self, storage_key: str, chunks: AsyncIterator[bytes], *,
        filename: str, mime_type: str,
    ) -> StoredObject:
        """Stream the object through a resumable session in bounded blocks."""
        validate_storage_key(storage_key)
        parent = await self._folder(key_prefix(storage_key))
        session_url = await self._start_session(key_name(storage_key), parent, mime_type)
        uploaded, final = 0, None
        async for block in self._blocks(chunks):
            final = await self._put_block(session_url, block.payload, uploaded, block.last)
            uploaded += len(block.payload)
        if final is None:  # An empty stream still needs a zero-length object.
            final = await self._put_block(session_url, b"", 0, True)
        return self._stored(final, storage_key, filename, mime_type, uploaded)

    class _Block:
        __slots__ = ("payload", "last")

        def __init__(self, payload: bytes, last: bool) -> None:
            self.payload, self.last = payload, last

    async def _blocks(self, chunks: AsyncIterator[bytes]) -> AsyncIterator["GoogleDriveStorage._Block"]:
        """Regroup arbitrary inbound chunks into Drive-sized blocks.

        At most one block is buffered, so peak memory is the configured chunk
        size regardless of how large the uploaded file is.
        """
        buffer, pending = bytearray(), None
        async for chunk in chunks:
            buffer.extend(chunk)
            while len(buffer) >= self._chunk_bytes:
                block = bytes(buffer[:self._chunk_bytes])
                del buffer[:self._chunk_bytes]
                if pending is not None:
                    yield self._Block(pending, False)
                pending = block
        if pending is not None:
            yield self._Block(pending, not buffer)
        if buffer:
            yield self._Block(bytes(buffer), True)

    async def _start_session(self, name: str, parent_id: str, mime_type: str) -> str:
        response = await self._request(
            "POST", UPLOAD_URL,
            params={"uploadType": "resumable", "supportsAllDrives": "true", "fields": FILE_FIELDS},
            json={"name": name, "parents": [parent_id], "mimeType": mime_type},
            headers={"X-Upload-Content-Type": mime_type},
        )
        if response.status_code not in {200, 201}:
            self._fail(response, "upload session creation")
        if not (location := response.headers.get("Location")):
            self._fail(response, "upload session creation")
        return location

    async def _put_block(self, session_url: str, payload: bytes, offset: int, last: bool) -> dict | None:
        total = str(offset + len(payload)) if last else "*"
        end = offset + len(payload) - 1
        span = f"bytes {offset}-{end}/{total}" if payload else f"bytes */{total}"
        # The session URI is pre-authorized, but a long upload may outlive the
        # token it started with, so each block carries a freshly resolved one.
        headers = await self._headers({"Content-Range": span, "Content-Length": str(len(payload))})
        try:
            response = await self._client.put(session_url, content=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise StorageUnavailable("The storage provider could not be reached") from exc
        if response.status_code in {200, 201}:
            return response.json()
        # 308 means Drive accepted the block and wants the next one.
        if response.status_code != 308:
            self._fail(response, "upload")
        return None

    def _stored(self, payload: dict | None, key: str, filename: str, mime_type: str, size: int) -> StoredObject:
        if not payload or "id" not in payload:
            raise StorageUnavailable("Storage upload did not complete")
        return StoredObject(
            ref=ObjectRef(storage_key=key, provider_reference=payload["id"]),
            filename=filename, mime_type=payload.get("mimeType") or mime_type,
            size_bytes=int(payload.get("size") or size),
            checksum=payload.get("md5Checksum"),
        )

    # ------------------------------------------------------------- reading

    async def metadata(self, ref: ObjectRef) -> ObjectMetadata:
        response = await self._request("GET", f"{API_URL}/files/{ref.provider_reference}", params={
            "fields": FILE_FIELDS, "supportsAllDrives": "true",
        })
        if response.status_code == 404:
            raise ObjectNotFound(f"No object for key {ref.storage_key}")
        if response.status_code != 200:
            self._fail(response, "metadata read")
        payload = response.json()
        modified = payload.get("modifiedTime")
        return ObjectMetadata(
            ref=ref, filename=payload.get("name") or key_name(ref.storage_key),
            mime_type=payload.get("mimeType") or "application/octet-stream",
            size_bytes=int(payload.get("size") or 0), checksum=payload.get("md5Checksum"),
            modified_at=datetime.fromisoformat(modified.replace("Z", "+00:00")) if modified else None,
        )

    async def exists(self, ref: ObjectRef) -> bool:
        try:
            await self.metadata(ref)
        except ObjectNotFound:
            return False
        return True

    async def access(self, ref: ObjectRef) -> AccessGrant:
        """Drive issues no shareable URL for a private file, so we relay bytes.

        Returning ``STREAM`` keeps the folder private; a provider with signed
        URLs (S3, R2, B2) returns ``REDIRECT`` here instead and the API layer
        redirects without proxying.
        """
        return AccessGrant(kind=AccessKind.STREAM)

    async def open(self, ref: ObjectRef, byte_range: ByteRange | None = None) -> ObjectStream:
        headers = {}
        if byte_range is not None:
            end = "" if byte_range.end is None else str(byte_range.end)
            headers["Range"] = f"bytes={byte_range.start}-{end}"
        request = self._client.build_request(
            "GET", f"{API_URL}/files/{ref.provider_reference}",
            params={"alt": "media", "supportsAllDrives": "true"},
            headers=await self._headers(headers),
        )
        try:
            response = await self._client.send(request, stream=True)
        except httpx.HTTPError as exc:
            raise StorageUnavailable("The storage provider could not be reached") from exc
        if response.status_code not in {200, 206}:
            await response.aclose()
            if response.status_code == 404:
                raise ObjectNotFound(f"No object for key {ref.storage_key}")
            if response.status_code in {401, 403}:
                self._access_token = None
                raise StorageAuthError("Storage credentials were rejected")
            self._fail(response, "download")

        async def stream() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()

        length = response.headers.get("Content-Length")
        return ObjectStream(
            mime_type=response.headers.get("Content-Type", "application/octet-stream"),
            size_bytes=int(length) if length else None, chunks=stream(),
            content_range=response.headers.get("Content-Range"),
            partial=response.status_code == 206,
        )

    async def delete(self, ref: ObjectRef) -> None:
        response = await self._request("DELETE", f"{API_URL}/files/{ref.provider_reference}", params={
            "supportsAllDrives": "true",
        })
        if response.status_code in {200, 204, 404}:
            return
        self._fail(response, "delete")
