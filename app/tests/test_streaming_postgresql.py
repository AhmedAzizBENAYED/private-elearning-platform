"""Opt-in: streaming a stored file must not hold a PostgreSQL connection.

FastAPI unwinds a request's dependencies only once the whole response has been
sent (``routing.py``: ``await response(scope, receive, send)`` runs inside the
dependency exit stack). A route that authorizes against the database and then
returns a ``StreamingResponse`` therefore keeps its session - and its open read
transaction - for as long as the member takes to watch the video. These tests
prove the two streaming routes release it first, by looking at
``pg_stat_activity`` from a separate connection *while the body is in flight*.

Set ``TEST_STREAMING_DATABASE_URL`` to a **throwaway** migrated database to run
them; they create and delete only their own rows.
"""

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from uuid import uuid4

import asyncpg
import pytest
import uvicorn
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.models.course import Course, CourseStatus
from app.models.enrollment import Enrollment
from app.models.lesson import ContentType, Lesson
from app.models.module import Module
from app.models.resource import LessonResource
from app.models.user import User, UserRole
from app.storage.base import StoragePort
from app.storage.models import (
    AccessGrant, AccessKind, ByteRange, ObjectMetadata, ObjectRef, ObjectStream, StorageProvider,
    StoredObject,
)

DATABASE_URL = os.environ.get("TEST_STREAMING_DATABASE_URL")

pytestmark = [pytest.mark.anyio, pytest.mark.integration,
              pytest.mark.skipif(not DATABASE_URL,
                                 reason="Set TEST_STREAMING_DATABASE_URL to a throwaway migrated database.")]

PASSWORD = "Throwaway-stream-1"
#: A port of this machine, for the throwaway server these tests run.
PORT = 8731
CHUNK = b"m" * 4096


def raw_url(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://")


class GatedStorage(StoragePort):
    """A provider whose stream pauses between chunks, on the test's command."""

    provider = StorageProvider.MEMORY

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.chunks_sent = 0

    async def upload(self, storage_key, chunks, *, filename, mime_type) -> StoredObject:
        raise NotImplementedError

    async def metadata(self, ref: ObjectRef) -> ObjectMetadata:
        raise NotImplementedError

    async def exists(self, ref: ObjectRef) -> bool:
        return True

    async def access(self, ref: ObjectRef) -> AccessGrant:
        return AccessGrant(kind=AccessKind.STREAM)

    async def open(self, ref: ObjectRef, byte_range: ByteRange | None = None) -> ObjectStream:
        return ObjectStream(mime_type="video/mp4", size_bytes=len(CHUNK) * 2, chunks=self._chunks())

    async def _chunks(self) -> AsyncIterator[bytes]:
        yield CHUNK
        self.chunks_sent += 1
        # The body is now in flight: the test inspects the database here.
        self.started.set()
        await self.release.wait()
        yield CHUNK
        self.chunks_sent += 1

    async def delete(self, ref: ObjectRef) -> None:
        return None


@pytest.fixture
async def world():
    """A member enrolled in a published course with one VIDEO lesson and a file."""
    settings = Settings(_env_file=None, environment="development", database_url=DATABASE_URL,
                        jwt_secret_key="throwaway-streaming-key-" * 3, storage_provider="memory")
    from app.core.security import hash_password
    from app.main import create_app

    ids = {name: uuid4() for name in ("member", "course", "module", "lesson", "resource")}
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            async with session.begin():
                session.add(User(id=ids["member"], email=f"stream-{ids['member'].hex}@example.com",
                                 first_name="Sarra", last_name="Mansour", role=UserRole.MEMBER,
                                 hashed_password=hash_password(PASSWORD)))
                await session.flush()
                session.add(Course(id=ids["course"], title=f"Streaming {ids['course'].hex}",
                                   slug=f"streaming-{ids['course'].hex}", description="d",
                                   created_by=ids["member"], status=CourseStatus.PUBLISHED,
                                   published_at=datetime.now(timezone.utc)))
                await session.flush()
                session.add(Module(id=ids["module"], course_id=ids["course"], title="M1", position=1))
                await session.flush()
                session.add(Lesson(id=ids["lesson"], module_id=ids["module"], title="V1", position=1,
                                   content_type=ContentType.VIDEO, content="storage://v",
                                   duration_seconds=100))
                await session.flush()
                session.add(LessonResource(
                    id=ids["resource"], lesson_id=ids["lesson"], storage_provider=StorageProvider.MEMORY,
                    storage_key=f"courses/{ids['course']}/videos/{uuid4()}.mp4",
                    provider_reference=str(uuid4()), original_filename="v1.mp4",
                    mime_type="video/mp4", file_size_bytes=len(CHUNK) * 2))
                session.add(Enrollment(user_id=ids["member"], course_id=ids["course"]))

        # A real server, because httpx's ASGI transport buffers a response
        # whole: only an actual socket lets the test hold a body open and look
        # at the database while it is still being sent.
        app = create_app(settings)
        storage = GatedStorage()
        config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning")
        server = uvicorn.Server(config)
        serving = asyncio.create_task(server.serve())
        try:
            while not server.started:
                await asyncio.sleep(0.05)
            app.state.storage = storage
            yield f"http://127.0.0.1:{PORT}", storage, ids
        finally:
            server.should_exit = True
            await serving
    finally:
        async with factory() as session:
            async with session.begin():
                await session.execute(delete(LessonResource).where(LessonResource.id == ids["resource"]))
                await session.execute(delete(Enrollment).where(Enrollment.user_id == ids["member"]))
                await session.execute(delete(Lesson).where(Lesson.id == ids["lesson"]))
                await session.execute(delete(Module).where(Module.id == ids["module"]))
                await session.execute(delete(Course).where(Course.id == ids["course"]))
                await session.execute(delete(User).where(User.id == ids["member"]))
        await engine.dispose()


async def open_transactions(database: str) -> list[str]:
    """Connections of this database sitting inside a transaction, right now."""
    connection = await asyncpg.connect(raw_url(DATABASE_URL))
    try:
        rows = await connection.fetch(
            "SELECT state, query FROM pg_stat_activity "
            "WHERE datname = current_database() AND pid <> pg_backend_pid() "
            "AND state IN ('idle in transaction', 'idle in transaction (aborted)')")
        return [f"{row['state']}: {row['query'][:80]}" for row in rows]
    finally:
        await connection.close()


async def member_headers(client: AsyncClient, ids) -> dict:
    response = await client.post("/api/v1/auth/login", json={
        "email": f"stream-{ids['member'].hex}@example.com", "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def test_the_session_is_released_before_the_bytes_start(world):
    base_url, storage, ids = world
    async with AsyncClient(base_url=base_url) as client:
        headers = await member_headers(client, ids)

        # A lesson file is authorized and streamed.
        async with client.stream("GET", f"/api/v1/lessons/{ids['lesson']}/resource/content",
                                 headers=headers) as response:
            assert response.status_code == 200, response.text
            reader = response.aiter_bytes()
            first = await anext(reader)
            assert first == CHUNK

            # The body is in flight and paused. Nothing may be holding a
            # transaction open: that is the whole point of the fix.
            await asyncio.wait_for(storage.started.wait(), timeout=5)
            held = await open_transactions(DATABASE_URL)
            assert held == [], held

            storage.release.set()
            rest = b"".join([chunk async for chunk in reader])
            assert rest == CHUNK

    assert storage.chunks_sent == 2
    # And nothing is left behind once the response is over.
    assert await open_transactions(DATABASE_URL) == []


async def test_an_unauthorized_reader_is_still_refused(world):
    base_url, storage, ids = world
    async with AsyncClient(base_url=base_url) as client:
        anonymous = await client.get(f"/api/v1/lessons/{ids['lesson']}/resource/content")
        assert anonymous.status_code == 401

        headers = await member_headers(client, ids)
        unknown = await client.get(f"/api/v1/lessons/{uuid4()}/resource/content", headers=headers)
        assert unknown.status_code == 404

    assert storage.chunks_sent == 0
    assert await open_transactions(DATABASE_URL) == []


async def test_a_thumbnail_streams_without_holding_a_connection(world):
    base_url, storage, ids = world
    name = f"{uuid4()}.png"
    engine = create_async_engine(DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        async with session.begin():
            course = await session.get(Course, ids["course"])
            course.thumbnail_storage_provider = StorageProvider.MEMORY
            course.thumbnail_storage_key = f"courses/{ids['course']}/thumbnails/{name}"
            course.thumbnail_provider_reference = str(uuid4())
            course.thumbnail_url = f"http://api.local/api/v1/course-thumbnails/{ids['course']}/{name}"
    await engine.dispose()

    async with AsyncClient(base_url=base_url) as client:
        async with client.stream("GET", f"/api/v1/course-thumbnails/{ids['course']}/{name}") as response:
            assert response.status_code == 200, response.text
            reader = response.aiter_bytes()
            assert await anext(reader) == CHUNK

            await asyncio.wait_for(storage.started.wait(), timeout=5)
            assert await open_transactions(DATABASE_URL) == []

            storage.release.set()
            assert b"".join([chunk async for chunk in reader]) == CHUNK
