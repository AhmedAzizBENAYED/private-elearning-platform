"""Storage port, key generation and file validation, with no provider credentials."""

from uuid import uuid4

import pytest

from app.core.config import Settings
from app.core.exceptions import BusinessError
from app.models.lesson import ContentType
from app.storage.base import StoragePort
from app.storage.exceptions import InvalidStorageKey, ObjectNotFound
from app.storage.factory import create_storage
from app.storage.keys import build_storage_key, key_name, key_prefix, validate_storage_key
from app.storage.memory import InMemoryStorage
from app.storage.models import AccessKind, ByteRange, ObjectRef, StorageProvider
from app.services.resource_rules import (
    UploadRules, require_storage_lesson, validate_filename, validate_mime_type, validate_signature,
)

pytestmark = pytest.mark.anyio
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
RULES = UploadRules(max_bytes=1024, video_mime_types=frozenset({"video/mp4"}),
                    document_mime_types=frozenset({"application/pdf"}))


async def chunks(payload: bytes, size: int = 8):
    for offset in range(0, len(payload), size):
        yield payload[offset:offset + size]


# ------------------------------------------------------------------- keys

@pytest.mark.parametrize("key", [
    "", "/courses/a", "courses//a", "courses/../secrets", "courses/./a", "a" * 513,
    "courses/a\\b", "courses/a b", "courses/a\nb", ".", "..", "courses/-leading",
])
def test_storage_keys_reject_traversal_and_unsafe_segments(key: str) -> None:
    with pytest.raises(InvalidStorageKey):
        validate_storage_key(key)


def test_generated_keys_are_stable_scoped_and_client_independent() -> None:
    course_id = uuid4()
    first = build_storage_key(course_id, "videos", "video/mp4")
    second = build_storage_key(course_id, "videos", "video/mp4")
    assert first.startswith(f"courses/{course_id}/videos/") and first.endswith(".mp4")
    # A fresh UUID per upload keeps a replacement from overwriting the live object.
    assert first != second
    assert key_prefix(first) == ("courses", str(course_id), "videos")
    assert key_name(first).endswith(".mp4")
    assert build_storage_key(course_id, "documents", "application/pdf").endswith(".pdf")


def test_storage_key_never_contains_a_client_filename() -> None:
    key = build_storage_key(uuid4(), "videos", "video/mp4")
    assert "../" not in key and "payload" not in key


# ------------------------------------------------------------- validation

def test_only_video_and_document_lessons_are_storage_backed() -> None:
    assert require_storage_lesson(ContentType.VIDEO) == "videos"
    assert require_storage_lesson(ContentType.DOCUMENT) == "documents"
    for kind in (ContentType.LINK, ContentType.TEXT):
        with pytest.raises(BusinessError) as error:
            require_storage_lesson(kind)
        assert error.value.status_code == 409


@pytest.mark.parametrize("filename", ["", "   ", None, "a" * 256, "../escape.mp4",
                                      "dir/file.mp4", "back\\slash.mp4", "null\x00.mp4", "."])
def test_unsafe_filenames_are_rejected(filename: str | None) -> None:
    with pytest.raises(BusinessError) as error:
        validate_filename(filename)
    assert error.value.status_code == 422


def test_media_type_must_be_configured_and_match_the_extension() -> None:
    assert validate_mime_type(ContentType.VIDEO, "video/mp4", "a.mp4", RULES) == "video/mp4"
    # Parameters are ignored; case is normalised.
    assert validate_mime_type(ContentType.VIDEO, "VIDEO/MP4; codecs=avc1", "a.mp4", RULES) == "video/mp4"
    for kind, mime, name in [(ContentType.VIDEO, "application/pdf", "a.pdf"),
                             (ContentType.DOCUMENT, "video/mp4", "a.mp4"),
                             (ContentType.VIDEO, "application/x-msdownload", "a.exe"),
                             (ContentType.VIDEO, None, "a.mp4")]:
        with pytest.raises(BusinessError) as error:
            validate_mime_type(kind, mime, name, RULES)
        assert error.value.status_code == 415
    with pytest.raises(BusinessError) as mismatch:
        validate_mime_type(ContentType.VIDEO, "video/mp4", "a.pdf", RULES)
    assert mismatch.value.status_code == 422


def test_declared_media_type_is_checked_against_the_actual_bytes() -> None:
    validate_signature("video/mp4", MP4)
    validate_signature("application/pdf", b"%PDF-1.7 trailing")
    # An unregistered type is accepted on configuration alone, by design.
    validate_signature("video/x-custom", b"anything")
    for mime, payload in [("video/mp4", b"MZ\x90\x00 not a video"),
                          ("application/pdf", MP4)]:
        with pytest.raises(BusinessError) as error:
            validate_signature(mime, payload)
        assert error.value.status_code == 422


# ---------------------------------------------------------------- adapter

async def test_memory_adapter_satisfies_the_port() -> None:
    storage: StoragePort = InMemoryStorage()
    key = build_storage_key(uuid4(), "videos", "video/mp4")
    stored = await storage.upload(key, chunks(MP4), filename="lesson.mp4", mime_type="video/mp4")

    assert stored.storage_key == key and stored.size_bytes == len(MP4)
    assert stored.provider_reference and stored.provider_reference != key
    assert stored.checksum is not None
    assert await storage.exists(stored.ref)

    metadata = await storage.metadata(stored.ref)
    assert (metadata.filename, metadata.mime_type) == ("lesson.mp4", "video/mp4")
    assert (await storage.access(stored.ref)).kind == AccessKind.STREAM

    stream = await storage.open(stored.ref)
    assert b"".join([chunk async for chunk in stream.chunks]) == MP4
    assert not stream.partial

    partial = await storage.open(stored.ref, ByteRange(start=4, end=7))
    assert b"".join([chunk async for chunk in partial.chunks]) == b"ftyp"
    assert partial.partial and partial.content_range == f"bytes 4-7/{len(MP4)}"

    await storage.delete(stored.ref)
    assert not await storage.exists(stored.ref)
    # Deleting an absent object is quiet; reading one is not.
    await storage.delete(stored.ref)
    with pytest.raises(ObjectNotFound):
        await storage.metadata(stored.ref)


async def test_memory_adapter_rejects_unsafe_keys() -> None:
    with pytest.raises(InvalidStorageKey):
        await InMemoryStorage().upload("../escape", chunks(MP4), filename="a", mime_type="video/mp4")


def test_factory_defaults_to_memory_without_provider_configuration(settings: Settings) -> None:
    storage = create_storage(settings)
    assert isinstance(storage, InMemoryStorage)
    assert storage.provider == StorageProvider.MEMORY


def test_object_ref_is_provider_neutral() -> None:
    ref = ObjectRef(storage_key="courses/a/videos/b.mp4", provider_reference="opaque")
    assert not any("google" in field.lower() or "drive" in field.lower()
                   for field in ObjectRef.__slots__)
    assert ref.provider_reference == "opaque"
