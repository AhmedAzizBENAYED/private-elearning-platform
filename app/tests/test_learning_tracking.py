"""BE-LEARNING-TRACKING-01: learning events, activity dates and derived status.

Through the real routers, services, repositories and database constraints.
The server clock of the tracking service is replaced where a test must tell
two moments apart; nothing a client sends can choose a time.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.tracking_service as tracking
from app.models.enrollment import Enrollment
from app.models.learning_event import LearningEvent, LearningEventType
from app.models.progress import Progress
from app.models.user import User
from app.repositories.course_repository import CourseRepository
from app.repositories.enrollment_repository import EnrollmentRepository
from app.repositories.learning_event_repository import LearningEventRepository
from app.repositories.progress_repository import ProgressRepository
from app.services.course_service import CourseService
from app.services.enrollment_service import EnrollmentService
from app.services.tracking_service import CourseLearningStatus, LearningTrackingService, course_status
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_courses import create_course, create_lesson, create_module, enforce_foreign_keys, member_headers
from app.tests.test_enrollments import build_course, enroll, watch
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

EVENTS = "/api/v1/me/learning-events"
T0 = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)


class Clock:
    """The tracking service's server clock, moved by the test."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.now = T0
        monkeypatch.setattr(tracking, "_now", lambda: self.now)

    def advance(self, minutes: int) -> datetime:
        self.now += timedelta(minutes=minutes)
        return self.now


@pytest.fixture
def clock(monkeypatch) -> Clock:
    return Clock(monkeypatch)


def service(session: AsyncSession) -> LearningTrackingService:
    return LearningTrackingService(
        LearningEventRepository(session), ProgressRepository(session),
        EnrollmentService(EnrollmentRepository(session), CourseService(CourseRepository(session))),
    )


async def member_id(session: AsyncSession, email: str = EMAIL) -> UUID:
    return await session.scalar(select(User.id).where(User.email == email))


async def build_two_modules(client: AsyncClient, headers: dict, *, publish: bool = True) -> dict:
    """M1: two VIDEOs and a TEXT; M2: one VIDEO, a DOCUMENT and a LINK; M3: only a TEXT."""
    course = await create_course(client, headers, title="Tracking " + uuid4().hex)
    ids: dict = {"course": course["id"]}
    for index, (name, kinds) in enumerate({
        "M1": ["VIDEO", "VIDEO", "TEXT"], "M2": ["VIDEO", "DOCUMENT", "LINK"], "M3": ["TEXT"],
    }.items()):
        module = await create_module(client, headers, course["id"], title=name, position=index + 1)
        ids[name] = module["id"]
        for position, kind in enumerate(kinds):
            content = {"VIDEO": "storage://videos/a.mp4", "TEXT": "Words"}.get(kind, "https://example.com/r")
            lesson = await create_lesson(client, headers, module["id"], title=f"{name}-{kind}-{position}",
                                         position=position + 1, content_type=kind, content=content,
                                         **({"duration_seconds": 100} if kind == "VIDEO" else {}))
            ids[f"{name}-{kind}-{position}"] = lesson["id"]
    if publish:
        assert (await client.post(f"/api/v1/admin/courses/{course['id']}/publish", headers=headers)).status_code == 200
    return ids


@pytest.fixture
async def course(auth_client, admin_headers, member_headers) -> dict:
    ids = await build_two_modules(auth_client, admin_headers)
    await enroll(auth_client, member_headers, ids["course"])
    return ids


def opened(kind: str, ids: dict, module: str | None = None, lesson: str | None = None) -> dict:
    body = {"type": kind, "course_id": ids["course"]}
    if module:
        body["module_id"] = ids[module]
    if lesson:
        body["lesson_id"] = ids[lesson]
    return body


async def post(client: AsyncClient, headers: dict, body: dict):
    return await client.post(EVENTS, headers=headers, json=body)


async def enrollment_row(session: AsyncSession, user: UUID, course_id: str) -> Enrollment:
    return await session.scalar(select(Enrollment).where(Enrollment.user_id == user, Enrollment.course_id == UUID(course_id))
                                .execution_options(populate_existing=True))


async def event_count(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(LearningEvent))


def at(value) -> datetime:
    """A stored or returned time, compared as an aware UTC instant (SQLite drops the zone)."""
    value = datetime.fromisoformat(value) if isinstance(value, str) else value
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------ events


@pytest.mark.parametrize("kind,module,lesson", [
    ("course_opened", None, None),
    ("module_opened", "M1", None),
    ("lesson_opened", "M1", "M1-VIDEO-0"),
])
async def test_each_opening_is_recorded_for_the_caller_at_server_time(
        auth_client, auth_session, member_headers, course, clock, kind, module, lesson):
    response = await post(auth_client, member_headers, opened(kind, course, module, lesson))

    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"id", "type", "course_id", "module_id", "lesson_id", "occurred_at"}
    assert body["type"] == kind and body["course_id"] == course["course"]
    assert body["module_id"] == (course[module] if module else None)
    assert body["lesson_id"] == (course[lesson] if lesson else None)
    assert at(body["occurred_at"]) == T0
    row = await auth_session.scalar(select(LearningEvent))
    assert row.user_id == await member_id(auth_session)
    assert row.event_type == LearningEventType(kind) and at(row.occurred_at) == T0
    stored = await enrollment_row(auth_session, row.user_id, course["course"])
    assert at(stored.started_at) == T0 and at(stored.last_activity_at) == T0


async def test_the_real_server_clock_is_used(auth_client, auth_session, member_headers, course):
    before = datetime.now(timezone.utc)
    body = (await post(auth_client, member_headers, opened("course_opened", course))).json()
    after = datetime.now(timezone.utc)

    assert before <= at(body["occurred_at"]) <= after


@pytest.mark.parametrize("forged", [
    {"occurred_at": "2020-01-01T00:00:00Z"},
    {"user_id": str(uuid4())},
    {"started_at": "2020-01-01T00:00:00Z"},
    {"completed": True},
])
async def test_the_client_cannot_choose_the_time_or_the_member(auth_client, auth_session, member_headers,
                                                               course, forged):
    response = await post(auth_client, member_headers, {**opened("course_opened", course), **forged})

    assert response.status_code == 422
    assert await event_count(auth_session) == 0
    assert (await enrollment_row(auth_session, await member_id(auth_session), course["course"])).started_at is None


@pytest.mark.parametrize("body", [
    {"type": "lesson_completed", "module": "M1", "lesson": "M1-VIDEO-0"},
    {"type": "still_on_lesson", "module": "M1", "lesson": "M1-VIDEO-0"},
    {"type": "lesson_opened", "module": "M1"},
    {"type": "module_opened"},
])
async def test_unknown_types_server_owned_types_and_missing_references_are_refused(
        auth_client, auth_session, member_headers, course, body):
    response = await post(auth_client, member_headers, opened(body["type"], course, body.get("module"), body.get("lesson")))

    assert response.status_code == 422
    assert await event_count(auth_session) == 0


async def test_reopening_keeps_started_at_and_moves_last_activity(auth_client, auth_session, member_headers,
                                                                  course, clock):
    user = await member_id(auth_session)
    await post(auth_client, member_headers, opened("course_opened", course))
    later = clock.advance(90)
    await post(auth_client, member_headers, opened("course_opened", course))

    stored = await enrollment_row(auth_session, user, course["course"])
    assert at(stored.started_at) == T0
    assert at(stored.last_activity_at) == later
    assert await event_count(auth_session) == 2


async def test_an_older_event_never_moves_last_activity_backwards(auth_client, auth_session, member_headers,
                                                                  course, clock):
    user = await member_id(auth_session)
    clock.advance(60)
    await post(auth_client, member_headers, opened("course_opened", course))
    clock.now = T0  # a server clock stepping back, e.g. another worker slightly behind
    response = await post(auth_client, member_headers, opened("module_opened", course, "M1"))

    # The event itself is recorded, at its own time; only the enrollment's dates hold.
    assert response.status_code == 201, response.text
    assert at(response.json()["occurred_at"]) == T0
    assert await event_count(auth_session) == 2
    stored = await enrollment_row(auth_session, user, course["course"])
    assert at(stored.last_activity_at) == T0 + timedelta(minutes=60)
    assert at(stored.started_at) == T0 + timedelta(minutes=60)


@pytest.mark.parametrize("lesson", ["M1-VIDEO-0", "M1-TEXT-2", "M2-DOCUMENT-1", "M2-LINK-2"])
async def test_opening_a_lesson_never_completes_it(auth_client, auth_session, member_headers, course, lesson):
    module = lesson.split("-")[0]
    user = await member_id(auth_session)
    for _ in range(3):
        assert (await post(auth_client, member_headers, opened("lesson_opened", course, module, lesson))).status_code == 201
    await post(auth_client, member_headers, opened("module_opened", course, module))
    await post(auth_client, member_headers, opened("course_opened", course))

    assert await auth_session.scalar(select(func.count()).select_from(Progress)) == 0
    state = await service(auth_session).course_state(user, UUID(course["course"]))
    assert state.completed_video_lessons == 0 and state.progress_percent == 0
    assert state.status == CourseLearningStatus.IN_PROGRESS and state.completed_at is None
    assert all(not m.completed for m in await service(auth_session).module_progress(user, UUID(course["course"])))
    assert await auth_session.scalar(select(func.count()).select_from(LearningEvent)
                                     .where(LearningEvent.event_type == LearningEventType.LESSON_COMPLETED)) == 0


# ----------------------------------------------------------- relationships


async def test_a_module_of_another_course_is_refused(auth_client, auth_session, admin_headers, member_headers, course):
    other = await build_two_modules(auth_client, admin_headers)
    await enroll(auth_client, member_headers, other["course"])

    response = await post(auth_client, member_headers,
                          {"type": "module_opened", "course_id": course["course"], "module_id": other["M1"]})

    assert response.status_code == 404
    assert response.json() == {"detail": "Module not found in this course"}
    assert await event_count(auth_session) == 0
    # The failed request left no activity behind either.
    assert (await enrollment_row(auth_session, await member_id(auth_session), course["course"])).last_activity_at is None


@pytest.mark.parametrize("case", ["lesson of another module", "lesson of another course", "module of another course",
                                  "no such lesson"])
async def test_a_lesson_must_be_in_that_module_of_that_course(auth_client, auth_session, admin_headers,
                                                              member_headers, course, case):
    other = await build_two_modules(auth_client, admin_headers)
    await enroll(auth_client, member_headers, other["course"])
    body = {
        "lesson of another module": opened("lesson_opened", course, "M1", "M2-VIDEO-0"),
        "lesson of another course": {**opened("lesson_opened", course, "M1"), "lesson_id": other["M1-VIDEO-0"]},
        "module of another course": {**opened("lesson_opened", course, lesson="M1-VIDEO-0"), "module_id": other["M1"]},
        "no such lesson": {**opened("lesson_opened", course, "M1"), "lesson_id": str(uuid4())},
    }[case]

    response = await post(auth_client, member_headers, body)

    assert response.status_code == 404
    assert response.json() == {"detail": "Lesson not found in this module"}
    assert await event_count(auth_session) == 0
    assert (await enrollment_row(auth_session, await member_id(auth_session), course["course"])).started_at is None


@pytest.mark.parametrize("case", ["not enrolled", "no such course", "draft course"])
async def test_a_course_the_member_cannot_reach_is_refused(auth_client, auth_session, admin_headers,
                                                          member_headers, case):
    ids = await build_two_modules(auth_client, admin_headers, publish=case != "draft course")
    course_id = str(uuid4()) if case == "no such course" else ids["course"]

    for body in ({"type": "course_opened", "course_id": course_id},
                 {"type": "module_opened", "course_id": course_id, "module_id": ids["M1"]},
                 {"type": "lesson_opened", "course_id": course_id, "module_id": ids["M1"],
                  "lesson_id": ids["M1-VIDEO-0"]}):
        response = await post(auth_client, member_headers, body)
        assert response.status_code == 404, body
        assert response.json() == {"detail": "Enrollment not found"}
    assert await event_count(auth_session) == 0


async def test_an_archived_course_stays_trackable_like_its_content(auth_client, auth_session, admin_headers,
                                                                   member_headers, course):
    """The enrollment is the gate, as for ``/courses/{id}/content``, which archived courses keep."""
    assert (await auth_client.post(f"/api/v1/admin/courses/{course['course']}/archive", headers=admin_headers)).status_code == 200

    assert (await post(auth_client, member_headers, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))).status_code == 201


# ---------------------------------------------------------------- security


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-token"}])
async def test_anonymous_callers_are_refused(auth_client, auth_session, course, headers):
    response = await auth_client.post(EVENTS, headers=headers, json=opened("course_opened", course))

    assert response.status_code == 401
    assert await event_count(auth_session) == 0


async def test_an_inactive_member_is_refused(auth_client, auth_session, member_headers, course):
    await auth_session.execute(update(User).where(User.email == EMAIL).values(is_active=False))
    await auth_session.commit()

    response = await post(auth_client, member_headers, opened("course_opened", course))

    assert response.status_code == 401
    assert await event_count(auth_session) == 0


async def test_a_member_writes_only_their_own_activity(auth_client, auth_session, admin_headers, member_headers,
                                                       course, password_hash):
    """Another member, not enrolled, cannot track the course; enrolled, only their own rows move."""
    auth_session.add(User(email="second@example.com", first_name="Second", last_name="Member",
                          hashed_password=password_hash))
    await auth_session.commit()
    login = await auth_client.post("/api/v1/auth/login", json={"email": "second@example.com", "password": PASSWORD})
    second = {"Authorization": f"Bearer {login.json()['access_token']}"}
    first_id, second_id = await member_id(auth_session), await member_id(auth_session, "second@example.com")

    assert (await post(auth_client, second, opened("course_opened", course))).status_code == 404
    await enroll(auth_client, second, course["course"])
    assert (await post(auth_client, second, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))).status_code == 201
    assert (await watch(auth_client, second, course["M1-VIDEO-0"], 100)).status_code == 200

    assert set(await auth_session.scalars(select(LearningEvent.user_id))) == {second_id}
    mine = await enrollment_row(auth_session, first_id, course["course"])
    assert mine.started_at is None and mine.last_activity_at is None
    state = await service(auth_session).course_state(first_id, UUID(course["course"]))
    assert state.status == CourseLearningStatus.NOT_STARTED and state.completed_video_lessons == 0
    assert (await service(auth_session).course_state(second_id, UUID(course["course"]))).completed_video_lessons == 1
    # The module figures are the caller's too: the second member's video is not the first's.
    mine_by_module = await service(auth_session).module_progress(first_id, UUID(course["course"]))
    assert [m.completed_video_lessons for m in mine_by_module] == [0, 0, 0]
    theirs = await service(auth_session).module_progress(second_id, UUID(course["course"]))
    assert [m.completed_video_lessons for m in theirs] == [1, 0, 0]


# --------------------------------------------------------------- completion


async def test_a_video_completion_is_logged_once_by_the_existing_progress(auth_client, auth_session, member_headers,
                                                                          course):
    user = await member_id(auth_session)
    lesson = course["M1-VIDEO-0"]
    assert (await watch(auth_client, member_headers, lesson, 40)).status_code == 200
    assert await event_count(auth_session) == 0  # watching is not completing

    assert (await watch(auth_client, member_headers, lesson, 100)).json()["completed"] is True
    completed = await auth_session.scalar(select(Progress).where(Progress.lesson_id == UUID(lesson))
                                          .execution_options(populate_existing=True))
    first_at = completed.completed_at
    for seconds in (100, 100, 0, 60):
        assert (await watch(auth_client, member_headers, lesson, seconds)).status_code == 200

    events = (await auth_session.scalars(select(LearningEvent))).all()
    assert [(e.event_type, str(e.lesson_id), str(e.module_id)) for e in events] == [
        (LearningEventType.LESSON_COMPLETED, lesson, course["M1"])]
    assert at(events[0].occurred_at) == at(first_at)
    again = await auth_session.scalar(select(Progress).where(Progress.lesson_id == UUID(lesson))
                                      .execution_options(populate_existing=True))
    assert again.completed_at == first_at
    stored = await enrollment_row(auth_session, user, course["course"])
    assert at(stored.started_at) == at(first_at) and at(stored.last_activity_at) == at(first_at)
    state = await service(auth_session).course_state(user, UUID(course["course"]))
    assert state.completed_video_lessons == 1 and state.total_video_lessons == 3


@pytest.mark.parametrize("lesson", ["M1-TEXT-2", "M2-DOCUMENT-1", "M2-LINK-2"])
async def test_text_document_and_link_never_count(auth_client, auth_session, member_headers, course, lesson):
    user = await member_id(auth_session)

    response = await watch(auth_client, member_headers, course[lesson], 100)

    assert response.status_code == 409
    assert await event_count(auth_session) == 0
    state = await service(auth_session).course_state(user, UUID(course["course"]))
    assert (state.completed_video_lessons, state.total_video_lessons) == (0, 3)


async def test_a_second_completed_event_for_a_lesson_is_impossible(auth_client, auth_session, member_headers, course):
    user = await member_id(auth_session)
    await watch(auth_client, member_headers, course["M1-VIDEO-0"], 100)

    auth_session.add(LearningEvent(user_id=user, event_type=LearningEventType.LESSON_COMPLETED,
                                   course_id=UUID(course["course"]), module_id=UUID(course["M1"]),
                                   lesson_id=UUID(course["M1-VIDEO-0"]), occurred_at=T0))
    with pytest.raises(IntegrityError):
        await auth_session.flush()
    await auth_session.rollback()


@pytest.mark.parametrize("kind,module,lesson", [
    ("course_opened", "M1", None), ("module_opened", None, None), ("module_opened", "M1", "M1-VIDEO-0"),
    ("lesson_opened", None, "M1-VIDEO-0"),
])
async def test_the_database_refuses_an_event_of_the_wrong_shape(auth_session, auth_client, member_headers, course,
                                                                kind, module, lesson):
    auth_session.add(LearningEvent(user_id=await member_id(auth_session), event_type=LearningEventType(kind),
                                   course_id=UUID(course["course"]),
                                   module_id=UUID(course[module]) if module else None,
                                   lesson_id=UUID(course[lesson]) if lesson else None, occurred_at=T0))
    with pytest.raises(IntegrityError):
        await auth_session.flush()
    await auth_session.rollback()


# ----------------------------------------------------------------- progress


async def test_progress_counts_only_video_lessons(auth_client, admin_headers, member_headers, auth_session):
    """5 of 11 videos: 45.45, the project's existing two-decimal percentage, shown as 45%."""
    data = await build_course(auth_client, admin_headers, videos=11)
    course_id = data["course"]["id"]
    await enroll(auth_client, member_headers, course_id)
    user = await member_id(auth_session)
    track = service(auth_session)

    state = await track.course_state(user, UUID(course_id))
    assert (state.completed_video_lessons, state.total_video_lessons, state.progress_percent) == (0, 11, 0)
    for lesson in data["videos"][:5]:
        await watch(auth_client, member_headers, lesson["id"], 100)
    state = await track.course_state(user, UUID(course_id))
    assert (state.completed_video_lessons, state.total_video_lessons) == (5, 11)
    assert state.progress_percent == 45.45 and round(state.progress_percent) == 45
    assert state.status == CourseLearningStatus.IN_PROGRESS and state.completed_at is None

    for lesson in data["videos"][5:]:
        await watch(auth_client, member_headers, lesson["id"], 100)
    state = await track.course_state(user, UUID(course_id))
    assert state.progress_percent == 100 and state.status == CourseLearningStatus.COMPLETED
    assert state.completed_at is not None


async def test_module_progress_is_its_video_lessons(auth_client, auth_session, member_headers, course):
    user = await member_id(auth_session)
    track = service(auth_session)
    await watch(auth_client, member_headers, course["M2-VIDEO-0"], 100)
    await watch(auth_client, member_headers, course["M1-VIDEO-0"], 100)

    figures = {str(m.module_id): (m.completed_video_lessons, m.total_video_lessons, m.completed)
               for m in await track.module_progress(user, UUID(course["course"]))}
    # M1 half done, M2 (one VIDEO, a DOCUMENT, a LINK) done, M3 holds no video and is never done.
    assert figures == {course["M1"]: (1, 2, False), course["M2"]: (1, 1, True), course["M3"]: (0, 0, False)}


async def test_the_module_figures_are_one_query(auth_client, auth_session, member_headers, course):
    user = await member_id(auth_session)
    track = service(auth_session)
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        await track.module_progress(user, UUID(course["course"]))
        await track.course_state(user, UUID(course["course"]))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    # Enrollment + grouped module figures; enrollment + grouped course figures.
    assert len(statements) == 4


# ------------------------------------------------------------------- status


@pytest.mark.parametrize("started,total,completed,status", [
    (False, 3, 0, CourseLearningStatus.NOT_STARTED),
    (True, 3, 0, CourseLearningStatus.IN_PROGRESS),
    (True, 3, 2, CourseLearningStatus.IN_PROGRESS),
    (False, 3, 1, CourseLearningStatus.IN_PROGRESS),
    (True, 3, 3, CourseLearningStatus.COMPLETED),
    (False, 3, 3, CourseLearningStatus.COMPLETED),
    # A course with no video never completes, as ``completion_summary`` has always said.
    (True, 0, 0, CourseLearningStatus.IN_PROGRESS),
    (False, 0, 0, CourseLearningStatus.NOT_STARTED),
])
async def test_status_rules(started, total, completed, status):
    assert course_status(started, total, completed) == status


async def test_status_through_a_member_s_course(auth_client, auth_session, member_headers, course):
    user = await member_id(auth_session)
    track = service(auth_session)
    course_id = UUID(course["course"])
    assert (await track.course_state(user, course_id)).status == CourseLearningStatus.NOT_STARTED

    await post(auth_client, member_headers, opened("course_opened", course))
    assert (await track.course_state(user, course_id)).status == CourseLearningStatus.IN_PROGRESS

    for lesson in ("M1-VIDEO-0", "M1-VIDEO-1"):
        await watch(auth_client, member_headers, course[lesson], 100)
    assert (await track.course_state(user, course_id)).status == CourseLearningStatus.IN_PROGRESS
    await watch(auth_client, member_headers, course["M2-VIDEO-0"], 100)
    state = await track.course_state(user, course_id)
    assert state.status == CourseLearningStatus.COMPLETED and state.completed_at is not None
    completed_at = state.completed_at

    # Viewing afterwards changes neither the status nor the completion date.
    await post(auth_client, member_headers, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))
    after = await track.course_state(user, course_id)
    assert after.status == CourseLearningStatus.COMPLETED and after.completed_at == completed_at


# ----------------------------------------------------------------- activity


async def test_every_learning_event_moves_last_activity(auth_client, auth_session, member_headers, course, clock):
    user = await member_id(auth_session)
    for minutes, body in ((1, opened("course_opened", course)), (2, opened("module_opened", course, "M1")),
                          (3, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))):
        moment = clock.advance(minutes)
        await post(auth_client, member_headers, body)
        stored = await enrollment_row(auth_session, user, course["course"])
        assert at(stored.last_activity_at) == moment and at(stored.started_at) == T0 + timedelta(minutes=1)
    await watch(auth_client, member_headers, course["M1-VIDEO-0"], 100)
    # The completion uses the progress service's own real time, later than the test clock.
    stored = await enrollment_row(auth_session, user, course["course"])
    assert at(stored.last_activity_at) > clock.now


async def test_latest_course_module_and_lesson(auth_client, auth_session, admin_headers, member_headers, course, clock):
    other = await build_two_modules(auth_client, admin_headers)
    await enroll(auth_client, member_headers, other["course"])
    user = await member_id(auth_session)
    track = service(auth_session)
    assert await track.latest_location(user) is None

    clock.advance(1)
    await post(auth_client, member_headers, opened("lesson_opened", course, "M2", "M2-DOCUMENT-1"))
    clock.advance(1)
    await post(auth_client, member_headers, opened("lesson_opened", other, "M1", "M1-TEXT-2"))
    clock.advance(1)
    # A later course or module opening is activity, not a lesson being viewed.
    await post(auth_client, member_headers, opened("module_opened", course, "M3"))
    last = clock.advance(1)
    await post(auth_client, member_headers, opened("course_opened", course))

    overall = await track.latest_location(user)
    assert (str(overall.course_id), str(overall.module_id), str(overall.lesson_id)) == (
        other["course"], other["M1"], other["M1-TEXT-2"])
    here = await track.latest_location(user, UUID(course["course"]))
    assert (str(here.module_id), str(here.lesson_id)) == (course["M2"], course["M2-DOCUMENT-1"])
    assert at(await track.last_activity_at(user)) == last
    recent = await track.recent_events(user, limit=3)
    assert [e.event_type for e in recent] == [LearningEventType.COURSE_OPENED, LearningEventType.MODULE_OPENED,
                                              LearningEventType.LESSON_OPENED]


async def test_recent_activity_for_active_now(auth_client, auth_session, member_headers, course, clock):
    user = await member_id(auth_session)
    track = service(auth_session)
    await post(auth_client, member_headers, opened("course_opened", course))

    assert await track.active_user_ids(T0 - timedelta(minutes=5)) == {user}
    assert await track.active_user_ids(T0 + timedelta(seconds=1)) == set()


async def test_other_actions_are_not_learning_activity(auth_client, auth_session, member_headers, admin_headers, course):
    user = await member_id(auth_session)
    await auth_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    await auth_client.get("/api/v1/auth/me", headers=member_headers)
    assert (await auth_client.patch("/api/v1/auth/me", headers=member_headers, json={"first_name": "Renamed"})).status_code == 200
    await auth_client.get("/api/v1/courses", headers=member_headers, params={"search": "Tracking"})
    await auth_client.get(f"/api/v1/courses/{course['course']}", headers=member_headers)
    await auth_client.get(f"/api/v1/courses/{course['course']}/content", headers=member_headers)
    await auth_client.get(f"/api/v1/courses/{course['course']}/progress", headers=member_headers)
    await enroll(auth_client, member_headers, course["course"])
    await watch(auth_client, member_headers, course["M1-VIDEO-0"], 30)  # watching, not completing
    await auth_client.get(f"/api/v1/admin/courses/{course['course']}", headers=admin_headers)
    await auth_client.post("/api/v1/auth/logout", headers=member_headers, json={})

    stored = await enrollment_row(auth_session, user, course["course"])
    assert stored.started_at is None and stored.last_activity_at is None
    assert await event_count(auth_session) == 0
    assert (await service(auth_session).course_state(user, UUID(course["course"]))).status == \
        CourseLearningStatus.NOT_STARTED


# -------------------------------------------------------------- performance


async def test_recording_an_event_is_three_statements(auth_client, auth_session, member_headers, course):
    """The enrollment touch, the relationship join, the insert - no course tree is read."""
    user = await member_id(auth_session)
    track = service(auth_session)
    from app.schemas.learning_event import LessonOpened
    payload = LessonOpened(type="lesson_opened", course_id=UUID(course["course"]), module_id=UUID(course["M1"]),
                           lesson_id=UUID(course["M1-VIDEO-0"]))
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.lstrip().split()[0].upper())

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        await track.record(user, payload)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert statements == ["UPDATE", "SELECT", "INSERT"]


async def test_the_openapi_contract(auth_client):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()
    operation = schema["paths"]["/api/v1/me/learning-events"]["post"]
    assert operation["security"] == [{"HTTPBearer": []}]
    assert {"201", "401", "403", "404", "422"} <= operation["responses"].keys()
    assert list(schema["paths"]["/api/v1/me/learning-events"]) == ["post"]
    for name in ("CourseOpened", "ModuleOpened", "LessonOpened"):
        component = schema["components"]["schemas"][name]
        assert component["additionalProperties"] is False
        assert "user_id" not in component["properties"] and "occurred_at" not in component["properties"]
