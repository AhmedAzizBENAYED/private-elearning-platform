"""Member access to lesson files, and the shared resource service composition.

Clients address files through this API only. No provider URL, credential or
identifier reaches a response, so replacing the storage adapter cannot change
the contract a frontend depends on.
"""

import re
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import RedirectResponse, StreamingResponse

from app.api.v1.content_dependencies import LessonDependency, catalog_access, no_cache
from app.core.dependencies import AuthServiceDependency, MediaUser
from app.api.v1.enrollments import EnrollmentDependency, LearningUser
from app.database.session import DatabaseSession
from app.repositories.resource_repository import LessonResourceRepository
from app.schemas.resource import MemberResourceResponse
from app.services.resource_rules import UploadRules
from app.services.resource_service import LessonResourceService
from app.storage.models import ByteRange

RANGE_HEADER = re.compile(r"^bytes=(\d{0,15})-(\d{0,15})$")


def get_resource_service(
    session: DatabaseSession, lessons: LessonDependency,
    enrollments: EnrollmentDependency, auth: AuthServiceDependency, request: Request,
) -> LessonResourceService:
    settings = request.app.state.settings
    return LessonResourceService(
        LessonResourceRepository(session), lessons, enrollments,
        request.app.state.storage,
        UploadRules(max_bytes=settings.storage_max_upload_bytes,
                    video_mime_types=settings.storage_video_mime_types,
                    document_mime_types=settings.storage_document_mime_types),
        playback=auth,
    )


ResourceDependency = Annotated[LessonResourceService, Depends(get_resource_service)]

# catalog_access is applied per route: the content route accepts a playback token
# as well as a bearer header, so it authenticates through its own dependency.
router = APIRouter(tags=["lesson resources"],
                   dependencies=[Depends(no_cache)], responses={
    401: {"description": "Missing/invalid/expired credentials or playback token"},
    403: {"description": "MEMBER or ADMIN role required"},
    404: {"description": "Lesson, enrollment or stored file not found"},
    409: {"description": "Lesson kind cannot hold a stored file"},
    503: {"description": "Storage temporarily unavailable"},
})


def parse_range(header: str | None) -> ByteRange | None:
    """Accept a single well-formed byte range; anything else is a full read."""
    if not header or not (match := RANGE_HEADER.fullmatch(header.strip())):
        return None
    start, end = match.group(1), match.group(2)
    if not start:
        return None
    return ByteRange(start=int(start), end=int(end) if end else None)


def content_disposition(filename: str) -> str:
    """Encode the display name so a quote or non-ASCII byte cannot split headers."""
    return f"inline; filename*=UTF-8''{quote(filename, safe='')}"


@router.get("/lessons/{lesson_id}/resource", response_model=MemberResourceResponse)
async def lesson_resource(
    lesson_id: UUID, user: LearningUser, service: ResourceDependency,
) -> MemberResourceResponse:
    """Describe an enrolled member's lesson file, including where to download it.

    For VIDEO lessons the returned ``download_url`` already carries a short-lived
    playback token, so the client can hand it straight to a media element.
    """
    return await service.member_resource(user, lesson_id)


@router.get("/lessons/{lesson_id}/resource/content", response_class=StreamingResponse, responses={
    206: {"description": "Partial content for a satisfied Range request"},
    307: {"description": "Short-lived provider URL, when the provider issues one"},
})
async def lesson_resource_content(
    lesson_id: UUID, access: MediaUser, service: ResourceDependency,
    session: DatabaseSession,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
):
    """Relay the bytes after authorizing, or redirect when the provider allows it.

    Accepts either a bearer header (API clients) or the lesson-scoped
    ``playback_token`` a browser carries in the URL. The token establishes
    identity only: enrollment and resource rules below are unchanged, and a
    playback token may stream VIDEO lessons and nothing else.

    Providers that can mint short-lived URLs (S3-compatible object stores) are
    redirected to, so large files never traverse this process. Google Drive has
    no such URL for a private file, so the bytes are streamed in chunks and are
    never buffered whole.
    """
    resource, grant, stream = await service.content(
        access.user.id, lesson_id, parse_range(range_header), video_only=access.via_playback,
    )
    # Authorization is finished and nothing below reads the database, while the
    # body that follows can take as long as the member takes to watch. The
    # session is therefore closed here rather than by the dependency, which the
    # framework only unwinds once the whole response has been sent: holding it
    # would pin a pooled connection, idle in transaction, for the whole stream.
    await session.close()
    if stream is None:
        return RedirectResponse(grant.url, status_code=307, headers={"Cache-Control": "no-store"})
    headers = {
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "Content-Disposition": content_disposition(resource.original_filename),
    }
    if stream.content_range:
        headers["Content-Range"] = stream.content_range
    if stream.size_bytes is not None:
        headers["Content-Length"] = str(stream.size_bytes)
    return StreamingResponse(stream.chunks, media_type=stream.mime_type, headers=headers,
                             status_code=206 if stream.partial else 200)
