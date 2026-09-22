"""Enrollment and progress use cases through the existing real SQLAlchemy fixtures."""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.models.enrollment import Enrollment
from app.models.progress import Progress
from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_members import admin_headers
from app.tests.test_courses import create_course, create_module, create_lesson, member_headers, enforce_foreign_keys

pytestmark = pytest.mark.anyio


async def build_course(client: AsyncClient, headers: dict[str, str], *, videos: int = 2,
                       duration: int | None = 100, publish: bool = True) -> dict:
    course = await create_course(client, headers, title="Learning " + uuid4().hex)
    module = await create_module(client, headers, course["id"])
    lessons = [await create_lesson(client, headers, module["id"], position=index + 1,
                                  content_type="VIDEO", content="storage://videos/intro.mp4", duration_seconds=duration)
               for index in range(videos)]
    others = [await create_lesson(client, headers, module["id"], position=videos + index + 1,
                                 content_type=kind, content="Text" if kind == "TEXT" else "https://example.com/resource")
              for index, kind in enumerate(("DOCUMENT", "LINK", "TEXT"))]
    if publish:
        assert (await client.post(f"/api/v1/admin/courses/{course['id']}/publish", headers=headers)).status_code == 200
    return {"course": course, "videos": lessons, "others": others}


@pytest.fixture
async def learning_course(auth_client, admin_headers):
    return await build_course(auth_client, admin_headers)


async def enroll(client: AsyncClient, headers: dict[str, str], course_id: str) -> dict:
    response = await client.post(f"/api/v1/courses/{course_id}/enroll", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def watch(client: AsyncClient, headers: dict[str, str], lesson_id: str, seconds: int):
    return await client.put(f"/api/v1/lessons/{lesson_id}/progress", headers=headers, json={"watched_seconds": seconds})


@pytest.mark.parametrize("method,path", [
    ("POST", "/courses/{id}/enroll"), ("GET", "/me/enrollments"),
    ("GET", "/courses/{id}/enrollment"), ("GET", "/courses/{id}/progress"),
    ("GET", "/lessons/{id}/progress"), ("PUT", "/lessons/{id}/progress"),
])
async def test_learning_requires_authentication(auth_client, method, path):
    response = await auth_client.request(method, "/api/v1" + path.replace("{id}", str(uuid4())),
                                        json={"watched_seconds": 1} if method == "PUT" else None)
    assert response.status_code == 401


async def test_enrollment_creation_idempotency_and_owner_scope(auth_client, auth_session, learning_course, member_headers, admin_headers):
    course_id = learning_course["course"]["id"]
    first = await enroll(auth_client, member_headers, course_id)
    assert set(first) == {"id", "course_id", "enrolled_at", "completed_at"}
    assert first["completed_at"] is None
    assert await enroll(auth_client, member_headers, course_id) == first
    assert await auth_session.scalar(select(func.count()).select_from(Enrollment)) == 1
    path = f"/api/v1/courses/{course_id}/enrollment"
    assert (await auth_client.get(path, headers=member_headers)).json() == first
    assert (await auth_client.get(path, headers=admin_headers)).status_code == 404
    assert (await auth_client.get("/api/v1/me/enrollments", headers=admin_headers)).json()["items"] == []
    # ADMIN follows the same enrollment rules, with no implicit access to other users' data.
    other = await enroll(auth_client, admin_headers, course_id)
    assert other["id"] != first["id"]
    assert (await auth_client.get(path, headers=admin_headers)).json() == other


@pytest.mark.parametrize("status", ["DRAFT", "ARCHIVED"])
async def test_enrollment_requires_published_course(auth_client, admin_headers, member_headers, status):
    data = await build_course(auth_client, admin_headers, publish=status != "DRAFT")
    course_id = data["course"]["id"]
    if status == "ARCHIVED":
        await auth_client.post(f"/api/v1/admin/courses/{course_id}/archive", headers=admin_headers)
    assert (await auth_client.post(f"/api/v1/courses/{course_id}/enroll", headers=member_headers)).status_code == 409


async def test_progress_requires_own_enrollment(auth_client, learning_course, member_headers, admin_headers):
    course_id, lesson_id = learning_course["course"]["id"], learning_course["videos"][0]["id"]
    for headers in (member_headers, admin_headers):
        assert (await auth_client.get(f"/api/v1/courses/{course_id}/progress", headers=headers)).status_code == 404
        assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/progress", headers=headers)).status_code == 404
        assert (await watch(auth_client, headers, lesson_id, 10)).status_code == 404
    await enroll(auth_client, admin_headers, course_id)
    assert (await watch(auth_client, admin_headers, lesson_id, 98)).status_code == 200
    assert (await watch(auth_client, member_headers, lesson_id, 10)).status_code == 404
    await enroll(auth_client, member_headers, course_id)
    response = await auth_client.get(f"/api/v1/lessons/{lesson_id}/progress", headers=member_headers)
    assert response.json()["watched_seconds"] == 0 and response.json()["completed"] is False


async def test_get_default_does_not_write(auth_client, auth_session, learning_course, member_headers):
    await enroll(auth_client, member_headers, learning_course["course"]["id"])
    lesson_id = learning_course["videos"][0]["id"]
    response = await auth_client.get(f"/api/v1/lessons/{lesson_id}/progress", headers=member_headers)
    assert response.status_code == 200
    assert response.json() == {"lesson_id": lesson_id, "watched_seconds": 0, "duration_seconds": 100,
                               "completed": False, "completed_at": None}
    assert response.headers["cache-control"] == "no-store"
    assert await auth_session.scalar(select(func.count()).select_from(Progress)) == 0


async def test_monotonic_progress_tolerance_clamping_and_timestamps(auth_client, auth_session, learning_course, member_headers):
    await enroll(auth_client, member_headers, learning_course["course"]["id"])
    lesson_id = learning_course["videos"][0]["id"]
    first = await watch(auth_client, member_headers, lesson_id, 20)
    assert first.json()["watched_seconds"] == 20 and first.json()["completed_at"] is None
    assert (await watch(auth_client, member_headers, lesson_id, 10)).json() == first.json()
    assert (await watch(auth_client, member_headers, lesson_id, 97)).json()["completed"] is False
    completed = (await watch(auth_client, member_headers, lesson_id, 98)).json()
    assert completed["completed"] is True and completed["completed_at"] is not None
    assert (await watch(auth_client, member_headers, lesson_id, 0)).json() == completed
    clamped = (await watch(auth_client, member_headers, lesson_id, 9999)).json()
    assert clamped["watched_seconds"] == 100 and clamped["completed_at"] == completed["completed_at"]
    assert await auth_session.scalar(select(func.count()).select_from(Progress)) == 1


@pytest.mark.parametrize("payload", [
    {"watched_seconds": -1}, {"watched_seconds": 1.5}, {"watched_seconds": True}, {"watched_seconds": "5"},
    {"watched_seconds": None}, {}, {"watched_seconds": 1, "completed": True},
    {"watched_seconds": 1, "completed_at": "2026-01-01"},
    {"watched_seconds": 1, "user_id": str(uuid4())}, {"watched_seconds": 1, "lesson_id": str(uuid4())},
])
async def test_progress_forbids_invalid_or_spoofed_fields(auth_client, learning_course, member_headers, payload):
    await enroll(auth_client, member_headers, learning_course["course"]["id"])
    response = await auth_client.put(f"/api/v1/lessons/{learning_course['videos'][0]['id']}/progress",
                                     headers=member_headers, json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize("index", [0, 1, 2])
async def test_non_video_progress_rejected(auth_client, auth_session, learning_course, member_headers, index):
    await enroll(auth_client, member_headers, learning_course["course"]["id"])
    lesson_id = learning_course["others"][index]["id"]
    assert (await watch(auth_client, member_headers, lesson_id, 10)).status_code == 409
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/progress", headers=member_headers)).status_code == 409
    assert await auth_session.scalar(select(func.count()).select_from(Progress)) == 0


async def test_enrollment_is_checked_before_lesson_content_rules(auth_client, learning_course, member_headers, admin_headers):
    """Non-members must not distinguish a non-video lesson (409) from an unknown one (404)."""
    lesson_id = learning_course["others"][0]["id"]
    for headers in (member_headers, admin_headers):
        assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/progress", headers=headers)).status_code == 404
        assert (await watch(auth_client, headers, lesson_id, 10)).status_code == 404
    await enroll(auth_client, member_headers, learning_course["course"]["id"])
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/progress", headers=member_headers)).status_code == 409
    assert (await watch(auth_client, member_headers, lesson_id, 10)).status_code == 409


async def test_course_progress_aggregates_across_modules(auth_client, admin_headers, member_headers):
    """Video counting is course-wide, not module-wide."""
    course = await create_course(auth_client, admin_headers, title="Multi module " + uuid4().hex)
    videos = []
    for position in (1, 2):
        module = await create_module(auth_client, admin_headers, course["id"], position=position)
        videos.append(await create_lesson(auth_client, admin_headers, module["id"], position=1,
                                          content_type="VIDEO", content="storage://videos/intro.mp4",
                                          duration_seconds=100))
        await create_lesson(auth_client, admin_headers, module["id"], position=2,
                            content_type="DOCUMENT", content="https://example.com/resource")
    assert (await auth_client.post(f"/api/v1/admin/courses/{course['id']}/publish", headers=admin_headers)).status_code == 200
    await enroll(auth_client, member_headers, course["id"])
    path = f"/api/v1/courses/{course['id']}/progress"
    assert (await auth_client.get(path, headers=member_headers)).json()["total_video_lessons"] == 2
    assert (await watch(auth_client, member_headers, videos[0]["id"], 100)).status_code == 200
    half = (await auth_client.get(path, headers=member_headers)).json()
    assert half["progress_percent"] == 50 and half["completed"] is False
    assert (await watch(auth_client, member_headers, videos[1]["id"], 100)).status_code == 200
    full = (await auth_client.get(path, headers=member_headers)).json()
    assert full["progress_percent"] == 100 and full["completed"] is True
    enrollment = (await auth_client.get(f"/api/v1/courses/{course['id']}/enrollment", headers=member_headers)).json()
    assert enrollment["completed_at"] is not None


@pytest.mark.parametrize("completed_count,percent", [(0, 0), (5, 50), (10, 100)])
async def test_course_progress_and_enrollment_completion(auth_client, admin_headers, member_headers, completed_count, percent):
    data = await build_course(auth_client, admin_headers, videos=10)
    course_id = data["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    for lesson in data["videos"][:completed_count]:
        assert (await watch(auth_client, member_headers, lesson["id"], 100)).status_code == 200
    result = (await auth_client.get(f"/api/v1/courses/{course_id}/progress", headers=member_headers)).json()
    assert result == {"course_id": course_id, "total_video_lessons": 10, "completed_video_lessons": completed_count,
                      "progress_percent": percent, "completed": completed_count == 10}
    enrollment = (await auth_client.get(f"/api/v1/courses/{course_id}/enrollment", headers=member_headers)).json()
    assert (enrollment["completed_at"] is not None) == (completed_count == 10)
    if completed_count == 10:
        await watch(auth_client, member_headers, data["videos"][0]["id"], 0)
        assert (await auth_client.get(f"/api/v1/courses/{course_id}/enrollment", headers=member_headers)).json() == enrollment


async def test_zero_video_course_not_completed(auth_client, admin_headers, member_headers):
    data = await build_course(auth_client, admin_headers, videos=0)
    course_id = data["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    result = (await auth_client.get(f"/api/v1/courses/{course_id}/progress", headers=member_headers)).json()
    assert result["total_video_lessons"] == result["completed_video_lessons"] == result["progress_percent"] == 0
    assert result["completed"] is False
    summary = (await auth_client.get("/api/v1/me/enrollments", headers=member_headers)).json()["items"][0]
    assert summary["completed"] is False and summary["completed_at"] is None


async def test_list_is_private_paginated_and_not_n_plus_one(auth_client, auth_session, learning_course, admin_headers, member_headers):
    course_id = learning_course["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    await watch(auth_client, member_headers, learning_course["videos"][0]["id"], 100)
    await enroll(auth_client, admin_headers, course_id)
    for lesson in learning_course["videos"]:
        await watch(auth_client, admin_headers, lesson["id"], 100)
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await auth_client.get("/api/v1/me/enrollments", headers=member_headers)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(statements) <= 3  # Current user, total enrollment count, aggregate page.
    summary = response.json()["items"][0]
    assert summary["progress_percent"] == 50 and summary["completed"] is False
    # BE-COURSE-CATALOG-01 (G05): the three counts behind the percentage join the row.
    assert set(summary) == {"enrollment_id", "course_id", "title", "slug", "thumbnail_url", "enrolled_at", "completed_at", "progress_percent", "completed",
                            "module_count", "total_video_lessons", "completed_video_lessons"}
    second = await build_course(auth_client, admin_headers, videos=0)
    await enroll(auth_client, member_headers, second["course"]["id"])
    response = await auth_client.get("/api/v1/me/enrollments", headers=member_headers, params={"page_size": 1, "page": 2})
    assert response.json()["total"] == 2 and len(response.json()["items"]) == 1
    assert response.json()["page"] == 2
    assert (await auth_client.get("/api/v1/me/enrollments", headers=member_headers, params={"page_size": 101})).status_code == 422


async def test_archived_history_remains_readable(auth_client, learning_course, member_headers, admin_headers):
    course_id = learning_course["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    for lesson in learning_course["videos"]:
        await watch(auth_client, member_headers, lesson["id"], 100)
    enrollment = (await auth_client.get(f"/api/v1/courses/{course_id}/enrollment", headers=member_headers)).json()
    assert (await auth_client.post(f"/api/v1/admin/courses/{course_id}/archive", headers=admin_headers)).status_code == 200
    assert (await auth_client.get(f"/api/v1/courses/{course_id}/enrollment", headers=member_headers)).json() == enrollment
    assert (await auth_client.get(f"/api/v1/courses/{course_id}/progress", headers=member_headers)).json()["completed"] is True
    assert (await auth_client.get(f"/api/v1/lessons/{learning_course['videos'][0]['id']}/progress", headers=member_headers)).status_code == 200
    assert (await auth_client.get("/api/v1/me/enrollments", headers=member_headers)).json()["items"][0]["completed_at"] == enrollment["completed_at"]
    for headers in (member_headers, admin_headers):
        assert (await auth_client.post(f"/api/v1/courses/{course_id}/enroll", headers=headers)).status_code == 409
    assert (await watch(auth_client, member_headers, learning_course["videos"][0]["id"], 100)).status_code == 409


@pytest.mark.parametrize("duration,tolerance,seconds,completed", [(1, 2, 0, False), (1, 2, 1, True), (100, 0, 99, False), (100, 0, 100, True)])
async def test_short_videos_and_configurable_tolerance(auth_client, application, admin_headers, member_headers, duration, tolerance, seconds, completed):
    application.state.settings = application.state.settings.model_copy(update={"video_completion_tolerance_seconds": tolerance})
    data = await build_course(auth_client, admin_headers, videos=1, duration=duration)
    await enroll(auth_client, member_headers, data["course"]["id"])
    response = await watch(auth_client, member_headers, data["videos"][0]["id"], seconds)
    assert response.status_code == 200 and response.json()["completed"] is completed


async def test_missing_duration_is_a_clear_business_error(auth_client, auth_session, admin_headers, member_headers):
    data = await build_course(auth_client, admin_headers, videos=1, duration=None)
    await enroll(auth_client, member_headers, data["course"]["id"])
    response = await watch(auth_client, member_headers, data["videos"][0]["id"], 10)
    assert response.status_code == 409 and "duration" in response.text
    assert await auth_session.scalar(select(func.count()).select_from(Progress)) == 0


@pytest.mark.parametrize("case", ["enrollment_duplicate", "enrollment_user_fk", "enrollment_course_fk", "enrollment_time",
                                  "progress_duplicate", "progress_user_fk", "progress_lesson_fk", "negative", "completion_time"])
async def test_database_invariants(auth_client, auth_session, learning_course, member_headers, admin_headers, case):
    course_id = UUID(learning_course["course"]["id"])
    lesson_id = UUID(learning_course["videos"][0]["id"])
    user_id = UUID((await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()["id"])
    await enroll(auth_client, member_headers, str(course_id))
    await watch(auth_client, member_headers, str(lesson_id), 20)
    if case.startswith("enrollment"):
        record = Enrollment(user_id=uuid4() if case == "enrollment_user_fk" else user_id,
                            course_id=uuid4() if case == "enrollment_course_fk" else course_id)
        if case == "enrollment_time":
            # Use a separate valid user/course pair, so the time check is exercised.
            other = await build_course(auth_client, admin_headers, videos=0)
            record.course_id = UUID(other["course"]["id"])
            record.enrolled_at = datetime.now(timezone.utc)
            record.completed_at = record.enrolled_at - timedelta(seconds=1)
    else:
        record = Progress(user_id=uuid4() if case == "progress_user_fk" else user_id,
                          lesson_id=uuid4() if case == "progress_lesson_fk" else lesson_id,
                          watched_seconds=-1 if case == "negative" else 0, completed=case == "completion_time")
        if case in {"negative", "completion_time"}:
            record.lesson_id = UUID(learning_course["videos"][1]["id"])
    with pytest.raises(IntegrityError):
        async with auth_session.begin_nested():
            auth_session.add(record)
            await auth_session.flush()


async def test_completion_failure_rolls_back_progress(auth_client, auth_session, admin_headers, member_headers, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from app.repositories.enrollment_repository import EnrollmentRepository

    data = await build_course(auth_client, admin_headers, videos=1)
    course_id = data["course"]["id"]
    await enroll(auth_client, member_headers, course_id)

    async def failed_save(self, enrollment):
        raise OperationalError("private-sql", {}, Exception("private-error"))

    monkeypatch.setattr(EnrollmentRepository, "save", failed_save)
    response = await watch(auth_client, member_headers, data["videos"][0]["id"], 100)
    assert response.status_code == 503 and "private-" not in response.text
    assert await auth_session.scalar(select(func.count()).select_from(Progress)) == 0
    assert (await auth_client.get(f"/api/v1/courses/{course_id}/enrollment", headers=member_headers)).json()["completed_at"] is None


async def test_enrollment_integrity_race_is_safe(auth_client, learning_course, member_headers, monkeypatch):
    from app.repositories.enrollment_repository import EnrollmentRepository

    course_id = learning_course["course"]["id"]
    original = await enroll(auth_client, member_headers, course_id)

    async def miss_precheck(self, user_id, course_id, **kwargs):
        return None

    with monkeypatch.context() as patch:
        patch.setattr(EnrollmentRepository, "get", miss_precheck)
        response = await auth_client.post(f"/api/v1/courses/{course_id}/enroll", headers=member_headers)
        assert response.status_code == 409 and "IntegrityError" not in response.text
    assert await enroll(auth_client, member_headers, course_id) == original


@pytest.mark.parametrize("identifier,expected", [(str(uuid4()), 404), ("invalid", 422)])
async def test_missing_or_invalid_ids(auth_client, member_headers, identifier, expected):
    for path in (f"/api/v1/courses/{identifier}/enrollment", f"/api/v1/courses/{identifier}/progress", f"/api/v1/lessons/{identifier}/progress"):
        assert (await auth_client.get(path, headers=member_headers)).status_code == expected
    assert (await auth_client.post(f"/api/v1/courses/{identifier}/enroll", headers=member_headers)).status_code == expected
    assert (await watch(auth_client, member_headers, identifier, 1)).status_code == expected
