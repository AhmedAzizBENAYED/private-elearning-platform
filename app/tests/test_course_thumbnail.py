"""BE-THUMBNAIL-UPLOAD-01: ``PUT /admin/courses/{id}/thumbnail``.

Real requests through the real routers, services, repositories and database
constraints; only the storage provider is the in-memory adapter, wrapped so a
test can see every object written and deleted, and make one operation fail.

Every refusal starts from a course that already has an uploaded thumbnail, so
"nothing changed" is checked against something worth losing.
"""

import base64
import logging
import re
import struct
import zlib
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course
from app.models.user import User
from app.services.image_rules import THUMBNAIL_MAX_BYTES
from app.storage.exceptions import StorageUnavailable
from app.storage.memory import InMemoryStorage
from app.storage.models import ObjectRef, StorageProvider
from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_courses import COURSES, create_course, enforce_foreign_keys, member_headers
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

COURSE_FIELDS = {"id", "title", "slug", "description", "thumbnail_url", "status", "published_at",
                 "created_by", "created_at", "updated_at", "archived_at"}
EXTERNAL = "https://cdn.example.org/python.jpg"

# Encoded by an image library (Pillow) once, and frozen here: real files, not
# bytes shaped to please the validator.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGUlEQVR4nGP8f4IBK2CU8srGKsGEXT1VJQBu2wKheOwmUQAAAABJRU5ErkJggg==")
PNG_RGBA = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAYAAABbNsX4AAAADElEQVR4nGNgoAgAAAA/AAEc1neRAAAAAElFTkSuQmCC")
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8t"
    "MC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAAR"
    "CAAGAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEG"
    "E1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG"
    "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEB"
    "AQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk"
    "NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0"
    "tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDz7/hJNd/6DWp/+BUn+NFFFen9Sw3/AD7j"
    "9yPF9vV/mf3n/9k=")
JPEG_PROGRESSIVE = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8t"
    "MC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgAR"
    "CAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUAQEAAAAAAAAAAAAAAAAAAAAE/9oADAMBAAIQAxAAAAGeCRf/xAAW"
    "EAADAAAAAAAAAAAAAAAAAAAAAxT/2gAIAQEAAQUCpef/xAAXEQADAQAAAAAAAAAAAAAAAAAAAhJR/9oACAEDAQE/AbbT/8QAGBEAAgMAAAAA"
    "AAAAAAAAAAAAAAEDE1L/2gAIAQIBAT8Bpjyj/8QAGBAAAgMAAAAAAAAAAAAAAAAAAAEDM5L/2gAIAQEABj8Cuk0z/8QAFBABAAAAAAAAAAAA"
    "AAAAAAAAAP/aAAgBAQABPyEd/9oADAMBAAIAAwAAABD7/8QAFhEAAwAAAAAAAAAAAAAAAAAAAGGR/9oACAEDAQE/EHqf/8QAFhEAAwAAAAAA"
    "AAAAAAAAAAAAAAHx/9oACAECAQE/EJiP/8QAFhAAAwAAAAAAAAAAAAAAAAAAAMHw/9oACAEBAAE/EJRn/9k=")
GIF = base64.b64decode("R0lGODdhCAAGAIEAAP/IABpKawAAAAAAACwAAAAACAAGAAAIEQABCBwoMIDBgwgTKlzIEGFAADs=")
WEBP = base64.b64decode(
    "UklGRk4AAABXRUJQVlA4IEIAAABwAgCdASoIAAYAAUAmJZgCdGuAwQD1/wPRAK14AP7sW/4g+sNPACPNzK7SWy63e9pLZv3slf+j06AeirMu"
    "fu/BwAA=")
PDF = b"%PDF-1.7\n" + b"0" * 512


def chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def png(width: int = 4, height: int = 3, *, extra: bytes = b"") -> bytes:
    """A well-formed RGB PNG, optionally carrying an ancillary chunk to grow it."""
    rows = (b"\x00" + b"\x1a\x4a\x6b" * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + extra + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def png_of_size(total: int) -> bytes:
    """A valid PNG of exactly ``total`` bytes (a text chunk takes up the rest)."""
    base = len(png(extra=chunk(b"tEXt", b"Comment\x00")))
    return png(extra=chunk(b"tEXt", b"Comment\x00" + b"a" * (total - base)))


class SpyStorage(InMemoryStorage):
    """In-memory storage that records what was written and deleted, and can fail."""

    def __init__(self) -> None:
        super().__init__()
        self.failing: set[str] = set()
        self.uploads: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self.before_upload = None

    async def upload(self, storage_key, chunks, *, filename, mime_type):
        self.uploads.append((storage_key, filename))
        if self.before_upload is not None:
            await self.before_upload()
        if "upload" in self.failing:
            async for _ in chunks:
                pass
            raise StorageUnavailable("private-provider-detail")
        return await super().upload(storage_key, chunks, filename=filename, mime_type=mime_type)

    async def delete(self, ref: ObjectRef) -> None:
        self.deleted.append(ref.storage_key)
        if "delete" in self.failing:
            raise StorageUnavailable("private-provider-detail")
        await super().delete(ref)

    @property
    def keys(self) -> list[str]:
        return sorted(meta.ref.storage_key for meta, _ in self._objects.values())


@pytest.fixture
def storage(application) -> SpyStorage:
    application.state.storage = SpyStorage()
    return application.state.storage


def path(course_id: str) -> str:
    return f"{COURSES}/{course_id}/thumbnail"


async def put(client: AsyncClient, headers: dict | None, course_id: str, payload: bytes = PNG, *,
              filename: str = "cover.png", mime: str = "image/png"):
    return await client.put(path(course_id), headers=headers or {},
                            files={"file": (filename, payload, mime)})


async def row(session: AsyncSession, course_id: str) -> Course:
    return await session.scalar(select(Course).where(Course.id == UUID(course_id))
                                .execution_options(populate_existing=True))


async def served(client: AsyncClient, url: str):
    """Fetch a thumbnail as an ``<img>`` would: no credentials at all."""
    return await client.get(url.removeprefix("http://test"))


@pytest.fixture
async def course(auth_client, admin_headers) -> dict:
    return await create_course(auth_client, admin_headers, title="Thumbs " + uuid4().hex,
                               description="A course with a cover")


@pytest.fixture
async def with_thumbnail(auth_client, admin_headers, storage, course) -> dict:
    """The course, already carrying an uploaded PNG thumbnail."""
    response = await put(auth_client, admin_headers, course["id"])
    assert response.status_code == 200, response.text
    storage.uploads.clear()
    return response.json()


# ------------------------------------------------------------------ upload


async def test_a_png_becomes_the_course_thumbnail(auth_client, auth_session, admin_headers, storage, course):
    response = await put(auth_client, admin_headers, course["id"])

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == COURSE_FIELDS
    # Only the thumbnail changed.
    for field in COURSE_FIELDS - {"thumbnail_url", "updated_at"}:
        assert body[field] == course[field], field
    url = body["thumbnail_url"]
    assert re.fullmatch(rf"http://test/api/v1/course-thumbnails/{course['id']}/[0-9a-f-]{{36}}\.png", url)

    stored = await row(auth_session, course["id"])
    assert stored.thumbnail_url == url
    assert stored.thumbnail_storage_provider == StorageProvider.MEMORY
    assert stored.thumbnail_storage_key == f"courses/{course['id']}/thumbnails/{url.rsplit('/', 1)[1]}"
    # The provider's handle stays server-side.
    assert stored.thumbnail_provider_reference not in response.text
    assert storage.keys == [stored.thumbnail_storage_key]

    image = await served(auth_client, url)
    assert image.status_code == 200
    assert image.content == PNG
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in image.headers["content-security-policy"]
    # The admin read and the stored row agree.
    fetched = (await auth_client.get(f"{COURSES}/{course['id']}", headers=admin_headers)).json()
    assert fetched["thumbnail_url"] == url


@pytest.mark.parametrize("payload,mime,extension", [
    (JPEG, "image/jpeg", ".jpg"),
    (JPEG_PROGRESSIVE, "image/jpeg", ".jpg"),
    (PNG_RGBA, "image/png", ".png"),
    (PNG, "image/png; charset=binary", ".png"),
])
async def test_each_supported_image_is_accepted(auth_client, admin_headers, storage, course, payload, mime, extension):
    response = await put(auth_client, admin_headers, course["id"], payload, filename="cover", mime=mime)

    assert response.status_code == 200, response.text
    url = response.json()["thumbnail_url"]
    assert url.endswith(extension)
    image = await served(auth_client, url)
    assert image.content == payload
    assert image.headers["content-type"] == mime.split(";")[0]


async def test_an_image_right_at_the_limit_is_accepted(auth_client, admin_headers, storage, course):
    response = await put(auth_client, admin_headers, course["id"], png_of_size(THUMBNAIL_MAX_BYTES))

    assert response.status_code == 200, response.text


async def test_a_new_upload_replaces_the_previous_one_and_deletes_its_file(
        auth_client, auth_session, admin_headers, storage, course, with_thumbnail):
    previous_url = with_thumbnail["thumbnail_url"]
    previous_key = (await row(auth_session, course["id"])).thumbnail_storage_key

    response = await put(auth_client, admin_headers, course["id"], JPEG, filename="new.jpg", mime="image/jpeg")

    assert response.status_code == 200, response.text
    current = await row(auth_session, course["id"])
    assert response.json()["thumbnail_url"] != previous_url
    assert storage.deleted == [previous_key]
    assert storage.keys == [current.thumbnail_storage_key]
    assert (await served(auth_client, previous_url)).status_code == 404
    assert (await served(auth_client, response.json()["thumbnail_url"])).content == JPEG


async def test_an_upload_replaces_an_external_url_without_deleting_anything(
        auth_client, admin_headers, storage):
    course = await create_course(auth_client, admin_headers, title="External cover", thumbnail_url=EXTERNAL)

    response = await put(auth_client, admin_headers, course["id"])

    assert response.status_code == 200, response.text
    assert response.json()["thumbnail_url"] != EXTERNAL
    assert storage.deleted == []


# -------------------------------------------------------------- validation


def truncated_jpeg() -> bytes:
    return JPEG[:JPEG.index(b"\xff\xda") + 20]


REFUSALS = [
    ("empty file", b"", "image/png", 422, "Uploaded file is empty"),
    ("plain text", b"just some words", "text/plain", 415, "Thumbnail must be a PNG or JPEG image"),
    ("a PDF", PDF, "application/pdf", 415, "Thumbnail must be a PNG or JPEG image"),
    ("a real GIF", GIF, "image/gif", 415, "Thumbnail must be a PNG or JPEG image"),
    ("a real WebP", WEBP, "image/webp", 415, "Thumbnail must be a PNG or JPEG image"),
    ("an SVG", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml", 415,
     "Thumbnail must be a PNG or JPEG image"),
    ("no declared type", PNG, "", 415, "Thumbnail must be a PNG or JPEG image"),
    ("PHP disguised as PNG", b"<?php system($_GET['c']); ?>", "image/png", 422,
     "File content is not a valid image/png image"),
    ("HTML disguised as JPEG", b"<html><script>alert(1)</script></html>", "image/jpeg", 422,
     "File content is not a valid image/jpeg image"),
    ("a PNG declared as JPEG", PNG, "image/jpeg", 422, "File content is not a valid image/jpeg image"),
    ("a JPEG declared as PNG", JPEG, "image/png", 422, "File content is not a valid image/png image"),
    ("a GIF declared as PNG", GIF, "image/png", 422, "File content is not a valid image/png image"),
    ("the PNG signature alone", PNG[:8], "image/png", 422, "File content is not a valid image/png image"),
    ("a truncated PNG", PNG[:-12], "image/png", 422, "File content is not a valid image/png image"),
    ("a PNG with a bad checksum", PNG[:30] + bytes([PNG[30] ^ 0xFF]) + PNG[31:], "image/png", 422,
     "File content is not a valid image/png image"),
    ("a script appended after IEND", PNG + b"<?php echo 1; ?>", "image/png", 422,
     "File content is not a valid image/png image"),
    ("a PNG whose pixels are missing",
     png()[:png().index(b"IDAT") - 4] + chunk(b"IDAT", zlib.compress(b"\x00" * 5)) + chunk(b"IEND", b""),
     "image/png", 422, "File content is not a valid image/png image"),
    ("a PNG of zero width", png(width=0), "image/png", 422, "File content is not a valid image/png image"),
    ("a PNG too large to decode", png(width=20_000, height=1), "image/png", 422,
     "Thumbnail dimensions are too large"),
    ("a truncated JPEG", truncated_jpeg(), "image/jpeg", 422, "File content is not a valid image/jpeg image"),
    ("a JPEG with no frame", b"\xff\xd8\xff\xe0\x00\x04ab\xff\xda\x00\x02\xff\xd9", "image/jpeg", 422,
     "File content is not a valid image/jpeg image"),
    ("JPEG magic then junk", b"\xff\xd8\xff" + b"junk" * 50, "image/jpeg", 422,
     "File content is not a valid image/jpeg image"),
    ("one byte over the limit", png_of_size(THUMBNAIL_MAX_BYTES + 1), "image/png", 413,
     "Thumbnail exceeds the maximum size of 5 MiB"),
]


@pytest.mark.parametrize("payload,mime,status,detail", [r[1:] for r in REFUSALS], ids=[r[0] for r in REFUSALS])
async def test_a_refused_file_changes_nothing(auth_client, auth_session, admin_headers, storage, course,
                                              with_thumbnail, payload, mime, status, detail):
    before = await row(auth_session, course["id"])
    snapshot = (before.thumbnail_url, before.thumbnail_storage_key, before.thumbnail_provider_reference)

    response = await put(auth_client, admin_headers, course["id"], payload, mime=mime)

    assert response.status_code == status, response.text
    assert response.json() == {"detail": detail}
    after = await row(auth_session, course["id"])
    assert (after.thumbnail_url, after.thumbnail_storage_key, after.thumbnail_provider_reference) == snapshot
    # Refused before storage: nothing written, nothing deleted.
    assert storage.uploads == [] and storage.deleted == []
    assert storage.keys == [snapshot[1]]
    assert (await served(auth_client, snapshot[0])).content == PNG


async def test_a_request_without_a_file_is_refused(auth_client, admin_headers, storage, course):
    response = await auth_client.put(path(course["id"]), headers=admin_headers, data={"file": "not a file"})

    assert response.status_code == 422
    assert storage.uploads == []


# ---------------------------------------------------------------- security


@pytest.mark.parametrize("filename", [
    "../../../etc/passwd.png",
    "..\\..\\windows\\system32\\cover.png",
    "/var/www/html/cover.png",
    "courses/other-course/thumbnails/cover.png",
    "été <script>alert('x')</script> \"cover\".png",
    "cover.php.png",
    "x" * 1000 + ".png",
])
async def test_the_client_filename_never_reaches_storage_or_the_url(
        auth_client, auth_session, admin_headers, storage, course, filename):
    response = await put(auth_client, admin_headers, course["id"], filename=filename)

    assert response.status_code == 200, response.text
    key = (await row(auth_session, course["id"])).thumbnail_storage_key
    assert re.fullmatch(rf"courses/{course['id']}/thumbnails/[0-9a-f-]{{36}}\.png", key)
    # The provider is given the generated name, not the client's.
    assert storage.uploads == [(key, key.rsplit("/", 1)[1])]
    # Nothing was written anywhere else.
    assert storage.keys == [key]
    for fragment in ("passwd", "windows", "var", "script", "php", "xxxx", "other-course"):
        assert fragment not in response.json()["thumbnail_url"]
        assert fragment not in key


async def test_only_the_current_thumbnail_of_that_course_is_served(
        auth_client, admin_headers, storage, course, with_thumbnail):
    url = with_thumbnail["thumbnail_url"]
    name = url.rsplit("/", 1)[1]
    other = await create_course(auth_client, admin_headers, title="Other", thumbnail_url=EXTERNAL)

    for probe in (
        f"/api/v1/course-thumbnails/{other['id']}/{name}",       # another course
        f"/api/v1/course-thumbnails/{uuid4()}/{name}",           # no such course
        f"/api/v1/course-thumbnails/{course['id']}/{uuid4()}.png",  # a guess
        f"/api/v1/course-thumbnails/{course['id']}/{name.upper()}",
        f"/api/v1/course-thumbnails/{course['id']}/{name[:-4]}.jpg",
    ):
        response = await auth_client.get(probe)
        assert response.status_code == 404, probe
        assert response.json() == {"detail": "Thumbnail not found"}
    # A traversal attempt matches no route at all.
    assert (await auth_client.get(f"/api/v1/course-thumbnails/{course['id']}/..%2F..%2Fcourses")).status_code == 404
    assert (await served(auth_client, url)).status_code == 200


async def test_a_thumbnail_whose_file_disappeared_is_404(auth_client, auth_session, admin_headers, storage,
                                                         course, with_thumbnail):
    stored = await row(auth_session, course["id"])
    await InMemoryStorage.delete(storage, ObjectRef(stored.thumbnail_storage_key, stored.thumbnail_provider_reference))

    assert (await served(auth_client, with_thumbnail["thumbnail_url"])).status_code == 404


# ------------------------------------------------------------- permissions


async def test_admin_route_refuses_anonymous_callers(auth_client, storage, course):
    response = await put(auth_client, None, course["id"])

    assert response.status_code == 401
    assert storage.uploads == []


async def test_admin_route_refuses_members(auth_client, admin_headers, member_headers, storage, course):
    response = await put(auth_client, member_headers, course["id"])

    assert response.status_code == 403
    assert storage.uploads == []


async def test_admin_route_refuses_an_inactive_administrator(auth_client, auth_session, admin_headers, storage, course):
    await auth_session.execute(update(User).where(User.email == "admin@example.com").values(is_active=False))
    await auth_session.commit()

    response = await put(auth_client, admin_headers, course["id"])

    assert response.status_code == 401
    assert storage.uploads == []


async def test_an_unknown_course_is_404(auth_client, admin_headers, storage):
    response = await put(auth_client, admin_headers, str(uuid4()))

    assert response.status_code == 404
    assert response.json() == {"detail": "Course not found"}
    assert storage.uploads == []


@pytest.mark.parametrize("transitions", [["publish"], ["publish", "archive"]], ids=["published", "archived"])
async def test_a_published_or_archived_course_is_read_only(auth_client, admin_headers, storage, transitions):
    course = await create_course(auth_client, admin_headers, title="Live", thumbnail_url=EXTERNAL)
    for transition in transitions:
        assert (await auth_client.post(f"{COURSES}/{course['id']}/{transition}", headers=admin_headers)).status_code == 200

    response = await put(auth_client, admin_headers, course["id"])

    assert response.status_code == 409
    assert response.json() == {"detail": "Only DRAFT courses can be edited"}
    assert storage.uploads == []
    fetched = (await auth_client.get(f"{COURSES}/{course['id']}", headers=admin_headers)).json()
    assert fetched["thumbnail_url"] == EXTERNAL


# -------------------------------------------------------------- regression


async def test_an_external_thumbnail_url_still_works(auth_client, auth_session, admin_headers, storage):
    course = await create_course(auth_client, admin_headers, title="External", thumbnail_url=EXTERNAL)
    changed = "https://cdn.example.org/other.png"

    response = await auth_client.patch(f"{COURSES}/{course['id']}", headers=admin_headers,
                                       json={"thumbnail_url": changed})

    assert response.status_code == 200
    assert response.json()["thumbnail_url"] == changed
    stored = await row(auth_session, course["id"])
    assert stored.thumbnail_storage_key is None and stored.thumbnail_provider_reference is None
    assert storage.deleted == []


@pytest.mark.parametrize("replacement", [None, EXTERNAL], ids=["removed", "external"])
async def test_changing_an_uploaded_thumbnail_by_url_frees_its_file(
        auth_client, auth_session, admin_headers, storage, course, with_thumbnail, replacement):
    key = (await row(auth_session, course["id"])).thumbnail_storage_key

    response = await auth_client.patch(f"{COURSES}/{course['id']}", headers=admin_headers,
                                       json={"thumbnail_url": replacement})

    assert response.status_code == 200
    assert response.json()["thumbnail_url"] == replacement
    stored = await row(auth_session, course["id"])
    assert (stored.thumbnail_storage_provider, stored.thumbnail_storage_key,
            stored.thumbnail_provider_reference) == (None, None, None)
    assert storage.deleted == [key] and storage.keys == []
    assert (await served(auth_client, with_thumbnail["thumbnail_url"])).status_code == 404


@pytest.mark.parametrize("patch", [
    {"title": "Renamed"},
    {"description": "New words"},
    "same thumbnail",
], ids=["title", "description", "same-url"])
async def test_other_edits_keep_an_uploaded_thumbnail(auth_client, auth_session, admin_headers, storage,
                                                      course, with_thumbnail, patch):
    if patch == "same thumbnail":
        patch = {"thumbnail_url": with_thumbnail["thumbnail_url"]}

    response = await auth_client.patch(f"{COURSES}/{course['id']}", headers=admin_headers, json=patch)

    assert response.status_code == 200, response.text
    assert response.json()["thumbnail_url"] == with_thumbnail["thumbnail_url"]
    assert (await row(auth_session, course["id"])).thumbnail_storage_key is not None
    assert storage.deleted == []
    assert (await served(auth_client, with_thumbnail["thumbnail_url"])).content == PNG


async def test_removing_still_succeeds_when_the_file_cannot_be_deleted(
        auth_client, admin_headers, storage, course, with_thumbnail, caplog):
    storage.failing.add("delete")

    with caplog.at_level(logging.ERROR):
        response = await auth_client.patch(f"{COURSES}/{course['id']}", headers=admin_headers,
                                           json={"thumbnail_url": None})

    assert response.status_code == 200
    assert response.json()["thumbnail_url"] is None
    assert any("Orphaned storage object after a removed thumbnail" in r.message for r in caplog.records)
    assert "private-provider-detail" not in response.text


# ------------------------------------------------------------- consistency


async def test_a_storage_outage_keeps_the_previous_thumbnail(auth_client, auth_session, admin_headers, storage,
                                                             course, with_thumbnail):
    storage.failing.add("upload")

    response = await put(auth_client, admin_headers, course["id"], JPEG, mime="image/jpeg")

    assert response.status_code == 503
    assert response.json() == {"detail": "Storage temporarily unavailable"}
    assert "private-provider-detail" not in response.text
    assert (await row(auth_session, course["id"])).thumbnail_url == with_thumbnail["thumbnail_url"]
    assert storage.deleted == []
    assert (await served(auth_client, with_thumbnail["thumbnail_url"])).content == PNG


async def test_a_course_published_during_the_transfer_keeps_its_thumbnail(
        auth_client, auth_session, admin_headers, storage, course, with_thumbnail):
    """The draft rule is re-checked after the transfer; the new file is then discarded."""
    async def publish() -> None:
        await auth_session.execute(update(Course).where(Course.id == UUID(course["id"]))
                                   .values(status="PUBLISHED", published_at=Course.created_at))
        await auth_session.commit()
    storage.before_upload = publish
    previous_key = (await row(auth_session, course["id"])).thumbnail_storage_key

    response = await put(auth_client, admin_headers, course["id"], JPEG, mime="image/jpeg")

    assert response.status_code == 409
    stored = await row(auth_session, course["id"])
    assert stored.thumbnail_url == with_thumbnail["thumbnail_url"]
    assert stored.thumbnail_storage_key == previous_key
    new_key = storage.uploads[0][0]
    assert storage.deleted == [new_key]
    assert storage.keys == [previous_key]
    assert (await served(auth_client, with_thumbnail["thumbnail_url"])).content == PNG


async def test_a_replaced_file_that_cannot_be_deleted_is_logged_not_failed(
        auth_client, auth_session, admin_headers, storage, course, with_thumbnail, caplog):
    storage.failing.add("delete")

    with caplog.at_level(logging.ERROR):
        response = await put(auth_client, admin_headers, course["id"], JPEG, mime="image/jpeg")

    assert response.status_code == 200
    assert response.json()["thumbnail_url"].endswith(".jpg")
    assert any("Orphaned storage object after a replaced thumbnail" in r.message for r in caplog.records)


# ---------------------------------------------------------------- contract


async def test_the_contract_as_published(auth_client, admin_headers, storage, course):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()

    operation = schema["paths"]["/api/v1/admin/courses/{course_id}/thumbnail"]["put"]
    assert operation["security"] == [{"HTTPBearer": []}]
    assert [p["name"] for p in operation["parameters"]] == ["course_id"]
    content = operation["requestBody"]["content"]
    assert list(content) == ["multipart/form-data"]
    form = schema["components"]["schemas"][content["multipart/form-data"]["schema"]["$ref"].rsplit("/", 1)[1]]
    assert form["required"] == ["file"]
    assert form["properties"]["file"]["type"] == "string"
    assert form["properties"]["file"]["contentMediaType"] == "application/octet-stream"
    assert {"200", "401", "403", "404", "409", "413", "415", "422", "503"} <= operation["responses"].keys()
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CourseResponse")

    read = schema["paths"]["/api/v1/course-thumbnails/{course_id}/{name}"]["get"]
    assert "security" not in read
    assert {"200", "404"} <= read["responses"].keys()

    # The upload is PUT only: it replaces, nothing else is routed there.
    for method in ("POST", "PATCH", "DELETE", "GET"):
        response = await auth_client.request(method, path(course["id"]), headers=admin_headers)
        assert response.status_code == 405, method
    assert storage.uploads == []
