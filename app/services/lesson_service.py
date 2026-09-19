"""Lesson content validation and draft-only mutations."""

import re
from uuid import UUID

from pydantic import HttpUrl, TypeAdapter, ValidationError

from app.core.exceptions import BusinessError
from app.models.lesson import ContentType, Lesson
from app.repositories.lesson_repository import LessonRepository
from app.schemas.lesson import CatalogLesson, CatalogLessonContent, LessonCreate, LessonResponse, LessonUpdate
from app.schemas.pagination import Page, Pagination
from app.services.content_rules import content_write
from app.services.module_service import ModuleService

_http_url = TypeAdapter(HttpUrl)
_storage_reference = re.compile(r"^storage://[A-Za-z0-9][A-Za-z0-9._/-]*$")
# Lesson kinds whose content is a stored-file reference rather than readable text.
STORED_CONTENT_TYPES = frozenset({ContentType.VIDEO, ContentType.DOCUMENT})


def validate_content(content_type: ContentType, content: str, duration_seconds: int | None) -> None:
    if not content.strip():
        raise BusinessError(422, "Lesson content must not be blank")
    if content_type != ContentType.VIDEO and duration_seconds is not None:
        raise BusinessError(422, "duration_seconds is only allowed for VIDEO lessons")
    if content_type == ContentType.TEXT:
        return
    if len(content) > 2048 or any(character.isspace() or ord(character) < 32 for character in content):
        raise BusinessError(422, "Content reference must be at most 2048 characters without whitespace")
    if content_type in {ContentType.VIDEO, ContentType.DOCUMENT} and _storage_reference.fullmatch(content):
        if all(part not in {".", "..", ""} for part in content.removeprefix("storage://").split("/")):
            return
    try:
        if not content.startswith(("http://", "https://")) or "\\" in content:
            raise ValueError("An absolute HTTP(S) URL is required")
        url = _http_url.validate_python(content)
        if url.username is not None or url.password is not None:
            raise ValueError("URL credentials are not allowed")
    except (ValidationError, ValueError):
        raise BusinessError(422, "Content requires an HTTP(S) URL or, for VIDEO/DOCUMENT, a storage:// reference") from None


class LessonService:
    def __init__(self, lessons: LessonRepository, modules: ModuleService) -> None:
        self.lessons = lessons
        self.modules = modules

    async def require_lesson(self, lesson_id: UUID, *, published: bool = False) -> Lesson:
        lesson = await self.lessons.get(lesson_id, published=published)
        if lesson is None:
            raise BusinessError(404, "Lesson not found")
        return lesson

    async def _editable_lesson(self, lesson_id: UUID) -> Lesson:
        lesson = await self.require_lesson(lesson_id)
        await self.modules.editable_module(lesson.module_id)
        return await self.require_lesson(lesson_id)

    async def create(self, module_id: UUID, payload: LessonCreate) -> LessonResponse:
        validate_content(payload.content_type, payload.content, payload.duration_seconds)
        async with content_write(self.lessons.session, "Lesson position already in use in this module"):
            await self.modules.editable_module(module_id)
            lesson = await self.lessons.save(Lesson(module_id=module_id, **payload.model_dump()))
            result = LessonResponse.model_validate(lesson)
        return result

    async def get(self, lesson_id: UUID) -> LessonResponse:
        return LessonResponse.model_validate(await self.require_lesson(lesson_id))

    async def catalog_get(self, lesson_id: UUID) -> CatalogLessonContent:
        """Member lesson detail; stored-file references never leave this boundary."""
        lesson = await self.require_lesson(lesson_id, published=True)
        projection = CatalogLessonContent.model_validate(lesson)
        if lesson.content_type in STORED_CONTENT_TYPES:
            projection.content = None
        return projection

    async def list(self, module_id: UUID, query: Pagination) -> Page[LessonResponse]:
        await self.modules.require_module(module_id)
        rows, total = await self.lessons.list(module_id, query.page, query.page_size)
        return Page[LessonResponse](items=[LessonResponse.model_validate(row) for row in rows],
                                    total=total, page=query.page, page_size=query.page_size)

    async def catalog_list(self, module_id: UUID, query: Pagination) -> Page[CatalogLesson]:
        await self.modules.require_module(module_id, published=True)
        rows, total = await self.lessons.list(module_id, query.page, query.page_size, published=True)
        return Page[CatalogLesson](items=[CatalogLesson.model_validate(row) for row in rows],
                                   total=total, page=query.page, page_size=query.page_size)

    async def update(self, lesson_id: UUID, payload: LessonUpdate) -> LessonResponse:
        async with content_write(self.lessons.session, "Lesson position already in use in this module"):
            lesson = await self._editable_lesson(lesson_id)
            changes = payload.model_dump(exclude_unset=True)
            validate_content(changes.get("content_type", lesson.content_type),
                             changes.get("content", lesson.content),
                             changes.get("duration_seconds", lesson.duration_seconds))
            for field, value in changes.items():
                setattr(lesson, field, value)
            await self.lessons.save(lesson)
            result = LessonResponse.model_validate(lesson)
        return result

    async def delete(self, lesson_id: UUID) -> None:
        async with content_write(self.lessons.session, "Lesson is still referenced"):
            await self.lessons.delete(await self._editable_lesson(lesson_id))
