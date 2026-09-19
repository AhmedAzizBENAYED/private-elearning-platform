"""Lesson resource use cases.

The database is the source of truth. There is no distributed transaction across
PostgreSQL and the storage provider, so the ordering below is chosen to make
every failure leave a *recoverable* state:

* Upload stores bytes first and commits metadata second. A crash in between
  leaves an unreferenced object at the provider, which is inert and reclaimable.
  The reverse order would leave a row pointing at bytes that do not exist.
* Replacement never deletes the old object until the new metadata is committed.
* Deletion removes the row first and the object afterwards, best effort. A failed
  object delete leaves an orphan; a failed row delete would leave a lesson whose
  file is gone.

Orphans are logged with their storage key so they can be reconciled.
"""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote
from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.lesson import ContentType, Lesson
from app.models.resource import LessonResource
from app.models.user import User
from app.repositories.resource_repository import LessonResourceRepository
from app.schemas.resource import MemberResourceResponse, ResourceResponse
from app.services.content_rules import content_write, require_draft
from app.services.enrollment_service import EnrollmentService
from app.services.lesson_service import LessonService
from app.services.resource_rules import (
    SIGNATURE_BYTES, UploadRules, require_storage_lesson, validate_filename,
    validate_mime_type, validate_signature,
)
from app.storage.base import StoragePort
from app.storage.exceptions import ObjectNotFound, PayloadTooLarge, StorageError
from app.storage.keys import build_storage_key
from app.storage.models import AccessGrant, AccessKind, ByteRange, ObjectRef, ObjectStream

logger = logging.getLogger(__name__)


class PlaybackTokenIssuer(Protocol):
    """The slice of the authentication service this domain needs."""

    def issue_playback_token(self, user: User, lesson_id: UUID) -> str: ...


@dataclass(slots=True)
class UploadPayload:
    """One inbound file, streamed rather than buffered."""

    filename: str | None
    mime_type: str | None
    chunks: AsyncIterator[bytes]


class LessonResourceService:
    def __init__(
        self, resources: LessonResourceRepository, lessons: LessonService,
        enrollments: EnrollmentService, storage: StoragePort, rules: UploadRules,
        playback: "PlaybackTokenIssuer | None" = None,
    ) -> None:
        self.resources = resources
        self.lessons = lessons
        self.enrollments = enrollments
        self.storage = storage
        self.rules = rules
        # Minting stays in the authentication layer; this service only asks for it.
        self.playback = playback

    # ------------------------------------------------------------- helpers

    async def _lesson_course(self, lesson_id: UUID) -> tuple[Lesson, UUID]:
        lesson = await self.lessons.require_lesson(lesson_id)
        module = await self.lessons.modules.require_module(lesson.module_id)
        return lesson, module.course_id

    async def _draft_lesson(self, lesson_id: UUID) -> tuple[Lesson, UUID]:
        """Resolve a lesson and assert its course is editable, holding the lock.

        Reuses Ticket 5's rule: a published or archived course's content is
        immutable, so resources cannot be added, replaced or removed there.
        """
        lesson, course_id = await self._lesson_course(lesson_id)
        require_draft(await self.lessons.modules.courses.require_course(course_id, lock=True))
        # A competing delete may have landed while waiting for the course lock.
        lesson, course_id = await self._lesson_course(lesson_id)
        return lesson, course_id

    async def _require_resource(self, lesson_id: UUID, *, lock: bool = False) -> LessonResource:
        resource = await self.resources.get(lesson_id, lock=lock)
        if resource is None:
            raise BusinessError(404, "Lesson resource not found")
        return resource

    @staticmethod
    def _ref(resource: LessonResource) -> ObjectRef:
        return ObjectRef(storage_key=resource.storage_key,
                         provider_reference=resource.provider_reference)

    async def _discard(self, ref: ObjectRef, reason: str) -> None:
        """Best-effort cleanup; an orphan is logged, never raised to the client."""
        try:
            await self.storage.delete(ref)
        except StorageError:
            logger.error("Orphaned storage object after %s", reason,
                         extra={"storage_key": ref.storage_key})

    async def _limited(self, payload: UploadPayload, mime_type: str) -> AsyncIterator[bytes]:
        """Yield the upload while sniffing its head and enforcing the size cap.

        The limit is applied to the bytes actually received, not to a
        client-supplied ``Content-Length`` header.
        """
        head, total, checked = bytearray(), 0, False
        async for chunk in payload.chunks:
            if not chunk:
                continue
            total += len(chunk)
            if total > self.rules.max_bytes:
                raise PayloadTooLarge("Upload exceeds the configured maximum size")
            if not checked:
                head.extend(chunk[:SIGNATURE_BYTES - len(head)])
                if len(head) >= SIGNATURE_BYTES:
                    validate_signature(mime_type, bytes(head))
                    checked = True
            yield chunk
        if total == 0:
            raise BusinessError(422, "Uploaded file is empty")
        if not checked:
            validate_signature(mime_type, bytes(head))

    # -------------------------------------------------------------- upload

    async def upload(self, lesson_id: UUID, payload: UploadPayload) -> ResourceResponse:
        """Store a file for a draft lesson, replacing any existing resource."""
        async with content_write(self.resources.session, "Lesson resource conflict"):
            lesson, course_id = await self._draft_lesson(lesson_id)
            folder = require_storage_lesson(lesson.content_type)
            filename = validate_filename(payload.filename)
            mime_type = validate_mime_type(lesson.content_type, payload.mime_type, filename, self.rules)

        # The provider transfer runs outside any transaction: a multi-gigabyte
        # upload must not hold a course row lock, and DRAFT is re-checked below.
        storage_key = build_storage_key(course_id, folder, mime_type)
        try:
            stored = await self.storage.upload(
                storage_key, self._limited(payload, mime_type),
                filename=filename, mime_type=mime_type,
            )
        except PayloadTooLarge:
            raise BusinessError(413, "Upload exceeds the configured maximum size") from None
        except StorageError:
            logger.error("Storage upload failed", extra={"storage_key": storage_key})
            raise BusinessError(503, "Storage temporarily unavailable") from None

        replaced: ObjectRef | None = None
        try:
            async with content_write(self.resources.session, "Lesson resource conflict"):
                lesson, _ = await self._draft_lesson(lesson_id)
                require_storage_lesson(lesson.content_type)
                resource = await self.resources.get(lesson_id, lock=True)
                if resource is None:
                    resource = LessonResource(lesson_id=lesson_id)
                elif resource.provider_reference != stored.provider_reference:
                    replaced = self._ref(resource)
                resource.storage_provider = self.storage.provider
                resource.storage_key = stored.storage_key
                resource.provider_reference = stored.provider_reference
                resource.original_filename = stored.filename
                resource.mime_type = stored.mime_type
                resource.file_size_bytes = stored.size_bytes
                resource.checksum = stored.checksum
                # Playback duration stays a lesson/progress concern; storage only
                # mirrors it so a future provider migration keeps the value.
                resource.duration_seconds = lesson.duration_seconds
                await self.resources.save(resource)
                result = ResourceResponse.model_validate(resource)
        except BaseException:
            await self._discard(stored.ref, "a failed resource commit")
            raise
        if replaced is not None:
            await self._discard(replaced, "a replaced resource")
        return result

    # --------------------------------------------------------------- reads

    async def get(self, lesson_id: UUID) -> ResourceResponse:
        """Administrator metadata read; storage is not contacted."""
        await self.lessons.require_lesson(lesson_id)
        return ResourceResponse.model_validate(await self._require_resource(lesson_id))

    async def list_for_course(self, course_id: UUID) -> list[ResourceResponse]:
        """Every resource in a course in one query, never one request per lesson."""
        await self.lessons.modules.courses.require_course(course_id)
        return [ResourceResponse.model_validate(row)
                for row in await self.resources.list_for_course(course_id)]

    async def member_resource(self, user: User, lesson_id: UUID) -> MemberResourceResponse:
        """Authorize an enrolled member, then describe the file without provider data.

        For a VIDEO lesson the download URL carries a short-lived, lesson-scoped
        playback token so a plain ``<video src>`` can stream it. Other kinds keep
        a bare URL and stay bearer-only: the token authorizes video playback and
        nothing else.
        """
        lesson, resource = await self._authorized(user.id, lesson_id)
        url = f"/api/v1/lessons/{lesson.id}/resource/content"
        if lesson.content_type == ContentType.VIDEO:
            token = self.playback.issue_playback_token(user, lesson.id)
            url += f"?playback_token={quote(token, safe='')}"
        return MemberResourceResponse(
            lesson_id=lesson.id, resource_id=resource.id, content_type=lesson.content_type,
            filename=resource.original_filename, mime_type=resource.mime_type,
            size_bytes=resource.file_size_bytes, duration_seconds=lesson.duration_seconds,
            download_url=url,
        )

    async def _authorized(self, user_id: UUID, lesson_id: UUID) -> tuple[Lesson, LessonResource]:
        """Enrollment gates every member read, including for archived courses."""
        lesson, course_id = await self._lesson_course(lesson_id)
        await self.enrollments.require_enrollment(user_id, course_id)
        if lesson.content_type not in {ContentType.VIDEO, ContentType.DOCUMENT}:
            raise BusinessError(409, "Only VIDEO and DOCUMENT lessons can hold a stored file")
        return lesson, await self._require_resource(lesson_id)

    async def content(
        self, user_id: UUID, lesson_id: UUID, byte_range: ByteRange | None = None,
        *, video_only: bool = False,
    ) -> tuple[LessonResource, AccessGrant, ObjectStream | None]:
        """Authorize once, then return either a redirect grant or an open stream.

        Providers that mint short-lived URLs stop here with ``REDIRECT`` and no
        stream, so their bytes never pass through this process. The grant itself
        is ephemeral and is never persisted.
        """
        lesson, resource = await self._authorized(user_id, lesson_id)
        if video_only and lesson.content_type != ContentType.VIDEO:
            # A playback token authorizes video streaming only, never documents.
            raise BusinessError(401, "Invalid authentication credentials")
        ref = self._ref(resource)
        try:
            grant = await self.storage.access(ref)
            if grant.kind == AccessKind.REDIRECT and grant.url:
                return resource, grant, None
            return resource, grant, await self.storage.open(ref, byte_range)
        except ObjectNotFound:
            raise BusinessError(404, "Lesson resource is no longer available") from None
        except StorageError:
            logger.error("Storage read failed", extra={"storage_key": resource.storage_key})
            raise BusinessError(503, "Storage temporarily unavailable") from None

    # -------------------------------------------------------------- delete

    async def delete(self, lesson_id: UUID) -> None:
        """Remove a draft lesson's resource, then its bytes."""
        async with content_write(self.resources.session, "Lesson resource is still referenced"):
            await self._draft_lesson(lesson_id)
            resource = await self._require_resource(lesson_id, lock=True)
            ref = self._ref(resource)
            await self.resources.delete(resource)
        await self._discard(ref, "a deleted resource")
