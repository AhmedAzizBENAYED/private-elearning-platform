"""Module operations serialized with their parent course lifecycle."""

from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.module import Module
from app.repositories.module_repository import ModuleRepository
from app.schemas.module import CatalogModule, ModuleCreate, ModuleResponse, ModuleUpdate
from app.schemas.pagination import Page, Pagination
from app.services.content_rules import content_write, require_draft
from app.services.course_service import CourseService


class ModuleService:
    def __init__(self, modules: ModuleRepository, courses: CourseService) -> None:
        self.modules = modules
        self.courses = courses

    async def require_module(self, module_id: UUID, *, published: bool = False) -> Module:
        module = await self.modules.get(module_id, published=published)
        if module is None:
            raise BusinessError(404, "Module not found")
        return module

    async def editable_module(self, module_id: UUID) -> Module:
        module = await self.require_module(module_id)
        course = await self.courses.require_course(module.course_id, lock=True)
        require_draft(course)
        # A competing delete may have completed while waiting for the course lock.
        return await self.require_module(module_id)

    async def create(self, course_id: UUID, payload: ModuleCreate) -> ModuleResponse:
        async with content_write(self.modules.session, "Module position already in use in this course"):
            require_draft(await self.courses.require_course(course_id, lock=True))
            module = await self.modules.save(Module(course_id=course_id, **payload.model_dump()))
            result = ModuleResponse.model_validate(module)
        return result

    async def get(self, module_id: UUID) -> ModuleResponse:
        return ModuleResponse.model_validate(await self.require_module(module_id))

    async def list(self, course_id: UUID, query: Pagination) -> Page[ModuleResponse]:
        await self.courses.require_course(course_id)
        rows, total = await self.modules.list(course_id, query.page, query.page_size)
        return Page[ModuleResponse](items=[ModuleResponse.model_validate(row) for row in rows],
                                    total=total, page=query.page, page_size=query.page_size)

    async def catalog_list(self, course_id: UUID, query: Pagination) -> Page[CatalogModule]:
        await self.courses.require_course(course_id, published=True)
        rows, total = await self.modules.list(course_id, query.page, query.page_size, published=True)
        return Page[CatalogModule](items=[CatalogModule.model_validate(row) for row in rows],
                                   total=total, page=query.page, page_size=query.page_size)

    async def update(self, module_id: UUID, payload: ModuleUpdate) -> ModuleResponse:
        async with content_write(self.modules.session, "Module position already in use in this course"):
            module = await self.editable_module(module_id)
            for field, value in payload.model_dump(exclude_unset=True).items():
                setattr(module, field, value)
            await self.modules.save(module)
            result = ModuleResponse.model_validate(module)
        return result

    async def delete(self, module_id: UUID) -> None:
        async with content_write(self.modules.session, "Module is still referenced"):
            await self.modules.delete(await self.editable_module(module_id))
