"""Administrator lesson metadata/content reference management."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.v1.content_dependencies import CONTENT_ERRORS, LessonDependency, admin_access, no_cache
from app.schemas.lesson import LessonCreate, LessonResponse, LessonUpdate
from app.schemas.pagination import Page, Pagination

router = APIRouter(prefix="/admin", tags=["admin lessons"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses=CONTENT_ERRORS)


@router.post("/modules/{module_id}/lessons", response_model=LessonResponse, status_code=201)
async def create_lesson(module_id: UUID, payload: LessonCreate, service: LessonDependency) -> LessonResponse:
    return await service.create(module_id, payload)


@router.get("/modules/{module_id}/lessons", response_model=Page[LessonResponse])
async def list_lessons(module_id: UUID, query: Annotated[Pagination, Query()], service: LessonDependency) -> Page[LessonResponse]:
    return await service.list(module_id, query)


@router.get("/lessons/{lesson_id}", response_model=LessonResponse)
async def get_lesson(lesson_id: UUID, service: LessonDependency) -> LessonResponse:
    return await service.get(lesson_id)


@router.patch("/lessons/{lesson_id}", response_model=LessonResponse)
async def update_lesson(lesson_id: UUID, payload: LessonUpdate, service: LessonDependency) -> LessonResponse:
    return await service.update(lesson_id, payload)


@router.delete("/lessons/{lesson_id}", status_code=204)
async def delete_lesson(lesson_id: UUID, service: LessonDependency) -> Response:
    await service.delete(lesson_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
