"""Authenticated published catalog with safe, separate content projections."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.v1.content_dependencies import (
    CONTENT_ERRORS, CatalogUser, CourseDependency, LessonDependency, ModuleDependency,
    catalog_access, no_cache,
)
from app.schemas.course import CatalogCourse, CatalogListQuery, CatalogPage
from app.schemas.lesson import CatalogLesson, CatalogLessonContent
from app.schemas.module import CatalogModule
from app.schemas.pagination import Page, Pagination

router = APIRouter(tags=["member course catalog"],
                   dependencies=[Depends(catalog_access), Depends(no_cache)], responses=CONTENT_ERRORS)


@router.get("/courses", response_model=CatalogPage)
async def catalog(
    query: Annotated[CatalogListQuery, Query()], user: CatalogUser, service: CourseDependency,
) -> CatalogPage:
    """Published courses for active members/admins, with their size and the caller's tab counts.

    ``enrollment`` keeps only the caller's ``not_enrolled``, ``in_progress`` or
    ``completed`` courses, and ``total`` counts that filtered set.
    ``enrollment_counts`` sizes every tab for the same ``search``, whatever
    ``enrollment`` and the page are. Each item adds ``module_count`` and
    ``total_video_lessons`` to the course fields ``GET /courses/{id}`` returns.
    """
    return await service.catalog_list(user.id, query)


@router.get("/courses/{course_id}", response_model=CatalogCourse)
async def course(course_id: UUID, service: CourseDependency) -> CatalogCourse:
    return await service.catalog_get(course_id)


@router.get("/courses/{course_id}/modules", response_model=Page[CatalogModule])
async def modules(course_id: UUID, query: Annotated[Pagination, Query()], service: ModuleDependency) -> Page[CatalogModule]:
    return await service.catalog_list(course_id, query)


@router.get("/modules/{module_id}/lessons", response_model=Page[CatalogLesson])
async def lessons(module_id: UUID, query: Annotated[Pagination, Query()], service: LessonDependency) -> Page[CatalogLesson]:
    """Lesson metadata only; content is retrieved through the lesson detail endpoint."""
    return await service.catalog_list(module_id, query)


@router.get("/lessons/{lesson_id}", response_model=CatalogLessonContent)
async def lesson(lesson_id: UUID, user: CatalogUser, service: LessonDependency) -> CatalogLessonContent:
    """A published lesson's content, for a member enrolled in its course.

    Enrollment is required here as it already is for the course tree and for
    stored files, and for the same reason: the lesson body is the course. The
    outline endpoints above stay open to any signed-in member, which is what
    lets someone decide whether to enroll - metadata, never content.

    `is_preview` grants no exemption. It is a presentation flag: nothing in the
    service layer has ever read it for authorization, and a security fix is not
    the place to give it a new meaning.
    """
    return await service.catalog_get(user.id, lesson_id)
