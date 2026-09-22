"""Administrator upload of a draft course's thumbnail (BE-THUMBNAIL-UPLOAD-01)."""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, UploadFile

from app.api.v1.admin.resources import stream_upload
from app.api.v1.content_dependencies import admin_access, no_cache
from app.api.v1.thumbnails import THUMBNAIL_ROUTE, ThumbnailDependency
from app.schemas.course import CourseResponse
from app.services.resource_service import UploadPayload

router = APIRouter(prefix="/admin/courses", tags=["admin courses"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses={
    401: {"description": "Missing/invalid credentials or inactive account"},
    403: {"description": "ADMIN role required"},
    404: {"description": "Course not found"},
    409: {"description": "Course is not DRAFT"},
    413: {"description": "Image exceeds 5 MiB"},
    415: {"description": "Declared type is not image/png or image/jpeg"},
    422: {"description": "Missing, empty, corrupt or oversized-dimension image"},
    503: {"description": "Storage or database temporarily unavailable"},
})


@router.put("/{course_id}/thumbnail", response_model=CourseResponse)
async def upload_thumbnail(
    course_id: UUID, request: Request, service: ThumbnailDependency,
    file: UploadFile = File(..., description="PNG or JPEG image, at most 5 MiB"),
) -> CourseResponse:
    """Store an image and make it the draft course's ``thumbnail_url``.

    Replaces any previous thumbnail, uploaded or external; the previous uploaded
    file is removed only after the course points at the new one. Every other
    course field is left as it was. Returns the updated course.
    """
    def public_url(name: str) -> str:
        return str(request.url_for(THUMBNAIL_ROUTE, course_id=str(course_id), name=name))

    return await service.upload(course_id, UploadPayload(
        filename=file.filename, mime_type=file.content_type,
        chunks=stream_upload(file, request.app.state.settings.storage_upload_chunk_bytes),
    ), public_url)
