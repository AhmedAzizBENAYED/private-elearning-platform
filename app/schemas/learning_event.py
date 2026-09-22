"""Learning-event contracts (BE-LEARNING-TRACKING-01).

A client says only *what* it opened. There is no field for the user nor for the
time - both are the server's - and ``extra="forbid"`` refuses one sent anyway,
so a request cannot even try to speak for someone else or for another moment.
``lesson_completed`` is not accepted here: it is written by the server when a
VIDEO lesson's progress completes.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID

from app.models.learning_event import LearningEventType


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: UUID


class CourseOpened(_Event):
    type: Literal["course_opened"]


class ModuleOpened(_Event):
    type: Literal["module_opened"]
    module_id: UUID


class LessonOpened(_Event):
    type: Literal["lesson_opened"]
    module_id: UUID
    lesson_id: UUID


LearningEventCreate = Annotated[CourseOpened | ModuleOpened | LessonOpened, Field(discriminator="type")]


class LearningEventResponse(BaseModel):
    id: UUID
    type: LearningEventType
    course_id: UUID
    module_id: UUID | None
    lesson_id: UUID | None
    occurred_at: datetime
