"""Uploaded course thumbnails (BE-THUMBNAIL-UPLOAD-01).

The file goes through the same storage port, key builder and ordering as a
lesson resource, so a failure always leaves a recoverable state:

* The draft check runs first; then the whole file - at most
  :data:`THUMBNAIL_MAX_BYTES` - is read and validated *before* anything is
  stored, so a refused upload never reaches the provider.
* Bytes are stored under a fresh server-generated key, then the course row is
  pointed at them in one transaction. If that transaction fails, the new object
  is deleted and the row still names the previous thumbnail.
* The previous uploaded object is deleted only after that commit, best effort.
  If the provider refuses, the orphan is logged with its key - the course is
  correct either way.

``thumbnail_url`` stays the one field every reader uses. For an upload it is an
absolute URL to :func:`CourseThumbnailService.content`'s route, so the forms
and the catalogue that already accept any http(s) thumbnail need no change.
"""

import logging
from collections.abc import AsyncIterator, Callable
from uuid import UUID

from anyio import to_thread

from app.core.exceptions import BusinessError
from app.models.course import Course
from app.schemas.course import CourseResponse
from app.services.content_rules import content_write, require_draft
from app.services.course_service import CourseService, detach_thumbnail, discard_thumbnail
from app.services.image_rules import (
    JPEG, PNG, THUMBNAIL_MAX_BYTES, validate_thumbnail, validate_thumbnail_type,
)
from app.services.resource_service import UploadPayload
from app.storage.base import StoragePort
from app.storage.exceptions import ObjectNotFound, StorageError
from app.storage.keys import build_storage_key, key_name
from app.storage.models import AccessGrant, AccessKind, ObjectRef, ObjectStream

logger = logging.getLogger(__name__)

THUMBNAIL_FOLDER = "thumbnails"
#: The media type served is decided by the extension this service chose.
SERVED_TYPES = {".png": PNG, ".jpg": JPEG}
CONFLICT = "Course thumbnail conflict"


class CourseThumbnailService:
    def __init__(self, courses: CourseService, storage: StoragePort) -> None:
        self.courses = courses
        self.storage = storage

    @property
    def session(self):
        return self.courses.courses.session

    async def _draft_course(self, course_id: UUID) -> Course:
        course = await self.courses.require_course(course_id, lock=True)
        require_draft(course)
        return course

    @staticmethod
    async def _read(payload: UploadPayload) -> bytes:
        """The whole file, refused as soon as it passes the limit."""
        data = bytearray()
        async for chunk in payload.chunks:
            data.extend(chunk)
            if len(data) > THUMBNAIL_MAX_BYTES:
                raise BusinessError(413, "Thumbnail exceeds the maximum size of 5 MiB")
        if not data:
            raise BusinessError(422, "Uploaded file is empty")
        return bytes(data)

    @staticmethod
    async def _chunks(data: bytes) -> AsyncIterator[bytes]:
        yield data

    async def upload(self, course_id: UUID, payload: UploadPayload,
                     public_url: Callable[[str], str]) -> CourseResponse:
        """Store an image and make it the draft course's thumbnail.

        ``public_url`` turns the stored object's name into the absolute address
        saved as ``thumbnail_url``. Only the thumbnail fields change.
        """
        async with content_write(self.session, CONFLICT):
            await self._draft_course(course_id)
        mime_type = validate_thumbnail_type(payload.mime_type)
        data = await self._read(payload)
        # CPU-bound (a PNG is inflated to check it), so kept off the event loop.
        await to_thread.run_sync(validate_thumbnail, mime_type, data)

        # The client's filename is never used: not in the key, not as the name.
        storage_key = build_storage_key(course_id, THUMBNAIL_FOLDER, mime_type)
        try:
            stored = await self.storage.upload(storage_key, self._chunks(data),
                                               filename=key_name(storage_key), mime_type=mime_type)
        except StorageError:
            logger.error("Storage upload failed", extra={"storage_key": storage_key})
            raise BusinessError(503, "Storage temporarily unavailable") from None

        replaced: ObjectRef | None = None
        try:
            async with content_write(self.session, CONFLICT):
                # Re-checked: the course may have been published during the transfer.
                course = await self._draft_course(course_id)
                replaced = detach_thumbnail(course)
                course.thumbnail_url = public_url(key_name(stored.storage_key))
                course.thumbnail_storage_provider = self.storage.provider
                course.thumbnail_storage_key = stored.storage_key
                course.thumbnail_provider_reference = stored.provider_reference
                await self.courses.courses.save(course)
                result = CourseResponse.model_validate(course)
        except BaseException:
            await discard_thumbnail(self.storage, stored.ref, "a failed thumbnail commit")
            raise
        if replaced is not None:
            await discard_thumbnail(self.storage, replaced, "a replaced thumbnail")
        return result

    async def content(self, course_id: UUID, name: str) -> tuple[str, AccessGrant, ObjectStream | None]:
        """The course's *current* uploaded thumbnail, whatever the course's status.

        Any other name - a replaced thumbnail, a guess, an external URL's
        course - is 404, so an address stops working once it is replaced.
        """
        course = await self.courses.courses.get(course_id)
        key = None if course is None else course.thumbnail_storage_key
        if key is None or course.thumbnail_provider_reference is None or key_name(key) != name:
            raise BusinessError(404, "Thumbnail not found")
        mime_type = SERVED_TYPES.get(name[name.rfind("."):])
        if mime_type is None:
            raise BusinessError(404, "Thumbnail not found")
        ref = ObjectRef(storage_key=key, provider_reference=course.thumbnail_provider_reference)
        try:
            grant = await self.storage.access(ref)
            if grant.kind == AccessKind.REDIRECT and grant.url:
                return mime_type, grant, None
            return mime_type, grant, await self.storage.open(ref)
        except ObjectNotFound:
            raise BusinessError(404, "Thumbnail not found") from None
        except StorageError:
            logger.error("Storage read failed", extra={"storage_key": key})
            raise BusinessError(503, "Storage temporarily unavailable") from None
