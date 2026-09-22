"""Administrator reorganisation of a course's modules and lessons, in one transaction."""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.v1.content_dependencies import CONTENT_ERRORS, StructureDependency, admin_access, no_cache
from app.schemas.structure import CourseStructureResponse, CourseStructureUpdate

router = APIRouter(prefix="/admin", tags=["admin course structure"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses=CONTENT_ERRORS)


@router.put("/courses/{course_id}/structure", response_model=CourseStructureResponse)
async def replace_structure(
    course_id: UUID, payload: CourseStructureUpdate, service: StructureDependency,
) -> CourseStructureResponse:
    """Reorder a draft course's modules and lessons, and move lessons between its modules.

    The body lists every module of the course, in order, each with every lesson
    it is to hold, in order. Positions become 1..n in that order. The whole
    change is one transaction: it all applies, or nothing does.

    409 when the course is not a DRAFT, or when the body is not exactly the
    course's current structure (an element missing, unknown, or from another
    course); 422 for a malformed body, including a repeated module or lesson.
    """
    return await service.replace(course_id, payload)
