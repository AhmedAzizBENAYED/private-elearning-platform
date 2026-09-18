"""Authenticated published catalog with safe, separate content projections."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.v1.content_dependencies import (
    CONTENT_ERRORS, CourseDependency, LessonDependency, ModuleDependency, catalog_access, no_cache,
)
from app.schemas.course import CatalogCourse, CatalogQuery
from app.schemas.lesson import CatalogLesson, CatalogLessonContent
from app.schemas.module import CatalogModule
from app.schemas.pagination import Page, Pagination

router = APIRouter(tags=["member course catalog"],
                   dependencies=[Depends(catalog_access), Depends(no_cache)], responses=CONTENT_ERRORS)


@router.get("/courses", response_model=Page[CatalogCourse])
async def catalog(query: Annotated[CatalogQuery, Query()], service: CourseDependency) -> Page[CatalogCourse]:
    """Published courses for active members/admins; enrollment restrictions are future work."""
    return await service.catalog_list(query)


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
async def lesson(lesson_id: UUID, service: LessonDependency) -> CatalogLessonContent:
    """Published lesson content; is_preview does not bypass authentication."""
    return await service.catalog_get(lesson_id)
