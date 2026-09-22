"""The whole ordered structure of a course, as one replaceable document."""

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.content import ContentInput
from app.schemas.lesson import LessonResponse
from app.schemas.module import ModuleResponse

#: Bounds on one request, so a structure write stays a bounded amount of work.
#: Far above any course the editor manages; lists elsewhere cap at 100 a page.
MAX_MODULES = 500
MAX_LESSONS_PER_MODULE = 1000


class StructureModuleOrder(ContentInput):
    """One module of the submitted structure and, in order, the lessons it holds."""

    id: UUID
    lesson_ids: Annotated[list[UUID], Field(max_length=MAX_LESSONS_PER_MODULE)]


class CourseStructureUpdate(ContentInput):
    """``PUT /admin/courses/{id}/structure``: every module of the course, in order.

    The list is the course's complete structure, not a patch: every module the
    course owns appears once, and every lesson of those modules appears once,
    under the module that is to hold it. Order is list order; there are no
    position fields to send (``extra="forbid"`` refuses them).
    """

    modules: Annotated[list[StructureModuleOrder], Field(max_length=MAX_MODULES)]

    @model_validator(mode="after")
    def no_duplicates(self) -> "CourseStructureUpdate":
        module_ids = [module.id for module in self.modules]
        if len(set(module_ids)) != len(module_ids):
            raise ValueError("A module may appear only once")
        lesson_ids = [lesson_id for module in self.modules for lesson_id in module.lesson_ids]
        if len(set(lesson_ids)) != len(lesson_ids):
            raise ValueError("A lesson may appear only once")
        return self


class StructureModuleResponse(ModuleResponse):
    """A module as ``GET /admin/modules/{id}`` returns it, with its lessons in order."""

    lessons: list[LessonResponse]


class CourseStructureResponse(BaseModel):
    """The course's structure as stored once the request has been applied."""

    course_id: UUID
    modules: list[StructureModuleResponse]
