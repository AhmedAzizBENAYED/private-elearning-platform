"""Administrator upload, inspection and removal of a draft lesson's file."""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile

from app.api.v1.content_dependencies import admin_access, no_cache
from app.api.v1.resources import ResourceDependency
from app.schemas.resource import ResourceResponse
from app.services.resource_service import UploadPayload

router = APIRouter(prefix="/admin", tags=["admin lesson resources"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses={
    401: {"description": "Missing/invalid credentials or inactive account"},
    403: {"description": "ADMIN role required"},
    404: {"description": "Lesson or stored file not found"},
    409: {"description": "Course is not DRAFT, or the lesson kind holds no file"},
    413: {"description": "Upload exceeds the configured maximum size"},
    415: {"description": "Media type is not configured for this lesson kind"},
    422: {"description": "Invalid filename, extension or file content"},
    503: {"description": "Storage temporarily unavailable"},
})


async def stream_upload(upload: UploadFile, chunk_size: int):
    """Read the spooled upload in bounded chunks; the whole file never sits in RAM."""
    while chunk := await upload.read(chunk_size):
        yield chunk


@router.put("/lessons/{lesson_id}/resource", response_model=ResourceResponse)
async def upload_resource(
    lesson_id: UUID, request: Request, service: ResourceDependency,
    file: UploadFile = File(..., description="Video or document for this lesson"),
) -> ResourceResponse:
    """Store or replace a draft lesson's file.

    Idempotent by lesson: a lesson holds at most one resource, and a successful
    replacement removes the previous object only after the new one is committed.
    """
    return await service.upload(lesson_id, UploadPayload(
        filename=file.filename, mime_type=file.content_type,
        chunks=stream_upload(file, request.app.state.settings.storage_upload_chunk_bytes),
    ))


@router.get("/lessons/{lesson_id}/resource", response_model=ResourceResponse)
async def get_resource(lesson_id: UUID, service: ResourceDependency) -> ResourceResponse:
    """Stored metadata only; the provider is not contacted."""
    return await service.get(lesson_id)


@router.get("/courses/{course_id}/resources", response_model=list[ResourceResponse])
async def list_course_resources(course_id: UUID, service: ResourceDependency) -> list[ResourceResponse]:
    """Every stored file in a course, ordered by module then lesson, in one query."""
    return await service.list_for_course(course_id)


@router.delete("/lessons/{lesson_id}/resource", status_code=204)
async def delete_resource(lesson_id: UUID, service: ResourceDependency) -> Response:
    await service.delete(lesson_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
