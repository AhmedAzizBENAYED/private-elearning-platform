"""Lesson resource use cases end to end, against a fake storage adapter.

No test here needs Google credentials: the application depends on the storage
port, so the suite substitutes an in-memory adapter and still exercises the real
routers, services, repositories and database constraints.
"""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, StatementError

from app.models.resource import LessonResource
from app.services.media_probe import PROBE_WINDOW_BYTES
from app.storage.exceptions import ObjectNotFound, StorageUnavailable
from app.storage.memory import InMemoryStorage
from app.storage.models import ObjectRef, StorageProvider
from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_members import admin_headers
from app.tests.test_courses import create_course, create_module, create_lesson, member_headers, enforce_foreign_keys
from app.tests.test_enrollments import enroll

pytestmark = pytest.mark.anyio
ADMIN = "/api/v1/admin"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 512
PDF = b"%PDF-1.7\n" + b"0" * 512
RESOURCE_FIELDS = {"resource_id", "lesson_id", "storage_provider", "storage_key", "filename",
                   "mime_type", "size_bytes", "checksum", "duration_seconds",
                   "created_at", "updated_at"}
MEMBER_FIELDS = {"lesson_id", "resource_id", "content_type", "filename", "mime_type",
                 "size_bytes", "duration_seconds", "download_url"}


class FailingStorage(InMemoryStorage):
    """In-memory storage whose chosen operation reports a provider outage."""

    def __init__(self, *failing: str) -> None:
        super().__init__()
        self.failing = set(failing)
        self.deleted: list[str] = []

    async def upload(self, storage_key, chunks, *, filename, mime_type):
        if "upload" in self.failing:
            # Drain the stream the way a real adapter would before failing.
            async for _ in chunks:
                pass
            raise StorageUnavailable("private-provider-detail")
        return await super().upload(storage_key, chunks, filename=filename, mime_type=mime_type)

    async def delete(self, ref: ObjectRef) -> None:
        self.deleted.append(ref.storage_key)
        if "delete" in self.failing:
            raise StorageUnavailable("private-provider-detail")
        await super().delete(ref)

    async def open(self, ref, byte_range=None):
        if "open" in self.failing:
            raise ObjectNotFound("private-provider-detail")
        return await super().open(ref, byte_range)


@pytest.fixture
def storage(application) -> InMemoryStorage:
    application.state.storage = InMemoryStorage()
    return application.state.storage


async def build_lesson(client: AsyncClient, headers: dict[str, str], *, content_type: str = "VIDEO",
                       duration: int | None = 100, publish: bool = False) -> dict:
    course = await create_course(client, headers, title="Storage " + uuid4().hex)
    module = await create_module(client, headers, course["id"])
    lesson = await create_lesson(
        client, headers, module["id"], position=1, content_type=content_type,
        content={"VIDEO": "storage://videos/pending", "DOCUMENT": "storage://documents/pending",
                 "LINK": "https://example.com/resource"}.get(content_type, "Welcome!"),
        **({"duration_seconds": duration} if content_type == "VIDEO" else {}),
    )
    if publish:
        assert (await client.post(f"{ADMIN}/courses/{course['id']}/publish", headers=headers)).status_code == 200
    return {"course": course, "lesson": lesson}


async def upload(client: AsyncClient, headers: dict[str, str], lesson_id: str, *,
                 payload: bytes = MP4, filename: str = "lesson-01.mp4", mime: str = "video/mp4"):
    return await client.put(f"{ADMIN}/lessons/{lesson_id}/resource", headers=headers,
                            files={"file": (filename, payload, mime)})


# ------------------------------------------------------------ authorization

@pytest.mark.parametrize("method,path", [
    ("PUT", ADMIN + "/lessons/{id}/resource"), ("GET", ADMIN + "/lessons/{id}/resource"),
    ("DELETE", ADMIN + "/lessons/{id}/resource"), ("GET", "/api/v1/lessons/{id}/resource"),
    ("GET", "/api/v1/lessons/{id}/resource/content"),
])
async def test_resource_routes_require_authentication(auth_client, method, path):
    response = await auth_client.request(method, path.replace("{id}", str(uuid4())),
                                         files={"file": ("a.mp4", MP4, "video/mp4")} if method == "PUT" else None)
    assert response.status_code == 401


@pytest.mark.parametrize("method", ["PUT", "GET", "DELETE"])
async def test_resource_management_requires_admin(auth_client, storage, admin_headers, member_headers, method):
    data = await build_lesson(auth_client, admin_headers)
    path = f"{ADMIN}/lessons/{data['lesson']['id']}/resource"
    response = await auth_client.request(method, path, headers=member_headers,
                                         files={"file": ("a.mp4", MP4, "video/mp4")} if method == "PUT" else None)
    assert response.status_code == 403


# ------------------------------------------------------------------ upload

async def test_upload_stores_metadata_without_provider_details(auth_client, auth_session, storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = data["lesson"]["id"]
    response = await upload(auth_client, admin_headers, lesson_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == RESOURCE_FIELDS
    assert body["lesson_id"] == lesson_id
    assert body["filename"] == "lesson-01.mp4" and body["mime_type"] == "video/mp4"
    assert body["size_bytes"] == len(MP4) and body["duration_seconds"] == 100
    assert body["storage_provider"] == StorageProvider.MEMORY.value
    # The key is generated from the course id, never from the uploaded filename.
    assert body["storage_key"].startswith(f"courses/{data['course']['id']}/videos/")
    assert "lesson-01" not in body["storage_key"]
    # The opaque provider handle is never published.
    assert "provider_reference" not in body
    stored = await auth_session.scalar(select(LessonResource))
    assert stored.provider_reference not in response.text
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 1
    assert (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}/resource",
                                  headers=admin_headers)).json() == body


async def test_document_lesson_accepts_a_pdf(auth_client, storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers, content_type="DOCUMENT", duration=None)
    response = await upload(auth_client, admin_headers, data["lesson"]["id"],
                            payload=PDF, filename="handbook.pdf", mime="application/pdf")
    assert response.status_code == 200, response.text
    assert response.json()["storage_key"].startswith(f"courses/{data['course']['id']}/documents/")
    assert response.json()["duration_seconds"] is None


@pytest.mark.parametrize("content_type", ["LINK", "TEXT"])
async def test_link_and_text_lessons_hold_no_stored_file(auth_client, auth_session, storage, admin_headers, content_type):
    data = await build_lesson(auth_client, admin_headers, content_type=content_type, duration=None)
    lesson_id = data["lesson"]["id"]
    assert (await upload(auth_client, admin_headers, lesson_id)).status_code == 409
    assert (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)).status_code == 404
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0


@pytest.mark.parametrize("payload,filename,mime,expected", [
    (MP4, "lesson.mp4", "application/x-msdownload", 415),
    (MP4, "lesson.mp4", "application/pdf", 415),
    (MP4, "lesson.pdf", "video/mp4", 422),
    (b"MZ\x90\x00 not a video at all", "lesson.mp4", "video/mp4", 422),
    (b"", "lesson.mp4", "video/mp4", 422),
    (MP4, "../escape.mp4", "video/mp4", 422),
])
async def test_invalid_uploads_are_rejected(auth_client, auth_session, storage, admin_headers,
                                            payload, filename, mime, expected):
    data = await build_lesson(auth_client, admin_headers)
    response = await upload(auth_client, admin_headers, data["lesson"]["id"],
                            payload=payload, filename=filename, mime=mime)
    assert response.status_code == expected, response.text
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0


async def test_upload_size_limit_is_enforced_on_received_bytes(auth_client, auth_session, application,
                                                               storage, admin_headers):
    application.state.settings = application.state.settings.model_copy(
        update={"storage_max_upload_bytes": 256}
    )
    data = await build_lesson(auth_client, admin_headers)
    response = await upload(auth_client, admin_headers, data["lesson"]["id"], payload=MP4)
    assert response.status_code == 413
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0
    assert (await upload(auth_client, admin_headers, data["lesson"]["id"],
                         payload=MP4[:200])).status_code == 200


@pytest.mark.parametrize("status", ["PUBLISHED", "ARCHIVED"])
async def test_only_draft_courses_accept_resource_changes(auth_client, storage, admin_headers, status):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    assert (await upload(auth_client, admin_headers, lesson_id)).status_code == 200
    assert (await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)).status_code == 200
    if status == "ARCHIVED":
        assert (await auth_client.post(f"{ADMIN}/courses/{course_id}/archive", headers=admin_headers)).status_code == 200
    assert (await upload(auth_client, admin_headers, lesson_id)).status_code == 409
    assert (await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)).status_code == 409
    # Reading published metadata stays available to administrators.
    assert (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)).status_code == 200


# ------------------------------------------------------------- replacement

async def test_replacement_keeps_one_resource_and_removes_the_old_object(auth_client, auth_session,
                                                                         storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = data["lesson"]["id"]
    first = (await upload(auth_client, admin_headers, lesson_id)).json()
    second = (await upload(auth_client, admin_headers, lesson_id,
                           payload=MP4 + b"more", filename="lesson-02.mp4")).json()

    assert second["resource_id"] == first["resource_id"]  # Same row, new object.
    assert second["storage_key"] != first["storage_key"]
    assert second["filename"] == "lesson-02.mp4" and second["size_bytes"] == len(MP4) + 4
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 1
    resource = await auth_session.scalar(select(LessonResource))
    assert await storage.exists(ObjectRef(resource.storage_key, resource.provider_reference))
    # Exactly one object survives: the replaced one was removed after the commit.
    assert len(storage._objects) == 1


async def test_failed_replacement_keeps_the_existing_resource(auth_client, auth_session, application, admin_headers):
    application.state.storage = InMemoryStorage()
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = data["lesson"]["id"]
    original = (await upload(auth_client, admin_headers, lesson_id)).json()

    failing = FailingStorage("upload")
    application.state.storage = failing
    assert (await upload(auth_client, admin_headers, lesson_id)).status_code == 503
    assert failing.deleted == []  # Nothing was removed on behalf of a failed upload.

    current = (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)).json()
    assert current == original
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 1


async def test_upload_failure_hides_provider_detail(auth_client, application, admin_headers):
    application.state.storage = FailingStorage("upload")
    data = await build_lesson(auth_client, admin_headers)
    response = await upload(auth_client, admin_headers, data["lesson"]["id"])
    assert response.status_code == 503 and "private-provider-detail" not in response.text


async def test_metadata_failure_discards_the_uploaded_object(auth_client, auth_session, storage,
                                                             admin_headers, monkeypatch):
    from app.repositories.resource_repository import LessonResourceRepository

    data = await build_lesson(auth_client, admin_headers)

    async def failing_save(self, resource):
        raise IntegrityError("private-sql", {}, Exception("private-error"))

    monkeypatch.setattr(LessonResourceRepository, "save", failing_save)
    response = await upload(auth_client, admin_headers, data["lesson"]["id"])
    assert response.status_code == 409 and "private-" not in response.text
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0
    # The bytes uploaded before the failed commit were cleaned up, not orphaned.
    assert storage._objects == {}


# ------------------------------------------------------------------ delete

async def test_delete_removes_metadata_and_object(auth_client, auth_session, storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = data["lesson"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    response = await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)
    assert response.status_code == 204
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0
    assert storage._objects == {}
    assert (await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)).status_code == 404


async def test_delete_survives_a_storage_outage_and_keeps_the_database_clean(auth_client, auth_session,
                                                                            application, admin_headers):
    application.state.storage = FailingStorage()
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = data["lesson"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    application.state.storage.failing = {"delete"}

    response = await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)
    # The database is the source of truth; an unreachable provider leaves a
    # logged orphan rather than a lesson pointing at bytes it cannot manage.
    assert response.status_code == 204
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0


async def test_lesson_deletion_is_blocked_while_a_resource_exists(auth_client, auth_session, storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = data["lesson"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    # RESTRICT, not CASCADE: removing the lesson first would orphan the object.
    assert (await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).status_code == 409
    assert (await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}/resource", headers=admin_headers)).status_code == 204
    assert (await auth_client.delete(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).status_code == 204
    assert await auth_session.scalar(select(func.count()).select_from(LessonResource)) == 0


# ------------------------------------------------------------ member access

async def test_member_access_requires_enrollment(auth_client, storage, admin_headers, member_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    assert (await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)).status_code == 200

    for path in (f"/api/v1/lessons/{lesson_id}/resource", f"/api/v1/lessons/{lesson_id}/resource/content"):
        assert (await auth_client.get(path, headers=member_headers)).status_code == 404
    await enroll(auth_client, member_headers, course_id)

    response = await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=member_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == MEMBER_FIELDS
    assert body["download_url"].startswith(
        f"/api/v1/lessons/{lesson_id}/resource/content?playback_token=")
    assert body["duration_seconds"] == 100 and body["content_type"] == "VIDEO"
    assert response.headers["cache-control"] == "no-store"


async def test_member_response_leaks_no_provider_information(auth_client, storage, admin_headers, member_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)
    from app.tests.test_auth import EMAIL, PASSWORD

    tokens = (await auth_client.post("/api/v1/auth/login",
                                     json={"email": EMAIL, "password": PASSWORD})).json()
    text = (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=member_headers)).text
    for leaked in ("google", "drive", "storage_key", "provider_reference", "secret"):
        assert leaked not in text.lower()
    # Only the lesson-scoped playback token may appear; never a session token.
    assert "playback_token=" in text
    assert tokens["access_token"] not in text and tokens["refresh_token"] not in text
    assert "refresh_token" not in text and "access_token" not in text


async def test_member_streams_content_with_range_support(auth_client, storage, admin_headers, member_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)
    path = f"/api/v1/lessons/{lesson_id}/resource/content"

    full = await auth_client.get(path, headers=member_headers)
    assert full.status_code == 200 and full.content == MP4
    assert full.headers["content-type"].startswith("video/mp4")
    assert full.headers["accept-ranges"] == "bytes"
    assert full.headers["cache-control"] == "no-store"
    assert "lesson-01.mp4" in full.headers["content-disposition"]

    partial = await auth_client.get(path, headers={**member_headers, "Range": "bytes=4-7"})
    assert partial.status_code == 206 and partial.content == b"ftyp"
    assert partial.headers["content-range"] == f"bytes 4-7/{len(MP4)}"

    # A malformed range is a full read, not an error.
    assert (await auth_client.get(path, headers={**member_headers, "Range": "rows=1-2"})).status_code == 200


async def test_member_access_survives_archiving_but_missing_objects_are_reported(auth_client, application,
                                                                                admin_headers, member_headers):
    application.state.storage = FailingStorage()
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)
    assert (await auth_client.post(f"{ADMIN}/courses/{course_id}/archive", headers=admin_headers)).status_code == 200

    # Ticket 6's rule holds: an enrolled member keeps access to archived content.
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=member_headers)).status_code == 200
    application.state.storage.failing = {"open"}
    response = await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource/content", headers=member_headers)
    assert response.status_code == 404 and "private-provider-detail" not in response.text


async def test_member_cannot_read_another_members_lesson_file(auth_client, storage, admin_headers, member_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, admin_headers, course_id)
    # The admin's enrollment grants the admin access, never the member.
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=admin_headers)).status_code == 200
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=member_headers)).status_code == 404


async def test_redirecting_providers_are_not_proxied(auth_client, application, admin_headers, member_headers):
    """A provider that signs URLs redirects instead of relaying bytes."""
    from datetime import datetime, timedelta, timezone

    from app.storage.models import AccessGrant, AccessKind

    class RedirectingStorage(InMemoryStorage):
        async def access(self, ref):
            return AccessGrant(kind=AccessKind.REDIRECT, url="https://cdn.example.com/signed",
                               expires_at=datetime.now(timezone.utc) + timedelta(minutes=5))

        async def open(self, ref, byte_range=None):
            raise AssertionError("A redirecting provider must not stream through the API")

    application.state.storage = RedirectingStorage()
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)

    response = await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource/content",
                                     headers=member_headers, follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "https://cdn.example.com/signed"
    # The client contract is unchanged: the same API path serves both providers.
    member = (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=member_headers)).json()
    assert member["download_url"].startswith(
        f"/api/v1/lessons/{lesson_id}/resource/content?playback_token=")


async def test_course_resources_are_listed_without_n_plus_one(auth_client, auth_session, storage, admin_headers):
    from sqlalchemy import event

    course = await create_course(auth_client, admin_headers, title="Bundle " + uuid4().hex)
    lessons = []
    for position in (1, 2):
        module = await create_module(auth_client, admin_headers, course["id"], position=position)
        for index, kind in enumerate(("VIDEO", "DOCUMENT")):
            lesson = await create_lesson(
                auth_client, admin_headers, module["id"], position=index + 1, content_type=kind,
                content="storage://pending", **({"duration_seconds": 100} if kind == "VIDEO" else {}),
            )
            lessons.append(lesson)
            if kind == "VIDEO":
                await upload(auth_client, admin_headers, lesson["id"])
            else:
                await upload(auth_client, admin_headers, lesson["id"], payload=PDF,
                             filename="doc.pdf", mime="application/pdf")

    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await auth_client.get(f"{ADMIN}/courses/{course['id']}/resources", headers=admin_headers)
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert len(response.json()) == 4
    assert len(statements) <= 3  # Current user, course existence, one aggregate read.
    assert all(set(item) == RESOURCE_FIELDS for item in response.json())


# -------------------------------------------------------- database and ids

async def test_one_resource_per_lesson_is_enforced_by_the_database(auth_client, auth_session, storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id = UUID(data["lesson"]["id"])
    await upload(auth_client, admin_headers, str(lesson_id))
    duplicate = LessonResource(
        lesson_id=lesson_id, storage_provider=StorageProvider.MEMORY,
        storage_key="courses/x/videos/y.mp4", provider_reference="other",
        original_filename="second.mp4", mime_type="video/mp4", file_size_bytes=10,
    )
    with pytest.raises(IntegrityError):
        async with auth_session.begin_nested():
            auth_session.add(duplicate)
            await auth_session.flush()


async def test_provider_is_stored_as_its_lowercase_value(auth_client, auth_session, storage, admin_headers):
    """The column holds the member value, matching the migration's CHECK list."""
    data = await build_lesson(auth_client, admin_headers)
    await upload(auth_client, admin_headers, data["lesson"]["id"])
    stored = await auth_session.scalar(text("SELECT storage_provider FROM lesson_resources"))
    assert stored == "memory"  # Not "MEMORY": the enum name would fail the CHECK.


@pytest.mark.parametrize("provider", ["MEMORY", "google-drive", "s3"])
async def test_unknown_provider_values_are_rejected(auth_client, auth_session, storage, admin_headers, provider):
    data = await build_lesson(auth_client, admin_headers)
    with pytest.raises((IntegrityError, StatementError)):
        async with auth_session.begin_nested():
            await auth_session.execute(text(
                "INSERT INTO lesson_resources (id, lesson_id, storage_provider, storage_key,"
                " provider_reference, original_filename, mime_type, file_size_bytes)"
                " VALUES (:id, :lesson, :provider, 'courses/x/videos/y.mp4', 'ref',"
                " 'a.mp4', 'video/mp4', 10)"
            ), {"id": str(uuid4()), "lesson": data["lesson"]["id"], "provider": provider})


@pytest.mark.parametrize("case", ["lesson_fk", "size", "filename", "mime_type", "duration"])
async def test_resource_database_invariants(auth_client, auth_session, storage, admin_headers, case):
    data = await build_lesson(auth_client, admin_headers)
    record = LessonResource(
        lesson_id=uuid4() if case == "lesson_fk" else UUID(data["lesson"]["id"]),
        storage_provider=StorageProvider.MEMORY, storage_key="courses/x/videos/y.mp4",
        provider_reference="reference",
        original_filename="  " if case == "filename" else "lesson.mp4",
        mime_type="  " if case == "mime_type" else "video/mp4",
        file_size_bytes=0 if case == "size" else 10,
        duration_seconds=0 if case == "duration" else None,
    )
    with pytest.raises(IntegrityError):
        async with auth_session.begin_nested():
            auth_session.add(record)
            await auth_session.flush()


@pytest.mark.parametrize("identifier,expected", [(str(uuid4()), 404), ("not-a-uuid", 422)])
async def test_unknown_and_malformed_lesson_ids(auth_client, storage, admin_headers, member_headers,
                                                identifier, expected):
    assert (await auth_client.get(f"{ADMIN}/lessons/{identifier}/resource",
                                  headers=admin_headers)).status_code == expected
    assert (await auth_client.delete(f"{ADMIN}/lessons/{identifier}/resource",
                                     headers=admin_headers)).status_code == expected
    assert (await auth_client.get(f"/api/v1/lessons/{identifier}/resource",
                                  headers=member_headers)).status_code == expected
    assert (await upload(auth_client, admin_headers, identifier)).status_code == expected


async def test_progress_is_unaffected_by_storage(auth_client, storage, admin_headers, member_headers):
    """The video progress domain keeps using Lesson.duration_seconds, not storage."""
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)
    response = await auth_client.put(f"/api/v1/lessons/{lesson_id}/progress", headers=member_headers,
                                     json={"watched_seconds": 100})
    assert response.status_code == 200 and response.json()["completed"] is True
    assert response.json()["duration_seconds"] == 100
    course_progress = await auth_client.get(f"/api/v1/courses/{course_id}/progress", headers=member_headers)
    assert course_progress.json()["progress_percent"] == 100


# ------------------------------------------------------- duration reconciliation

def _box(box_type: bytes, body: bytes) -> bytes:
    return (len(body) + 8).to_bytes(4, "big") + box_type + body


_FTYP = _box(b"ftyp", b"mp42" + b"\x00" * 4 + b"mp42isom")


def _mvhd(seconds: int, timescale: int = 1000) -> bytes:
    return _box(b"mvhd", b"\x00" * 4 + b"\x00" * 8
                + timescale.to_bytes(4, "big")
                + (seconds * timescale).to_bytes(4, "big") + b"\x00" * 80)


def faststart_mp4(seconds: int) -> bytes:
    """A probeable MP4: moov before the media, as a faststart encode writes it."""
    return _FTYP + _box(b"moov", _mvhd(seconds)) + _box(b"mdat", b"\x00" * 64)


# Large enough that `moov` lands beyond the head window, which is what makes the
# ranged-read fallback the thing under test rather than the head probe.
TRAILING_MEDIA_BYTES = PROBE_WINDOW_BYTES + 4096


def trailing_moov_mp4(seconds: int, media_bytes: int = TRAILING_MEDIA_BYTES) -> bytes:
    """The layout the real test video uses: moov after a large mdat."""
    return _FTYP + _box(b"mdat", b"\x00" * media_bytes) + _box(b"moov", _mvhd(seconds))


async def test_detected_duration_overrides_a_wrong_authored_value(auth_client, auth_session,
                                                                  storage, admin_headers, caplog):
    """The FE-08 bug: 120 s was typed in, the real video is 27 s."""
    data = await build_lesson(auth_client, admin_headers, duration=120)
    lesson_id = data["lesson"]["id"]

    with caplog.at_level("WARNING"):
        body = (await upload(auth_client, admin_headers, lesson_id,
                             payload=faststart_mp4(27))).json()

    assert body["duration_seconds"] == 27
    lesson = (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).json()
    assert lesson["duration_seconds"] == 27
    stored = await auth_session.scalar(select(LessonResource))
    assert stored.duration_seconds == 27
    assert any("reconciled" in record.message for record in caplog.records)


async def test_a_matching_duration_is_left_alone_and_logs_nothing(auth_client, storage,
                                                                  admin_headers, caplog):
    data = await build_lesson(auth_client, admin_headers, duration=27)
    with caplog.at_level("WARNING"):
        body = (await upload(auth_client, admin_headers, data["lesson"]["id"],
                             payload=faststart_mp4(27))).json()

    assert body["duration_seconds"] == 27
    assert not [record for record in caplog.records if "reconciled" in record.message]


async def test_an_unprobeable_upload_keeps_the_authored_duration(auth_client, auth_session,
                                                                 storage, admin_headers):
    """The existing stub MP4 has no moov; the upload must still succeed."""
    data = await build_lesson(auth_client, admin_headers, duration=120)
    lesson_id = data["lesson"]["id"]

    body = (await upload(auth_client, admin_headers, lesson_id, payload=MP4)).json()

    assert body["duration_seconds"] == 120
    lesson = (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).json()
    assert lesson["duration_seconds"] == 120


async def test_a_lesson_with_no_authored_duration_takes_the_detected_one(auth_client, auth_session,
                                                                         storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers, duration=None)
    lesson_id = data["lesson"]["id"]

    body = (await upload(auth_client, admin_headers, lesson_id, payload=faststart_mp4(42))).json()

    assert body["duration_seconds"] == 42
    lesson = (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).json()
    assert lesson["duration_seconds"] == 42


async def test_neither_authored_nor_detected_leaves_the_duration_unset(auth_client, auth_session,
                                                                       storage, admin_headers):
    data = await build_lesson(auth_client, admin_headers, duration=None)
    lesson_id = data["lesson"]["id"]

    body = (await upload(auth_client, admin_headers, lesson_id, payload=MP4)).json()

    assert body["duration_seconds"] is None
    lesson = (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).json()
    assert lesson["duration_seconds"] is None
    stored = await auth_session.scalar(select(LessonResource))
    assert stored.duration_seconds is None


async def test_a_trailing_moov_is_found_without_downloading_the_file(auth_client, storage,
                                                                     admin_headers):
    """A non-faststart MP4: moov sits past the head window, after the media.

    This is the layout of the real test video, and the head probe cannot see it;
    the duration has to come from the bounded ranged reads instead.
    """
    payload = trailing_moov_mp4(27)
    assert len(payload) > PROBE_WINDOW_BYTES
    data = await build_lesson(auth_client, admin_headers, duration=120)

    body = (await upload(auth_client, admin_headers, data["lesson"]["id"],
                         payload=payload)).json()

    assert body["duration_seconds"] == 27


async def test_a_document_upload_never_runs_the_video_probe(auth_client, auth_session, storage,
                                                            admin_headers, monkeypatch):
    from app.services import resource_service

    calls: list[int] = []
    original = resource_service.probe_mp4_duration
    monkeypatch.setattr(resource_service, "probe_mp4_duration",
                        lambda head: calls.append(len(head)) or original(head))

    data = await build_lesson(auth_client, admin_headers, content_type="DOCUMENT", duration=None)
    body = (await upload(auth_client, admin_headers, data["lesson"]["id"],
                         payload=PDF, filename="handbook.pdf", mime="application/pdf")).json()

    assert body["duration_seconds"] is None
    assert calls == []


async def test_replacing_a_video_reconciles_the_duration_again(auth_client, auth_session,
                                                               storage, admin_headers):
    """The FE-08 regression: a shorter replacement must move the lesson with it."""
    data = await build_lesson(auth_client, admin_headers, duration=120)
    lesson_id = data["lesson"]["id"]

    first = (await upload(auth_client, admin_headers, lesson_id,
                          payload=faststart_mp4(120), filename="long.mp4")).json()
    assert first["duration_seconds"] == 120

    second = (await upload(auth_client, admin_headers, lesson_id,
                           payload=faststart_mp4(27), filename="short.mp4")).json()

    assert second["duration_seconds"] == 27
    lesson = (await auth_client.get(f"{ADMIN}/lessons/{lesson_id}", headers=admin_headers)).json()
    assert lesson["duration_seconds"] == 27


async def test_a_probe_failure_never_fails_the_upload(auth_client, storage, admin_headers, monkeypatch):
    from app.services import resource_service

    def exploding(head: bytes):
        raise RuntimeError("private-probe-detail")

    monkeypatch.setattr(resource_service, "probe_mp4_duration", exploding)
    data = await build_lesson(auth_client, admin_headers, duration=120)

    response = await upload(auth_client, admin_headers, data["lesson"]["id"],
                            payload=faststart_mp4(27))

    assert response.status_code == 200, response.text
    assert response.json()["duration_seconds"] == 120
    assert "private-probe-detail" not in response.text


async def test_a_storage_read_failure_during_probing_never_fails_the_upload(auth_client, application,
                                                                            admin_headers):
    """The trailing-moov fallback reads the object again; an outage is not fatal."""
    application.state.storage = FailingStorage("open")
    data = await build_lesson(auth_client, admin_headers, duration=120)

    response = await upload(auth_client, admin_headers, data["lesson"]["id"],
                            payload=trailing_moov_mp4(27))

    assert response.status_code == 200, response.text
    assert response.json()["duration_seconds"] == 120


async def test_the_corrected_duration_makes_the_lesson_completable(auth_client, storage,
                                                                   admin_headers, member_headers):
    """End to end: the FE-08 bug, fixed, through the unchanged progress API."""
    data = await build_lesson(auth_client, admin_headers, duration=120)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]

    await upload(auth_client, admin_headers, lesson_id, payload=faststart_mp4(27))
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)

    response = await auth_client.put(f"/api/v1/lessons/{lesson_id}/progress",
                                     headers=member_headers, json={"watched_seconds": 27})

    body = response.json()
    assert response.status_code == 200, response.text
    assert body["duration_seconds"] == 27
    assert body["watched_seconds"] == 27
    assert body["completed"] is True
    assert body["completed_at"] is not None

    course_progress = (await auth_client.get(f"/api/v1/courses/{course_id}/progress",
                                             headers=member_headers)).json()
    assert course_progress["completed_video_lessons"] == 1
    assert course_progress["progress_percent"] == 100
    assert course_progress["completed"] is True

    enrollment = (await auth_client.get(f"/api/v1/courses/{course_id}/enrollment",
                                        headers=member_headers)).json()
    assert enrollment["completed_at"] is not None
