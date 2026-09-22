"""Atomic reorganisation of a draft course: module order, lesson order, lesson moves."""

from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.lesson import Lesson
from app.models.module import Module
from app.repositories.structure_repository import StructureRepository
from app.schemas.lesson import LessonResponse
from app.schemas.module import ModuleResponse
from app.schemas.structure import CourseStructureResponse, CourseStructureUpdate, StructureModuleResponse
from app.services.content_rules import content_write, require_draft
from app.services.course_service import CourseService

#: One answer for every submitted structure that is not exactly the course's:
#: an element missing, unknown, or belonging to another course. The same words
#: whichever it is, so the endpoint never confirms that an identifier exists
#: somewhere else.
STRUCTURE_MISMATCH = "The submitted structure does not match the course; reload it and try again"


def free_positions(used: set[int], count: int) -> list[int]:
    """``count`` positive integers, lowest first, none of them in ``used``.

    The staging positions of the first pass. Taken from the bottom of the range
    rather than above the highest position in use, so they can never exceed the
    column's integer range whatever positions the course holds.
    """
    free: list[int] = []
    candidate = 1
    while len(free) < count:
        if candidate not in used:
            free.append(candidate)
        candidate += 1
    return free


class StructureService:
    """``PUT /admin/courses/{id}/structure``.

    The positions of a parent are unique (``uq_modules_course_position``,
    ``uq_lessons_module_position``), checked row by row as each UPDATE runs,
    and must stay positive. So two rows cannot trade places in one step - that
    is why reordering through ``PATCH`` takes three requests. Here the whole
    reorganisation is one transaction of two passes:

    1. every row that moves goes to a staging position no row holds and no row
       is headed for - and a lesson that changes module goes to its new module;
    2. every row that moved takes its final position, 1..n in the submitted
       order, each of which is free by then.

    Either both passes commit or neither does. Rows already in place are not
    written at all.
    """

    def __init__(self, structure: StructureRepository, courses: CourseService) -> None:
        self.structure = structure
        self.courses = courses

    async def replace(self, course_id: UUID, payload: CourseStructureUpdate) -> CourseStructureResponse:
        async with content_write(self.structure.session, STRUCTURE_MISMATCH):
            # The course row lock every content write takes first: this request
            # and any create, edit, delete, publish or other reorganisation of
            # the course run one after the other, and the snapshot read below is
            # the one the writes apply to.
            require_draft(await self.courses.require_course(course_id, lock=True))
            modules = await self.structure.modules(course_id)
            lessons = await self.structure.lessons([module.id for module in modules])

            submitted_lessons = {lesson_id for order in payload.modules for lesson_id in order.lesson_ids}
            if ({module.id for module in modules} != {order.id for order in payload.modules}
                    or {lesson.id for lesson in lessons} != submitted_lessons):
                raise BusinessError(409, STRUCTURE_MISMATCH)

            module_targets = {order.id: index for index, order in enumerate(payload.modules, start=1)}
            lesson_targets = {lesson_id: (order.id, index)
                              for order in payload.modules
                              for index, lesson_id in enumerate(order.lesson_ids, start=1)}
            moving_modules = [m for m in modules if m.position != module_targets[m.id]]
            moving_lessons = [l for l in lessons if (l.module_id, l.position) != lesson_targets[l.id]]

            await self._stage(modules, lessons, moving_modules, moving_lessons, lesson_targets)
            await self._settle(moving_modules, moving_lessons, module_targets, lesson_targets)

            result = await self._read(course_id)
        return result

    async def _stage(
        self, modules: list[Module], lessons: list[Lesson], moving_modules: list[Module],
        moving_lessons: list[Lesson], lesson_targets: dict[UUID, tuple[UUID, int]],
    ) -> None:
        """Pass 1: every moving row to a position nothing holds or will hold."""
        used = {module.position for module in modules} | set(range(1, len(modules) + 1))
        for module, position in zip(moving_modules, free_positions(used, len(moving_modules))):
            module.position = position

        # One pool for the whole course, so a lesson arriving in another module
        # cannot land on a position any lesson of the course holds or will hold.
        longest = max((position for _, position in lesson_targets.values()), default=0)
        used = {lesson.position for lesson in lessons} | set(range(1, longest + 1))
        for lesson, position in zip(moving_lessons, free_positions(used, len(moving_lessons))):
            lesson.module_id = lesson_targets[lesson.id][0]
            lesson.position = position
        await self.structure.flush()

    async def _settle(
        self, moving_modules: list[Module], moving_lessons: list[Lesson],
        module_targets: dict[UUID, int], lesson_targets: dict[UUID, tuple[UUID, int]],
    ) -> None:
        """Pass 2: every moving row to its final position, free since pass 1."""
        for module in moving_modules:
            module.position = module_targets[module.id]
        for lesson in moving_lessons:
            lesson.position = lesson_targets[lesson.id][1]
        await self.structure.flush()

    async def _read(self, course_id: UUID) -> CourseStructureResponse:
        """The structure as the database now holds it, timestamps included."""
        modules = await self.structure.modules(course_id)
        lessons = await self.structure.lessons([module.id for module in modules])
        by_module: dict[UUID, list[LessonResponse]] = {module.id: [] for module in modules}
        for lesson in sorted(lessons, key=lambda row: (row.position, row.id)):
            by_module[lesson.module_id].append(LessonResponse.model_validate(lesson))
        return CourseStructureResponse(course_id=course_id, modules=[
            StructureModuleResponse(**ModuleResponse.model_validate(module).model_dump(), lessons=by_module[module.id])
            for module in modules
        ])
