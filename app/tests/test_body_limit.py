"""QA-FIX SEC-01: the request body is bounded before authentication runs.

FastAPI reads an endpoint's body before resolving its dependencies, so the
``Depends(admin_access)`` on the two upload routes cannot stop a body from being
received. These tests drive the real application over ASGI with a body the test
itself produces, counting the bytes the server actually pulled - which is the
only way to tell "refused after reading it all" from "refused without reading".
"""

from collections.abc import AsyncIterator
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.body_limit import (
    MULTIPART_OVERHEAD_BYTES,
    UNCREDENTIALED_BODY_BYTES,
    RequestBodyLimitMiddleware,
)
from app.storage.memory import InMemoryStorage
from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_courses import COURSES, create_course, create_lesson, create_module, enforce_foreign_keys, member_headers
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

BOUNDARY = "----qa-fix-body-limit"
CHUNK = b"x" * (256 * 1024)
MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64


@pytest.fixture
def storage(application) -> InMemoryStorage:
    application.state.storage = InMemoryStorage()
    return application.state.storage


class Counted:
    """A multipart body the test streams itself, counting what was pulled."""

    def __init__(self, chunks: int, payload: bytes = CHUNK) -> None:
        self.chunks = chunks
        self.payload = payload
        self.sent = 0

    @property
    def head(self) -> bytes:
        return (f"--{BOUNDARY}\r\n"
                'Content-Disposition: form-data; name="file"; filename="big.mp4"\r\n'
                "Content-Type: video/mp4\r\n\r\n").encode()

    @property
    def tail(self) -> bytes:
        return f"\r\n--{BOUNDARY}--\r\n".encode()

    def __aiter__(self) -> AsyncIterator[bytes]:
        return self._stream()

    async def _stream(self) -> AsyncIterator[bytes]:
        for part in (self.head, *[self.payload] * self.chunks, self.tail):
            self.sent += len(part)
            yield part


async def send_streamed(client: AsyncClient, url: str, body: Counted, headers: dict | None = None):
    """PUT a multipart body with no declared length, as a chunked client does."""
    return await client.put(
        url, content=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}", **(headers or {})},
    )


def lesson_path(lesson_id: str) -> str:
    return f"/api/v1/admin/lessons/{lesson_id}/resource"


@pytest.fixture
async def video_lesson(auth_client, admin_headers) -> dict:
    course = await create_course(auth_client, admin_headers, title="Limit " + uuid4().hex,
                                 description="A course for the body limit")
    module = await create_module(auth_client, admin_headers, course["id"], title="M1", position=1)
    return await create_lesson(auth_client, admin_headers, module["id"], title="Video",
                               position=1, content_type="VIDEO", content="storage://placeholder")


# --------------------------------------------------------------- the ceiling

async def test_an_anonymous_upload_under_the_limit_is_refused_by_the_router(auth_client, video_lesson):
    """Small and unauthenticated: the 401 is still the router's, unchanged."""
    body = Counted(chunks=1)
    response = await send_streamed(auth_client, lesson_path(video_lesson["id"]), body)

    assert response.status_code == 401, response.text
    assert response.json() == {"detail": "Invalid authentication credentials"}


async def test_an_anonymous_upload_over_the_limit_is_cut_off_before_it_is_read(auth_client, video_lesson):
    """The reported defect: 32 MiB used to be received in full before the 401."""
    body = Counted(chunks=128)  # 32 MiB
    response = await send_streamed(auth_client, lesson_path(video_lesson["id"]), body)

    assert response.status_code == 413, response.text
    assert response.json() == {"detail": "Request body exceeds the maximum size"}
    # The proof: the server stopped pulling a little past the ceiling instead of
    # spooling the whole 32 MiB.
    assert body.sent <= UNCREDENTIALED_BODY_BYTES + len(CHUNK) + 1024, body.sent
    assert body.sent < 32 * 1024 * 1024


async def test_a_declared_length_over_the_limit_is_refused_without_reading_anything(
    auth_client, video_lesson,
):
    """With a Content-Length, the answer is decided from the headers alone."""
    body = Counted(chunks=128)
    response = await auth_client.put(
        lesson_path(video_lesson["id"]),
        content=b"".join([body.head] + [CHUNK] * 8 + [body.tail]),
        headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}",
                 "Content-Length": str(64 * 1024 * 1024)},
    )

    assert response.status_code == 413, response.text


async def test_a_length_that_lies_is_still_caught_while_the_body_arrives(auth_client, video_lesson):
    """A small declared length does not buy an unlimited body."""
    body = Counted(chunks=32)  # 8 MiB behind a 10-byte claim
    response = await auth_client.put(
        lesson_path(video_lesson["id"]), content=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}",
                 "Content-Length": "10"},
    )

    assert response.status_code in (400, 413), response.text
    assert body.sent < 8 * 1024 * 1024


async def test_the_thumbnail_route_is_bounded_the_same_way(auth_client, admin_headers, storage):
    course = await create_course(auth_client, admin_headers, title="Cover " + uuid4().hex,
                                 description="A course with a cover")
    body = Counted(chunks=128)
    response = await send_streamed(auth_client, f"{COURSES}/{course['id']}/thumbnail", body)

    assert response.status_code == 413, response.text
    assert body.sent < 32 * 1024 * 1024


async def test_a_credentialed_caller_keeps_the_configured_ceiling(
    auth_client, admin_headers, application, video_lesson,
):
    """An administrator's budget is the configured upload maximum, not 1 MiB."""
    middleware = RequestBodyLimitMiddleware(lambda *_: None,
                                            max_body_bytes=application.state.settings.storage_max_upload_bytes
                                            + MULTIPART_OVERHEAD_BYTES)
    credentialed = {"type": "http", "headers": [(b"authorization", b"Bearer x")], "query_string": b""}
    anonymous = {"type": "http", "headers": [], "query_string": b""}

    assert middleware.limit_for(credentialed) > UNCREDENTIALED_BODY_BYTES
    assert middleware.limit_for(anonymous) == UNCREDENTIALED_BODY_BYTES
    # And in the real application: 4 MiB with credentials is not refused by the
    # gate - the router answers on its own merits.
    body = Counted(chunks=16)
    response = await send_streamed(auth_client, lesson_path(video_lesson["id"]), body, admin_headers)
    assert response.status_code != 413, response.text


# ------------------------------------------------- the legitimate paths hold

async def test_a_valid_resource_upload_is_unchanged(auth_client, admin_headers, storage, video_lesson):
    response = await auth_client.put(lesson_path(video_lesson["id"]), headers=admin_headers,
                                     files={"file": ("lesson.mp4", MP4, "video/mp4")})

    assert response.status_code == 200, response.text
    stored = response.json()
    assert stored["filename"] == "lesson.mp4"
    # Every byte arrived: the gate did not truncate a legitimate upload.
    assert stored["size_bytes"] == len(MP4)


async def test_a_valid_thumbnail_upload_is_unchanged(auth_client, admin_headers, storage):
    from app.tests.test_course_thumbnail import PNG

    course = await create_course(auth_client, admin_headers, title="Cover " + uuid4().hex,
                                 description="A course with a cover")
    response = await auth_client.put(f"{COURSES}/{course['id']}/thumbnail", headers=admin_headers,
                                     files={"file": ("cover.png", PNG, "image/png")})

    assert response.status_code == 200, response.text
    assert response.json()["thumbnail_url"].endswith(".png")


async def test_ordinary_requests_are_untouched(auth_client, admin_headers):
    """JSON bodies, reads and the public routes all behave as before."""
    assert (await auth_client.get("/api/v1/health")).status_code == 200
    assert (await auth_client.post("/api/v1/auth/login",
                                   json={"email": "nobody@example.com", "password": "x"})).status_code == 401
    assert (await auth_client.get(COURSES, headers=admin_headers)).status_code == 200


async def test_the_gate_sits_outside_the_router(application):
    """It must wrap routing, or the body would already have been read."""
    names = [middleware.cls.__name__ for middleware in application.user_middleware]

    assert "RequestBodyLimitMiddleware" in names
    # CORS stays outside it, so a refused upload still answers a browser.
    assert names.index("CORSMiddleware") < names.index("RequestBodyLimitMiddleware")
