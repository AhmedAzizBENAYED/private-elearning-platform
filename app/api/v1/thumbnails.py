"""Course thumbnail bytes, and the thumbnail service composition (BE-THUMBNAIL-UPLOAD-01).

The read route is deliberately unauthenticated: a thumbnail is shown by an
``<img>`` element, which cannot send a bearer header, and an external
``thumbnail_url`` has always been a public address too. What it serves is
narrow - only the *current* uploaded thumbnail of a course, addressed by a
random name the server generated - and it never lists, never reveals a
provider detail, and never serves anything but PNG or JPEG bytes.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse, StreamingResponse

from app.api.v1.content_dependencies import CourseDependency
from app.database.session import DatabaseSession
from app.services.thumbnail_service import CourseThumbnailService

#: The name ``request.url_for`` builds a stored ``thumbnail_url`` from.
THUMBNAIL_ROUTE = "course_thumbnail"


def get_thumbnail_service(courses: CourseDependency, request: Request) -> CourseThumbnailService:
    return CourseThumbnailService(courses, request.app.state.storage)


ThumbnailDependency = Annotated[CourseThumbnailService, Depends(get_thumbnail_service)]

router = APIRouter(tags=["course thumbnails"], responses={
    404: {"description": "No such course, or not its current uploaded thumbnail"},
    503: {"description": "Storage temporarily unavailable"},
})


@router.get("/course-thumbnails/{course_id}/{name}", name=THUMBNAIL_ROUTE,
            response_class=StreamingResponse, responses={
                200: {"content": {"image/png": {}, "image/jpeg": {}},
                      "description": "The image bytes"},
                307: {"description": "Short-lived provider URL, when the provider issues one"},
            })
async def course_thumbnail(course_id: UUID, name: str, service: ThumbnailDependency,
                           session: DatabaseSession):
    """Relay an uploaded thumbnail; its address changes whenever it is replaced."""
    mime_type, grant, stream = await service.content(course_id, name)
    # The lookup is done; the bytes that follow need no database. Closing here
    # returns the connection to the pool instead of holding it for the whole
    # response, which the dependency would only release at the very end.
    await session.close()
    if stream is None:
        return RedirectResponse(grant.url, status_code=307, headers={"Cache-Control": "no-store"})
    headers = {
        # The name changes with every upload, so a copy can never go stale; it
        # stays private so a shared cache does not outlive a removal.
        "Cache-Control": "private, max-age=3600",
        # Never let a browser reinterpret the bytes, or run them as a document.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": f'inline; filename="{name}"',
    }
    if stream.size_bytes is not None:
        headers["Content-Length"] = str(stream.size_bytes)
    return StreamingResponse(stream.chunks, media_type=mime_type, headers=headers)
