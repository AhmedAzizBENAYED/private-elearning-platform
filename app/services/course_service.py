"""Course creation, lifecycle transitions and catalog visibility."""

import hashlib
import re
import unicodedata
from datetime import datetime, timezone
from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.course import Course, CourseStatus
from app.repositories.course_repository import CourseRepository
from app.schemas.course import CatalogCourse, CatalogQuery, CourseCreate, CourseQuery, CourseResponse, CourseUpdate
from app.schemas.pagination import Page
from app.services.content_rules import content_write, require_draft


def generate_slug(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:200].rstrip("-")
    # Preserve deterministic behavior for titles without ASCII characters.
    return slug or "course-" + hashlib.sha256(title.encode()).hexdigest()[:16]


class CourseService:
    def __init__(self, courses: CourseRepository) -> None:
        self.courses = courses

    async def require_course(self, course_id: UUID, *, lock: bool = False, published: bool = False) -> Course:
        course = await self.courses.get(course_id, lock=lock, published=published)
        if course is None:
            raise BusinessError(404, "Course not found")
        return course

    async def create(self, payload: CourseCreate, creator_id: UUID) -> CourseResponse:
        async with content_write(self.courses.session, "Course slug already in use"):
            if not await self.courses.active_admin_exists(creator_id):
                raise BusinessError(403, "Course creator must be an active administrator")
            values = payload.model_dump(mode="json")
            values["slug"] = payload.slug or generate_slug(payload.title)
            course = await self.courses.save(Course(**values, created_by=creator_id, status=CourseStatus.DRAFT))
            result = CourseResponse.model_validate(course)
        return result

    async def get(self, course_id: UUID) -> CourseResponse:
        return CourseResponse.model_validate(await self.require_course(course_id))

    async def catalog_get(self, course_id: UUID) -> CatalogCourse:
        return CatalogCourse.model_validate(await self.require_course(course_id, published=True))

    async def list(self, query: CourseQuery) -> Page[CourseResponse]:
        rows, total = await self.courses.list(query.page, query.page_size, query.search, query.status)
        return Page[CourseResponse](items=[CourseResponse.model_validate(row) for row in rows],
                                    total=total, page=query.page, page_size=query.page_size)

    async def catalog_list(self, query: CatalogQuery) -> Page[CatalogCourse]:
        rows, total = await self.courses.list(query.page, query.page_size, query.search, CourseStatus.PUBLISHED)
        return Page[CatalogCourse](items=[CatalogCourse.model_validate(row) for row in rows],
                                   total=total, page=query.page, page_size=query.page_size)

    async def update(self, course_id: UUID, payload: CourseUpdate) -> CourseResponse:
        async with content_write(self.courses.session, "Course slug already in use"):
            course = await self.require_course(course_id, lock=True)
            require_draft(course)
            for field, value in payload.model_dump(mode="json", exclude_unset=True).items():
                setattr(course, field, value)
            await self.courses.save(course)
            result = CourseResponse.model_validate(course)
        return result

    async def publish(self, course_id: UUID) -> CourseResponse:
        return await self._transition(course_id, CourseStatus.PUBLISHED)

    async def archive(self, course_id: UUID) -> CourseResponse:
        return await self._transition(course_id, CourseStatus.ARCHIVED)

    async def _transition(self, course_id: UUID, target: CourseStatus) -> CourseResponse:
        async with content_write(self.courses.session, "Course lifecycle conflict"):
            course = await self.require_course(course_id, lock=True)
            if course.status != target:
                required = CourseStatus.DRAFT if target == CourseStatus.PUBLISHED else CourseStatus.PUBLISHED
                if course.status != required:
                    raise BusinessError(409, f"Cannot transition {course.status.value} to {target.value}")
                course.status = target
                if target == CourseStatus.PUBLISHED:
                    course.published_at = datetime.now(timezone.utc)
                else:
                    course.archived_at = datetime.now(timezone.utc)
                await self.courses.save(course)
            result = CourseResponse.model_validate(course)
        return result
