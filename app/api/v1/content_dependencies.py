"""Content service composition and reusable HTTP access policies."""

from typing import Annotated

from fastapi import Depends, Response

from app.core.dependencies import require_role
from app.database.session import DatabaseSession
from app.models.user import User, UserRole
from app.repositories.course_repository import CourseRepository
from app.repositories.module_repository import ModuleRepository
from app.repositories.lesson_repository import LessonRepository
from app.services.course_service import CourseService
from app.services.module_service import ModuleService
from app.services.lesson_service import LessonService

admin_access = require_role(UserRole.ADMIN)
catalog_access = require_role(UserRole.MEMBER, UserRole.ADMIN)
AdminUser = Annotated[User, Depends(admin_access)]


def get_course_service(session: DatabaseSession) -> CourseService:
    return CourseService(CourseRepository(session))


CourseDependency = Annotated[CourseService, Depends(get_course_service)]


def get_module_service(session: DatabaseSession, courses: CourseDependency) -> ModuleService:
    return ModuleService(ModuleRepository(session), courses)


ModuleDependency = Annotated[ModuleService, Depends(get_module_service)]


def get_lesson_service(session: DatabaseSession, modules: ModuleDependency) -> LessonService:
    return LessonService(LessonRepository(session), modules)


LessonDependency = Annotated[LessonService, Depends(get_lesson_service)]


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
