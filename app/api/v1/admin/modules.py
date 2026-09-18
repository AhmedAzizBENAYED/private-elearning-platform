"""Administrator module management."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.v1.content_dependencies import CONTENT_ERRORS, ModuleDependency, admin_access, no_cache
from app.schemas.module import ModuleCreate, ModuleResponse, ModuleUpdate
from app.schemas.pagination import Page, Pagination

router = APIRouter(prefix="/admin", tags=["admin modules"],
                   dependencies=[Depends(admin_access), Depends(no_cache)], responses=CONTENT_ERRORS)


@router.post("/courses/{course_id}/modules", response_model=ModuleResponse, status_code=201)
async def create_module(course_id: UUID, payload: ModuleCreate, service: ModuleDependency) -> ModuleResponse:
    return await service.create(course_id, payload)


@router.get("/courses/{course_id}/modules", response_model=Page[ModuleResponse])
async def list_modules(course_id: UUID, query: Annotated[Pagination, Query()], service: ModuleDependency) -> Page[ModuleResponse]:
    return await service.list(course_id, query)


@router.get("/modules/{module_id}", response_model=ModuleResponse)
async def get_module(module_id: UUID, service: ModuleDependency) -> ModuleResponse:
    return await service.get(module_id)


@router.patch("/modules/{module_id}", response_model=ModuleResponse)
async def update_module(module_id: UUID, payload: ModuleUpdate, service: ModuleDependency) -> ModuleResponse:
    return await service.update(module_id, payload)


@router.delete("/modules/{module_id}", status_code=204)
async def delete_module(module_id: UUID, service: ModuleDependency) -> Response:
    """Delete a draft module and its lessons in one transaction."""
    await service.delete(module_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
