"""Administrator course metadata and explicit lifecycle operations."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.v1.content_dependencies import AdminUser, CONTENT_ERRORS, CourseDependency, admin_access, no_cache
from app.schemas.course import CourseCreate, CourseQuery, CourseResponse, CourseUpdate
from app.schemas.pagination import Page

router = APIRouter(prefix="/admin/courses", tags=["admin courses"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses=CONTENT_ERRORS)


@router.post("", response_model=CourseResponse, status_code=201)
async def create_course(payload: CourseCreate, service: CourseDependency, admin: AdminUser) -> CourseResponse:
    """Create a DRAFT owned by the authenticated administrator."""
    return await service.create(payload, admin.id)


@router.get("", response_model=Page[CourseResponse])
async def list_courses(query: Annotated[CourseQuery, Query()], service: CourseDependency) -> Page[CourseResponse]:
    return await service.list(query)


@router.get("/{course_id}", response_model=CourseResponse)
async def get_course(course_id: UUID, service: CourseDependency) -> CourseResponse:
    return await service.get(course_id)


@router.patch("/{course_id}", response_model=CourseResponse)
async def update_course(course_id: UUID, payload: CourseUpdate, service: CourseDependency) -> CourseResponse:
    """Update draft metadata; status/ownership/timestamps are never client-editable."""
    return await service.update(course_id, payload)


@router.post("/{course_id}/publish", response_model=CourseResponse)
async def publish_course(course_id: UUID, service: CourseDependency) -> CourseResponse:
    """Publish a draft once; repeated publication preserves timestamps."""
    return await service.publish(course_id)


@router.post("/{course_id}/archive", response_model=CourseResponse)
async def archive_course(course_id: UUID, service: CourseDependency) -> CourseResponse:
    """Archive a published course; archived courses cannot be restored."""
    return await service.archive(course_id)
