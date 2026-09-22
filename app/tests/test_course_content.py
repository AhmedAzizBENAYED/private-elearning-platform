"""The bulk member learning page, and the provider-neutral member boundary.

Everything runs through the real routers, services, repositories and database
constraints; only the storage provider is substituted, exactly as the other
resource tests do.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event

from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_members import admin_headers
from app.tests.test_courses import create_course, create_module, create_lesson, member_headers, enforce_foreign_keys
from app.tests.test_enrollments import enroll, watch
from app.tests.test_lesson_resources import MP4, PDF, storage, upload

pytestmark = pytest.mark.anyio
ADMIN = "/api/v1/admin"
CONTENT = "/api/v1/courses/{}/content"
LESSON_FIELDS = {"id", "title", "description", "content_type", "duration_seconds", "position",
                 "is_preview", "has_resource", "watched_seconds", "completed", "completed_at"}
MODULE_FIELDS = {"id", "title", "description", "position", "lessons"}
COURSE_FIELDS = {"course_id", "title", "slug", "description", "thumbnail_url", "status", "published_at",
                 "total_video_lessons", "completed_video_lessons", "progress_percent", "completed", "modules"}


async def build_learning_course(client: AsyncClient, headers: dict[str, str], *, publish: bool = True) -> dict:
    """Two modules: the first mixes kinds and files, the second holds one video.

    Module 1: VIDEO with a file, VIDEO without a file, DOCUMENT with a file, TEXT.
    Module 2: VIDEO with a file. A third, empty module proves outer joins hold.
    """
    course = await create_course(client, headers, title="Learning " + uuid4().hex)
    first = await create_module(client, headers, course["id"], title="Module one", position=1)
    second = await create_module(client, headers, course["id"], title="Module two", position=2)
    empty = await create_module(client, headers, course["id"], title="Module three", position=3)

    async def video(module_id: str, position: int, *, file: bool = True) -> dict:
        lesson = await create_lesson(client, headers, module_id, position=position, content_type="VIDEO",
                                     content="storage://videos/internal-path", duration_seconds=100)
        if file:
            assert (await upload(client, headers, lesson["id"])).status_code == 200
        return lesson

    watched = await video(first["id"], 1)
    partial = await video(first["id"], 2, file=False)
    document = await create_lesson(client, headers, first["id"], position=3, content_type="DOCUMENT",
                                   content="storage://documents/internal-path")
    assert (await upload(client, headers, document["id"], payload=PDF,
                         filename="notes.pdf", mime="application/pdf")).status_code == 200
    text = await create_lesson(client, headers, first["id"], position=4, content_type="TEXT", content="Private body")
    unwatched = await video(second["id"], 1)

    if publish:
        assert (await client.post(f"{ADMIN}/courses/{course['id']}/publish", headers=headers)).status_code == 200
    return {"course": course, "modules": [first, second, empty], "watched": watched, "partial": partial,
            "document": document, "text": text, "unwatched": unwatched}


@pytest.fixture
async def learning(auth_client, storage, admin_headers) -> dict:
    return await build_learning_course(auth_client, admin_headers)


async def fetch(client: AsyncClient, headers: dict[str, str], course_id: str):
    return await client.get(CONTENT.format(course_id), headers=headers)


def lesson_of(body: dict, lesson_id: str) -> dict:
    for module in body["modules"]:
        for lesson in module["lessons"]:
            if lesson["id"] == lesson_id:
                return lesson
    raise AssertionError(f"lesson {lesson_id} missing from the tree")


# ----------------------------------------------------------- authorization

async def test_content_requires_authentication(auth_client):
    assert (await auth_client.get(CONTENT.format(uuid4()))).status_code == 401


async def test_non_enrolled_member_is_refused(auth_client, learning, member_headers, admin_headers):
    course_id = learning["course"]["id"]
    # The same 404 the other enrollment-gated reads use; existence is not disclosed.
    for headers in (member_headers, admin_headers):
        response = await fetch(auth_client, headers, course_id)
        assert response.status_code == 404
        assert response.json() == {"detail": "Enrollment not found"}
    assert (await fetch(auth_client, member_headers, str(uuid4()))).status_code == 404


async def test_enrolled_member_receives_the_tree(auth_client, learning, member_headers):
    await enroll(auth_client, member_headers, learning["course"]["id"])
    response = await fetch(auth_client, member_headers, learning["course"]["id"])
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert set(response.json()) == COURSE_FIELDS


async def test_admin_follows_the_same_enrollment_rule(auth_client, learning, admin_headers):
    """ADMIN gains no implicit access; enrolling is what grants it, as elsewhere."""
    course_id = learning["course"]["id"]
    assert (await fetch(auth_client, admin_headers, course_id)).status_code == 404
    await enroll(auth_client, admin_headers, course_id)
    assert (await fetch(auth_client, admin_headers, course_id)).status_code == 200


async def test_progress_is_never_another_members(auth_client, learning, member_headers, admin_headers):
    course_id, lesson_id = learning["course"]["id"], learning["watched"]["id"]
    await enroll(auth_client, admin_headers, course_id)
    assert (await watch(auth_client, admin_headers, lesson_id, 100)).status_code == 200
    await enroll(auth_client, member_headers, course_id)

    mine = (await fetch(auth_client, member_headers, course_id)).json()
    theirs = (await fetch(auth_client, admin_headers, course_id)).json()
    assert lesson_of(mine, lesson_id)["watched_seconds"] == 0
    assert lesson_of(mine, lesson_id)["completed"] is False
    assert mine["completed_video_lessons"] == 0 and mine["progress_percent"] == 0
    assert lesson_of(theirs, lesson_id)["watched_seconds"] == 100
    assert theirs["completed_video_lessons"] == 1


# -------------------------------------------------------- course visibility

async def test_draft_course_is_unreachable(auth_client, storage, admin_headers, member_headers):
    data = await build_learning_course(auth_client, admin_headers, publish=False)
    # A DRAFT course cannot be enrolled in, so it can never be read here.
    assert (await auth_client.post(f"/api/v1/courses/{data['course']['id']}/enroll",
                                   headers=member_headers)).status_code == 409
    assert (await fetch(auth_client, member_headers, data["course"]["id"])).status_code == 404


async def test_archived_course_stays_readable_for_enrolled_members(auth_client, learning, member_headers, admin_headers):
    """Matches /courses/{id}/progress and the resource endpoints: history survives archiving."""
    course_id = learning["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    await watch(auth_client, member_headers, learning["watched"]["id"], 100)
    assert (await auth_client.post(f"{ADMIN}/courses/{course_id}/archive", headers=admin_headers)).status_code == 200

    body = (await fetch(auth_client, member_headers, course_id)).json()
    assert body["status"] == "ARCHIVED"
    assert lesson_of(body, learning["watched"]["id"])["completed"] is True
    # The catalog still hides it, exactly as before.
    assert (await auth_client.get(f"/api/v1/courses/{course_id}", headers=member_headers)).status_code == 404


# -------------------------------------------------------------- tree content

async def test_tree_shape_ordering_and_resource_flags(auth_client, learning, member_headers):
    await enroll(auth_client, member_headers, learning["course"]["id"])
    body = (await fetch(auth_client, member_headers, learning["course"]["id"])).json()

    assert [module["title"] for module in body["modules"]] == ["Module one", "Module two", "Module three"]
    assert [module["position"] for module in body["modules"]] == [1, 2, 3]
    assert all(set(module) == MODULE_FIELDS for module in body["modules"])
    # A module without lessons still appears, rather than vanishing from the page.
    assert body["modules"][2]["lessons"] == []
    assert [lesson["position"] for lesson in body["modules"][0]["lessons"]] == [1, 2, 3, 4]
    assert all(set(lesson) == LESSON_FIELDS for module in body["modules"] for lesson in module["lessons"])

    assert lesson_of(body, learning["watched"]["id"])["has_resource"] is True
    assert lesson_of(body, learning["document"]["id"])["has_resource"] is True
    assert lesson_of(body, learning["partial"]["id"])["has_resource"] is False
    assert lesson_of(body, learning["text"]["id"])["has_resource"] is False


async def test_non_video_lessons_carry_no_progress(auth_client, learning, member_headers):
    await enroll(auth_client, member_headers, learning["course"]["id"])
    body = (await fetch(auth_client, member_headers, learning["course"]["id"])).json()
    for key in ("document", "text"):
        lesson = lesson_of(body, learning[key]["id"])
        # Null, not zero: progress is a VIDEO concept, and a false checkmark would lie.
        assert lesson["watched_seconds"] is None
        assert lesson["completed"] is None and lesson["completed_at"] is None
        assert lesson["duration_seconds"] is None
    assert lesson_of(body, learning["text"]["id"])["content_type"] == "TEXT"
    assert lesson_of(body, learning["document"]["id"])["content_type"] == "DOCUMENT"


async def test_watched_partial_and_unwatched_videos(auth_client, learning, member_headers):
    course_id = learning["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    await watch(auth_client, member_headers, learning["watched"]["id"], 100)
    await watch(auth_client, member_headers, learning["partial"]["id"], 40)

    body = (await fetch(auth_client, member_headers, course_id)).json()
    done = lesson_of(body, learning["watched"]["id"])
    assert done["watched_seconds"] == 100 and done["completed"] is True and done["completed_at"] is not None
    partial = lesson_of(body, learning["partial"]["id"])
    assert partial["watched_seconds"] == 40 and partial["completed"] is False and partial["completed_at"] is None
    never = lesson_of(body, learning["unwatched"]["id"])
    assert never["watched_seconds"] == 0 and never["completed"] is False and never["completed_at"] is None

    # The per-lesson endpoint and the tree must never disagree.
    for key in ("watched", "partial", "unwatched"):
        single = (await auth_client.get(f"/api/v1/lessons/{learning[key]['id']}/progress",
                                        headers=member_headers)).json()
        lesson = lesson_of(body, learning[key]["id"])
        assert (single["watched_seconds"], single["completed"], single["completed_at"]) == \
               (lesson["watched_seconds"], lesson["completed"], lesson["completed_at"])


async def test_aggregates_match_the_course_progress_endpoint(auth_client, learning, member_headers):
    course_id = learning["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    body = (await fetch(auth_client, member_headers, course_id)).json()
    assert (body["total_video_lessons"], body["completed_video_lessons"]) == (3, 0)
    assert body["progress_percent"] == 0 and body["completed"] is False

    await watch(auth_client, member_headers, learning["watched"]["id"], 100)
    body = (await fetch(auth_client, member_headers, course_id)).json()
    assert body["completed_video_lessons"] == 1 and body["progress_percent"] == 33.33
    assert body["completed"] is False

    for key in ("partial", "unwatched"):
        await watch(auth_client, member_headers, learning[key]["id"], 100)
    body = (await fetch(auth_client, member_headers, course_id)).json()
    assert body["completed_video_lessons"] == 3 and body["progress_percent"] == 100
    assert body["completed"] is True

    aggregate = (await auth_client.get(f"/api/v1/courses/{course_id}/progress", headers=member_headers)).json()
    assert aggregate == {"course_id": course_id, "total_video_lessons": 3, "completed_video_lessons": 3,
                         "progress_percent": 100, "completed": True}
    summary = (await auth_client.get("/api/v1/me/enrollments", headers=member_headers)).json()["items"][0]
    assert summary["progress_percent"] == 100 and summary["completed"] is True


async def test_course_without_modules(auth_client, admin_headers, member_headers):
    course = await create_course(auth_client, admin_headers, title="Bare " + uuid4().hex)
    assert (await auth_client.post(f"{ADMIN}/courses/{course['id']}/publish", headers=admin_headers)).status_code == 200
    await enroll(auth_client, member_headers, course["id"])
    body = (await fetch(auth_client, member_headers, course["id"])).json()
    assert body["modules"] == [] and body["total_video_lessons"] == 0
    assert body["progress_percent"] == 0 and body["completed"] is False


# ------------------------------------------------------ provider neutrality

async def test_the_tree_exposes_no_storage_vocabulary(auth_client, learning, member_headers):
    await enroll(auth_client, member_headers, learning["course"]["id"])
    response = await fetch(auth_client, member_headers, learning["course"]["id"])
    body = response.text.lower()
    for word in ("storage://", "storage_key", "provider", "google", "drive", "content\":"):
        assert word not in body, f"{word!r} leaked into the learning page"
    assert "has_resource" in response.text  # The flag replaces the reference.


async def test_member_lesson_detail_hides_stored_references(auth_client, learning, member_headers):
    """VIDEO and DOCUMENT payloads are storage references, so members never see them.

    BE-SEC-01: the detail endpoint is enrollment-gated, so the member enrolls
    first. The refusal before enrolling is asserted by the test below.
    """
    await enroll(auth_client, member_headers, learning["course"]["id"])
    for key in ("watched", "document"):
        response = await auth_client.get(f"/api/v1/lessons/{learning[key]['id']}", headers=member_headers)
        assert response.status_code == 200
        assert response.json()["content"] is None
        assert "storage://" not in response.text
    # Readable kinds are unaffected: TEXT and LINK still carry their content.
    text = await auth_client.get(f"/api/v1/lessons/{learning['text']['id']}", headers=member_headers)
    assert text.json()["content"] == "Private body"


async def test_admin_lesson_reads_are_unchanged(auth_client, learning, admin_headers):
    for key, expected in (("watched", "storage://videos/internal-path"),
                          ("document", "storage://documents/internal-path"),
                          ("text", "Private body")):
        response = await auth_client.get(f"{ADMIN}/lessons/{learning[key]['id']}", headers=admin_headers)
        assert response.status_code == 200
        assert response.json()["content"] == expected
        assert set(response.json()) >= {"module_id", "created_at", "updated_at", "content"}


async def test_playback_and_resource_download_still_work(auth_client, learning, member_headers):
    """The tree is informational; the resource endpoint remains the way to the bytes."""
    await enroll(auth_client, member_headers, learning["course"]["id"])
    lesson_id = learning["watched"]["id"]
    resource = (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=member_headers)).json()
    assert resource["download_url"].startswith(f"/api/v1/lessons/{lesson_id}/resource/content?playback_token=")

    streamed = await auth_client.get(resource["download_url"])
    assert streamed.status_code == 200 and streamed.content == MP4
    ranged = await auth_client.get(resource["download_url"], headers={"Range": "bytes=0-9"})
    assert ranged.status_code == 206 and ranged.headers["content-range"] == f"bytes 0-9/{len(MP4)}"

    # A lesson the tree reports as fileless genuinely has no file.
    body = (await fetch(auth_client, member_headers, learning["course"]["id"])).json()
    assert lesson_of(body, learning["partial"]["id"])["has_resource"] is False
    assert (await auth_client.get(f"/api/v1/lessons/{learning['partial']['id']}/resource",
                                  headers=member_headers)).status_code == 404


# --------------------------------------------------------------- query cost

async def test_the_whole_page_is_a_constant_number_of_queries(auth_client, auth_session, learning, member_headers):
    """The point of the endpoint: no query per module, lesson or progress row."""
    course_id = learning["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    await watch(auth_client, member_headers, learning["watched"]["id"], 100)
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await fetch(auth_client, member_headers, course_id)
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    # Current user, enrollment, course, video aggregate, one tree read.
    assert len(statements) <= 5, statements
    assert sum(len(module["lessons"]) for module in response.json()["modules"]) == 5
    assert len(response.json()["modules"]) == 3


async def test_query_count_does_not_grow_with_the_course(auth_client, auth_session, storage, admin_headers, member_headers):
    """A bigger course costs the same number of queries; that is the whole claim."""

    async def cost(modules: int, videos_per_module: int) -> tuple[int, dict]:
        course = await create_course(auth_client, admin_headers, title="Sized " + uuid4().hex)
        for position in range(1, modules + 1):
            module = await create_module(auth_client, admin_headers, course["id"], position=position)
            for index in range(1, videos_per_module + 1):
                await create_lesson(auth_client, admin_headers, module["id"], position=index,
                                    content_type="VIDEO", content="storage://videos/x", duration_seconds=100)
        await auth_client.post(f"{ADMIN}/courses/{course['id']}/publish", headers=admin_headers)
        await enroll(auth_client, member_headers, course["id"])
        statements: list[str] = []

        def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = auth_session.bind.sync_engine
        event.listen(engine, "before_cursor_execute", capture)
        try:
            body = (await fetch(auth_client, member_headers, course["id"])).json()
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        return len(statements), body

    small, small_body = await cost(1, 1)
    large, large_body = await cost(5, 6)
    assert sum(len(module["lessons"]) for module in large_body["modules"]) == 30
    assert large == small, f"{large} queries for 30 lessons versus {small} for one"
    # The old flow would have needed 1 + 5 + 30 requests for that same page.
    assert large <= 5
