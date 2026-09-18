"""Opt-in real multi-connection concurrency checks; requires manual migration.

This test commits UUID-isolated fixture rows so separate connections can see them,
then deletes only those fixture IDs in dependency order. It never applies migrations.
Use a development/test database; do not point this test at production.
"""

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.course import Course, CourseStatus
from app.models.enrollment import Enrollment
from app.models.lesson import ContentType, Lesson
from app.models.module import Module
from app.models.progress import Progress
from app.models.user import User, UserRole
from app.repositories.course_repository import CourseRepository
from app.repositories.enrollment_repository import EnrollmentRepository
from app.repositories.lesson_repository import LessonRepository
from app.repositories.module_repository import ModuleRepository
from app.repositories.progress_repository import ProgressRepository
from app.services.course_service import CourseService
from app.services.enrollment_service import EnrollmentService
from app.services.lesson_service import LessonService
from app.services.module_service import ModuleService
from app.services.progress_service import ProgressService

pytestmark = [pytest.mark.anyio, pytest.mark.integration,
              pytest.mark.skipif(not os.environ.get("TEST_LEARNING_DATABASE_URL"),
                                 reason="Set TEST_LEARNING_DATABASE_URL after manually applying a04d36e281cb.")]


@pytest.fixture
async def postgres_learning() -> AsyncIterator[tuple[async_sessionmaker[AsyncSession], UUID, UUID, list[UUID]]]:
    engine = create_async_engine(os.environ["TEST_LEARNING_DATABASE_URL"], hide_parameters=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    creator_id, member_id, course_id, module_id = (uuid4() for _ in range(4))
    lesson_ids = [uuid4(), uuid4()]
    try:
        async with engine.connect() as connection:
            ready = await connection.scalar(text("SELECT to_regclass('enrollments') IS NOT NULL AND to_regclass('progress') IS NOT NULL"))
            assert ready, "Manually apply revision a04d36e281cb before enabling this test."
        try:
            async with factory() as session:
                async with session.begin():
                    session.add_all([
                        User(id=creator_id, email=f"creator-{creator_id.hex}@example.com", first_name="Test", last_name="Creator",
                             role=UserRole.ADMIN, hashed_password="!integration-fixture"),
                        User(id=member_id, email=f"member-{member_id.hex}@example.com", first_name="Test", last_name="Member",
                             role=UserRole.MEMBER, hashed_password="!integration-fixture"),
                    ])
                    await session.flush()
                    session.add(Course(id=course_id, title="Concurrency fixture", slug="concurrency-" + course_id.hex,
                                       description="Temporary integration fixture", created_by=creator_id,
                                       status=CourseStatus.PUBLISHED, published_at=datetime.now(timezone.utc)))
                    await session.flush()
                    session.add(Module(id=module_id, course_id=course_id, title="Module", position=1))
                    await session.flush()
                    session.add_all([Lesson(id=lesson_id, module_id=module_id, title="Video", position=index + 1,
                                            content_type=ContentType.VIDEO, content="storage://fixture/video",
                                            duration_seconds=100) for index, lesson_id in enumerate(lesson_ids)])
            yield factory, member_id, course_id, lesson_ids
        finally:
            async with factory() as session:
                async with session.begin():
                    await session.execute(delete(Progress).where(Progress.user_id == member_id))
                    await session.execute(delete(Enrollment).where(Enrollment.user_id == member_id))
                    await session.execute(delete(Lesson).where(Lesson.id.in_(lesson_ids)))
                    await session.execute(delete(Module).where(Module.id == module_id))
                    await session.execute(delete(Course).where(Course.id == course_id))
                    await session.execute(delete(User).where(User.id.in_([creator_id, member_id])))
    finally:
        await engine.dispose()


def learning_services(session: AsyncSession, settings: Settings) -> tuple[EnrollmentService, ProgressService]:
    courses = CourseService(CourseRepository(session))
    modules = ModuleService(ModuleRepository(session), courses)
    lessons = LessonService(LessonRepository(session), modules)
    enrollments = EnrollmentService(EnrollmentRepository(session), courses)
    return enrollments, ProgressService(ProgressRepository(session), enrollments, lessons, settings)


async def test_concurrent_enrollment_and_final_video_completion(postgres_learning, settings: Settings) -> None:
    factory, member_id, course_id, lesson_ids = postgres_learning

    async def enroll_once():
        async with factory() as session:
            enrollments, _ = learning_services(session, settings)
            return await enrollments.enroll(member_id, course_id)

    enrollments = await asyncio.wait_for(asyncio.gather(*(enroll_once() for _ in range(4))), timeout=30)
    assert len({enrollment.id for enrollment in enrollments}) == 1

    async def watch_once(lesson_id: UUID, seconds: int):
        async with factory() as session:
            _, progress = learning_services(session, settings)
            return await progress.update(member_id, lesson_id, seconds)

    completed = await asyncio.wait_for(asyncio.gather(*(watch_once(lesson_id, 100) for lesson_id in lesson_ids)), timeout=30)
    assert all(row.completed for row in completed)
    async with factory() as session:
        enrollments_service, progress_service = learning_services(session, settings)
        course = await progress_service.course_progress(member_id, course_id)
        original = await enrollments_service.get(member_id, course_id)
        assert course.completed and course.progress_percent == 100 and original.completed_at is not None
    await asyncio.wait_for(asyncio.gather(watch_once(lesson_ids[0], 1), watch_once(lesson_ids[0], 100)), timeout=30)
    async with factory() as session:
        enrollments_service, progress_service = learning_services(session, settings)
        assert (await enrollments_service.get(member_id, course_id)).completed_at == original.completed_at
        assert (await progress_service.get(member_id, lesson_ids[0])).watched_seconds == 100
        assert await session.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.user_id == member_id)) == 1
        assert await session.scalar(select(func.count()).select_from(Progress).where(Progress.user_id == member_id)) == 2
