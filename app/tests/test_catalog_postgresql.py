"""Opt-in catalog lifecycle against an already migrated PostgreSQL database.

Never creates a schema or applies migrations. All test rows remain inside an outer
transaction and are rolled back, including service-level commits via savepoints.
"""

import os
from uuid import UUID, uuid4

import pytest
from anyio import CapacityLimiter
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import Settings
from app.database.session import get_db_session
from app.models.lesson import Lesson
from app.models.user import User, UserRole
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService

pytestmark = [pytest.mark.integration, pytest.mark.anyio,
              pytest.mark.skipif(not os.environ.get("TEST_CATALOG_DATABASE_URL"),
                                 reason="Set TEST_CATALOG_DATABASE_URL after manually applying the catalog migration.")]


async def test_postgresql_catalog_lifecycle_and_cascade(settings: Settings) -> None:
    from app.main import create_app

    engine = create_async_engine(os.environ["TEST_CATALOG_DATABASE_URL"], hide_parameters=True)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                ready = await connection.scalar(text(
                    "SELECT to_regclass('courses') IS NOT NULL AND to_regclass('modules') IS NOT NULL "
                    "AND to_regclass('lessons') IS NOT NULL"
                ))
                assert ready, "Apply Alembic revision f93c25d170ba manually before enabling this test."
                async with AsyncSession(bind=connection, expire_on_commit=False,
                                        join_transaction_mode="create_savepoint") as session:
                    admin = User(email=f"catalog-test-{uuid4().hex}@example.com", first_name="Catalog",
                                 last_name="Test", role=UserRole.ADMIN, hashed_password="!test-account")
                    session.add(admin)
                    await session.flush()
                    token = AuthService(settings, UserRepository(session), CapacityLimiter(1)).issue_tokens(admin).access_token
                    application = create_app(settings)

                    async def test_session():
                        yield session

                    application.dependency_overrides[get_db_session] = test_session
                    headers = {"Authorization": f"Bearer {token}"}
                    async with application.router.lifespan_context(application):
                        async with AsyncClient(transport=ASGITransport(app=application), base_url="http://test",
                                               headers=headers) as client:
                            created = await client.post("/api/v1/admin/courses", json={
                                "title": "Integration course", "description": "Rollback-only test",
                                "slug": "integration-" + uuid4().hex,
                            })
                            assert created.status_code == 201, created.text
                            course_id = created.json()["id"]
                            module = await client.post(f"/api/v1/admin/courses/{course_id}/modules", json={"title": "Module", "position": 1})
                            assert module.status_code == 201
                            module_id = module.json()["id"]
                            lesson = await client.post(f"/api/v1/admin/modules/{module_id}/lessons", json={
                                "title": "Lesson", "position": 1, "content_type": "TEXT", "content": "Hello",
                            })
                            assert lesson.status_code == 201
                            assert (await client.delete(f"/api/v1/admin/modules/{module_id}")).status_code == 204
                            assert await session.scalar(select(func.count()).select_from(Lesson).where(
                                Lesson.id == UUID(lesson.json()["id"])
                            )) == 0
                            published = await client.post(f"/api/v1/admin/courses/{course_id}/publish")
                            assert published.status_code == 200 and published.json()["published_at"] is not None
                            assert (await client.post(f"/api/v1/admin/courses/{course_id}/publish")).json() == published.json()
                            assert (await client.get(f"/api/v1/courses/{course_id}")).status_code == 200
                            assert (await client.post(f"/api/v1/admin/courses/{course_id}/archive")).status_code == 200
                            assert (await client.get(f"/api/v1/courses/{course_id}")).status_code == 404
                            assert (await client.post(f"/api/v1/admin/courses/{course_id}/publish")).status_code == 409
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
