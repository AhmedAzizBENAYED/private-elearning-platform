"""Course creation, lifecycle transitions and catalog visibility."""

import hashlib
import logging
import re
import unicodedata
from datetime import datetime, timezone
from uuid import UUID

from app.core.exceptions import BusinessError
from app.models.course import Course, CourseStatus
from app.repositories.course_repository import CourseRepository
from app.schemas.course import (
    CatalogCourse, CatalogCourseListItem, CatalogEnrollmentCounts, CatalogListQuery, CatalogPage,
    CourseCreate, CourseListItem, CourseQuery, CourseResponse,
    CourseSort, CourseUpdate,
)
from app.schemas.pagination import Page
from app.services.content_rules import content_write, require_draft
from app.storage.base import StoragePort
from app.storage.exceptions import StorageError
from app.storage.models import ObjectRef

logger = logging.getLogger(__name__)


def generate_slug(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:200].rstrip("-")
    # Preserve deterministic behavior for titles without ASCII characters.
    return slug or "course-" + hashlib.sha256(title.encode()).hexdigest()[:16]


def detach_thumbnail(course: Course) -> ObjectRef | None:
    """Forget the course's uploaded thumbnail object, returning it for deletion.

    ``None`` when the thumbnail is an external URL, or there is none. The row is
    only changed in memory: the caller commits, then deletes the object.
    """
    if course.thumbnail_storage_key is None or course.thumbnail_provider_reference is None:
        return None
    ref = ObjectRef(storage_key=course.thumbnail_storage_key,
                    provider_reference=course.thumbnail_provider_reference)
    course.thumbnail_storage_provider = None
    course.thumbnail_storage_key = None
    course.thumbnail_provider_reference = None
    return ref


async def discard_thumbnail(storage: StoragePort | None, ref: ObjectRef, reason: str) -> None:
    """Best-effort cleanup after a commit; an orphan is logged, never raised."""
    try:
        if storage is None:
            raise StorageError("No storage adapter")
        await storage.delete(ref)
    except StorageError:
        logger.error("Orphaned storage object after %s", reason,
                     extra={"storage_key": ref.storage_key})


class CourseService:
    def __init__(self, courses: CourseRepository, storage: StoragePort | None = None) -> None:
        self.courses = courses
        # Only needed to delete an uploaded thumbnail that a PATCH replaces.
        self.storage = storage

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

    async def list(self, query: CourseQuery) -> Page[CourseListItem]:
        rows, total = await self.courses.list_with_counts(
            query.page, query.page_size, query.search, query.status,
            newest_first=query.sort is CourseSort.CREATED_DESC,
        )
        items = [
            CourseListItem(**CourseResponse.model_validate(course).model_dump(),
                           module_count=modules, lesson_count=lessons)
            for course, modules, lessons in rows
        ]
        return Page[CourseListItem](items=items, total=total,
                                    page=query.page, page_size=query.page_size)

    async def catalog_list(self, user_id: UUID, query: CatalogListQuery) -> CatalogPage:
        """The published catalogue as ``user_id`` sees it (G04, G05)."""
        enrollment = None if query.enrollment is None else query.enrollment.value
        rows, counts = await self.courses.catalog_page(
            user_id, query.page, query.page_size, query.search, enrollment,
        )
        items = [
            CatalogCourseListItem(**CatalogCourse.model_validate(course).model_dump(),
                                  module_count=modules, total_video_lessons=videos)
            for course, modules, videos in rows
        ]
        return CatalogPage(items=items, total=counts[enrollment or "all"],
                           page=query.page, page_size=query.page_size,
                           enrollment_counts=CatalogEnrollmentCounts(**counts))

    async def update(self, course_id: UUID, payload: CourseUpdate) -> CourseResponse:
        released: ObjectRef | None = None
        async with content_write(self.courses.session, "Course slug already in use"):
            course = await self.require_course(course_id, lock=True)
            require_draft(course)
            values = payload.model_dump(mode="json", exclude_unset=True)
            # Removing or replacing an uploaded thumbnail by URL frees its file;
            # sending the same URL back leaves it where it is.
            if "thumbnail_url" in values and values["thumbnail_url"] != course.thumbnail_url:
                released = detach_thumbnail(course)
            for field, value in values.items():
                setattr(course, field, value)
            await self.courses.save(course)
            result = CourseResponse.model_validate(course)
        if released is not None:
            await discard_thumbnail(self.storage, released, "a removed thumbnail")
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
