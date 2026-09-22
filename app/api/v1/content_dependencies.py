"""Content service composition and reusable HTTP access policies."""

from typing import Annotated

from fastapi import Depends, Request, Response

from app.core.dependencies import require_role
from app.database.session import DatabaseSession
from app.models.user import User, UserRole
from app.repositories.course_repository import CourseRepository
from app.repositories.enrollment_repository import EnrollmentRepository
from app.repositories.module_repository import ModuleRepository
from app.repositories.lesson_repository import LessonRepository
from app.repositories.structure_repository import StructureRepository
from app.services.course_service import CourseService
from app.services.enrollment_service import EnrollmentService
from app.services.module_service import ModuleService
from app.services.lesson_service import LessonService
from app.services.structure_service import StructureService

admin_access = require_role(UserRole.ADMIN)
catalog_access = require_role(UserRole.MEMBER, UserRole.ADMIN)
AdminUser = Annotated[User, Depends(admin_access)]
#: The acting member (or admin) behind a catalog request. Enrollment-gated
#: reads need the caller's identity, not only their role.
CatalogUser = Annotated[User, Depends(catalog_access)]


def get_course_service(session: DatabaseSession, request: Request) -> CourseService:
    return CourseService(CourseRepository(session), request.app.state.storage)


CourseDependency = Annotated[CourseService, Depends(get_course_service)]


def get_module_service(session: DatabaseSession, courses: CourseDependency) -> ModuleService:
    return ModuleService(ModuleRepository(session), courses)


ModuleDependency = Annotated[ModuleService, Depends(get_module_service)]


def get_enrollment_service(session: DatabaseSession, courses: CourseDependency) -> EnrollmentService:
    return EnrollmentService(EnrollmentRepository(session), courses)


#: Composed here rather than in the enrollments router, because the lesson
#: service now needs it too and importing it from there would be a cycle.
EnrollmentDependency = Annotated[EnrollmentService, Depends(get_enrollment_service)]


def get_lesson_service(
    session: DatabaseSession, modules: ModuleDependency, enrollments: EnrollmentDependency,
) -> LessonService:
    return LessonService(LessonRepository(session), modules, enrollments)


LessonDependency = Annotated[LessonService, Depends(get_lesson_service)]


def get_structure_service(session: DatabaseSession, courses: CourseDependency) -> StructureService:
    return StructureService(StructureRepository(session), courses)


StructureDependency = Annotated[StructureService, Depends(get_structure_service)]


def no_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


CONTENT_ERRORS = {
    401: {"description": "Missing/invalid credentials or inactive account"},
    403: {"description": "Insufficient role"},
    404: {"description": "Resource not found or not visible"},
    409: {"description": "Duplicate slug/position or invalid lifecycle operation"},
    422: {"description": "Invalid request or content reference"},
    503: {"description": "Content storage unavailable"},
}
