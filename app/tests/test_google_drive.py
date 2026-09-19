"""Google Drive adapter against a mocked Drive API.

No Google account, credential or network call is involved. The optional live
check at the end is opt-in and never runs in CI.
"""

import os
from uuid import uuid4

import httpx
import pytest

from app.core.config import Settings
from app.storage.exceptions import ObjectNotFound, StorageAuthError, StorageUnavailable
from app.storage.factory import create_storage
from app.storage.google_drive import CHUNK_MULTIPLE, GoogleDriveStorage
from app.storage.keys import build_storage_key
from app.storage.models import AccessKind, ByteRange, ObjectRef, StorageProvider

pytestmark = pytest.mark.anyio
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 128
SECRET = "client-secret-value"
REFRESH = "refresh-token-value"
ROOT = "root-folder-id"


class DriveDouble:
    """A minimal in-memory Drive: folders, resumable sessions and media reads."""

    def __init__(self, *, token_status: int = 200, fail: str | None = None) -> None:
        self.token_status, self.fail = token_status, fail
        self.folders: dict[tuple[str, str], str] = {}
        self.files: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.requests: list[tuple[str, str]] = []
        self.token_calls = 0

    def handler(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._route)

    def _route(self, request: httpx.Request) -> httpx.Response:
        url, method, path = str(request.url), request.method, request.url.path
        self.requests.append((method, url))
        if url.startswith("https://oauth2.googleapis.com/token"):
            self.token_calls += 1
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": f"access-{self.token_calls}", "expires_in": 3600})
        assert request.headers.get("Authorization", "").startswith("Bearer access-")
        if self.fail == "all":
            return httpx.Response(500, json={"error": "backend"})
        if path == "/upload/drive/v3/files":
            return self._start_session(request)
        if path.startswith("/upload-session/"):
            return self._put_block(request)
        if path == "/drive/v3/files":
            return self._search(request) if method == "GET" else self._create_folder(request)
        return self._file(request, method)

    def _search(self, request: httpx.Request) -> httpx.Response:
        query = request.url.params.get("q", "")
        name = query.split("name = '", 1)[1].split("'", 1)[0]
        parent = query.split("and '", 1)[1].split("'", 1)[0]
        found = self.folders.get((parent, name))
        return httpx.Response(200, json={"files": [{"id": found}] if found else []})

    def _create_folder(self, request: httpx.Request) -> httpx.Response:
        import json
        body = json.loads(request.content)
        folder_id = f"folder-{len(self.folders)}"
        self.folders[(body["parents"][0], body["name"])] = folder_id
        return httpx.Response(200, json={"id": folder_id})

    def _start_session(self, request: httpx.Request) -> httpx.Response:
        import json
        body = json.loads(request.content)
        session_id = f"session-{len(self.sessions)}"
        self.sessions[session_id] = {"name": body["name"], "parent": body["parents"][0],
                                     "mimeType": body["mimeType"], "data": bytearray()}
        return httpx.Response(200, headers={
            "Location": f"https://www.googleapis.com/upload-session/{session_id}",
        }, json={})

    def _put_block(self, request: httpx.Request) -> httpx.Response:
        session = self.sessions[request.url.path.rsplit("/", 1)[-1]]
        session["data"].extend(request.content)
        if request.headers["Content-Range"].endswith("/*"):
            return httpx.Response(308, json={})
        file_id = f"file-{len(self.files)}"
        self.files[file_id] = {**session, "data": bytes(session["data"])}
        return httpx.Response(200, json={
            "id": file_id, "name": session["name"], "mimeType": session["mimeType"],
            "size": str(len(session["data"])), "md5Checksum": "abc123",
            "modifiedTime": "2026-01-01T00:00:00Z",
        })

    def _file(self, request: httpx.Request, method: str) -> httpx.Response:
        file_id = request.url.path.split("/drive/v3/files/", 1)[1]
        record = self.files.get(file_id)
        if record is None:
            return httpx.Response(404, json={"error": "notFound"})
        if method == "DELETE":
            del self.files[file_id]
            return httpx.Response(204)
        if request.url.params.get("alt") == "media":
            data = record["data"]
            if (span := request.headers.get("Range")):
                start, _, end = span.removeprefix("bytes=").partition("-")
                lower, upper = int(start), int(end) if end else len(data) - 1
                window = data[lower:upper + 1]
                return httpx.Response(206, content=window, headers={
                    "Content-Type": record["mimeType"],
                    "Content-Range": f"bytes {lower}-{upper}/{len(data)}",
                })
            return httpx.Response(200, content=data, headers={"Content-Type": record["mimeType"]})
        return httpx.Response(200, json={
            "id": file_id, "name": record["name"], "mimeType": record["mimeType"],
            "size": str(len(record["data"])), "md5Checksum": "abc123",
            "modifiedTime": "2026-01-01T00:00:00Z",
        })


def build_adapter(drive: DriveDouble, *, chunk_bytes: int = CHUNK_MULTIPLE) -> GoogleDriveStorage:
    return GoogleDriveStorage(
        client_id="client-id", client_secret=SECRET, refresh_token=REFRESH,
        root_folder_id=ROOT, chunk_bytes=chunk_bytes, timeout_seconds=5,
        client=httpx.AsyncClient(transport=drive.handler()),
    )


async def chunks(payload: bytes, size: int):
    for offset in range(0, len(payload), size):
        yield payload[offset:offset + size]


async def test_round_trip_creates_a_deterministic_folder_tree() -> None:
    drive = DriveDouble()
    adapter = build_adapter(drive)
    course_id = uuid4()
    key = build_storage_key(course_id, "videos", "video/mp4")

    stored = await adapter.upload(key, chunks(MP4, 16), filename="lesson.mp4", mime_type="video/mp4")
    assert stored.storage_key == key and stored.size_bytes == len(MP4)
    assert stored.checksum == "abc123"
    # The opaque handle is Drive's file id; the caller never interprets it.
    assert stored.provider_reference in drive.files

    # courses/<course-id>/videos, rooted at the configured folder, by stable id.
    assert drive.folders[(ROOT, "courses")] == "folder-0"
    assert drive.folders[("folder-0", str(course_id))] == "folder-1"
    assert drive.folders[("folder-1", "videos")] == "folder-2"
    assert drive.files[stored.provider_reference]["parent"] == "folder-2"
    # The object name is the generated key's leaf, never the client filename.
    assert drive.files[stored.provider_reference]["name"].endswith(".mp4")
    assert "lesson.mp4" != drive.files[stored.provider_reference]["name"]

    metadata = await adapter.metadata(stored.ref)
    assert metadata.size_bytes == len(MP4) and metadata.mime_type == "video/mp4"
    assert await adapter.exists(stored.ref)

    stream = await adapter.open(stored.ref)
    assert b"".join([chunk async for chunk in stream.chunks]) == MP4

    partial = await adapter.open(stored.ref, ByteRange(start=4, end=7))
    assert b"".join([chunk async for chunk in partial.chunks]) == b"ftyp"
    assert partial.partial and partial.content_range == f"bytes 4-7/{len(MP4)}"

    await adapter.delete(stored.ref)
    assert not await adapter.exists(stored.ref)
    await adapter.delete(stored.ref)  # Deleting an absent object stays quiet.
    await adapter.aclose()


async def test_folder_tree_is_reused_not_recreated() -> None:
    drive = DriveDouble()
    adapter = build_adapter(drive)
    course_id = uuid4()
    for _ in range(3):
        await adapter.upload(build_storage_key(course_id, "videos", "video/mp4"),
                             chunks(MP4, 64), filename="a.mp4", mime_type="video/mp4")
    assert len(drive.folders) == 3  # courses, <course-id>, videos.
    lookups = [url for method, url in drive.requests
               if method == "GET" and "/drive/v3/files?" in url and "q=" in url]
    assert len(lookups) == 3  # Cached after the first resolution.
    await adapter.aclose()


async def test_large_uploads_are_sent_in_resumable_blocks() -> None:
    drive = DriveDouble()
    adapter = build_adapter(drive, chunk_bytes=CHUNK_MULTIPLE)
    payload = b"\x00\x00\x00\x18ftypmp42" + os.urandom(CHUNK_MULTIPLE * 2)
    stored = await adapter.upload(build_storage_key(uuid4(), "videos", "video/mp4"),
                                  chunks(payload, 8192), filename="big.mp4", mime_type="video/mp4")
    assert drive.files[stored.provider_reference]["data"] == payload
    ranges = [url for method, url in drive.requests if method == "PUT"]
    assert len(ranges) == 3  # Two full blocks plus the remainder.
    await adapter.aclose()


async def test_access_token_is_refreshed_once_and_reused() -> None:
    drive = DriveDouble()
    adapter = build_adapter(drive)
    ref_key = build_storage_key(uuid4(), "videos", "video/mp4")
    stored = await adapter.upload(ref_key, chunks(MP4, 64), filename="a.mp4", mime_type="video/mp4")
    await adapter.metadata(stored.ref)
    await adapter.metadata(stored.ref)
    assert drive.token_calls == 1
    await adapter.aclose()


async def test_rejected_credentials_surface_as_a_storage_outage() -> None:
    drive = DriveDouble(token_status=400)
    adapter = build_adapter(drive)
    with pytest.raises(StorageAuthError) as error:
        await adapter.metadata(ObjectRef("courses/a/videos/b.mp4", "file-0"))
    # StorageAuthError is a StorageUnavailable: never a client authorization error.
    assert isinstance(error.value, StorageUnavailable)
    assert SECRET not in str(error.value) and REFRESH not in str(error.value)
    await adapter.aclose()


async def test_provider_errors_do_not_leak_request_detail() -> None:
    drive = DriveDouble(fail="all")
    adapter = build_adapter(drive)
    with pytest.raises(StorageUnavailable) as error:
        await adapter.upload(build_storage_key(uuid4(), "videos", "video/mp4"),
                             chunks(MP4, 64), filename="a.mp4", mime_type="video/mp4")
    assert SECRET not in str(error.value) and ROOT not in str(error.value)
    await adapter.aclose()


async def test_unknown_objects_raise_object_not_found() -> None:
    drive = DriveDouble()
    adapter = build_adapter(drive)
    missing = ObjectRef("courses/a/videos/b.mp4", "file-does-not-exist")
    with pytest.raises(ObjectNotFound):
        await adapter.metadata(missing)
    with pytest.raises(ObjectNotFound):
        await adapter.open(missing)
    assert not await adapter.exists(missing)
    await adapter.aclose()


async def test_drive_relays_bytes_rather_than_sharing_the_folder() -> None:
    """Drive has no signed URL for a private file, so the grant is STREAM."""
    adapter = build_adapter(DriveDouble())
    grant = await adapter.access(ObjectRef("courses/a/videos/b.mp4", "file-0"))
    assert grant.kind == AccessKind.STREAM and grant.url is None
    await adapter.aclose()


def test_factory_builds_the_drive_adapter_from_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in [("STORAGE_PROVIDER", "google_drive"), ("GOOGLE_DRIVE_CLIENT_ID", "client"),
                        ("GOOGLE_DRIVE_CLIENT_SECRET", SECRET),
                        ("GOOGLE_DRIVE_REFRESH_TOKEN", REFRESH),
                        ("GOOGLE_DRIVE_ROOT_FOLDER_ID", ROOT)]:
        monkeypatch.setenv(name, value)
    settings = Settings(_env_file=None, environment="test")
    storage = create_storage(settings)
    assert isinstance(storage, GoogleDriveStorage)
    assert storage.provider == StorageProvider.GOOGLE_DRIVE
    # Credentials stay inside the adapter and out of any representation.
    assert SECRET not in repr(settings) and REFRESH not in repr(settings)


@pytest.mark.parametrize("missing", ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET",
                                     "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_DRIVE_ROOT_FOLDER_ID"])
def test_drive_configuration_is_validated_at_startup(monkeypatch: pytest.MonkeyPatch, missing: str) -> None:
    from pydantic import ValidationError

    for name, value in [("STORAGE_PROVIDER", "google_drive"), ("GOOGLE_DRIVE_CLIENT_ID", "client"),
                        ("GOOGLE_DRIVE_CLIENT_SECRET", SECRET),
                        ("GOOGLE_DRIVE_REFRESH_TOKEN", REFRESH),
                        ("GOOGLE_DRIVE_ROOT_FOLDER_ID", ROOT)]:
        if name != missing:
            monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, environment="test")
    assert missing in str(error.value) and SECRET not in str(error.value)


def test_memory_provider_is_refused_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import ValidationError

    monkeypatch.setenv("STORAGE_PROVIDER", "memory")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production")


@pytest.mark.integration
@pytest.mark.skipif(not os.environ.get("TEST_GOOGLE_DRIVE"),
                    reason="Set TEST_GOOGLE_DRIVE=1 with real Drive credentials to run this.")
async def test_live_google_drive_round_trip() -> None:
    """Opt-in smoke test against a real Drive folder. Never part of CI."""
    settings = Settings(_env_file=None)
    adapter = create_storage(settings)
    key = build_storage_key(uuid4(), "documents", "application/pdf")
    stored = await adapter.upload(key, chunks(b"%PDF-1.7\n" + b"0" * 1024, 512),
                                  filename="integration.pdf", mime_type="application/pdf")
    try:
        assert (await adapter.metadata(stored.ref)).size_bytes == stored.size_bytes
        stream = await adapter.open(stored.ref)
        assert b"".join([chunk async for chunk in stream.chunks]).startswith(b"%PDF-")
    finally:
        await adapter.delete(stored.ref)
        await adapter.aclose()
