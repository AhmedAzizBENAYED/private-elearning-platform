"""BE-LEARNING-TRACKING-02: the administrator reads of member learning progress.

Real requests through the real routers, services and repositories. Two members
are enrolled in the same courses throughout, so "this member's figures" is
never true by accident.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning_event import LearningEvent
from app.models.user import User, UserRole
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_courses import COURSES, create_course, create_lesson, create_module, enforce_foreign_keys, member_headers
from app.tests.test_enrollments import enroll, watch
from app.tests.test_learning_tracking import Clock, build_two_modules, clock, opened, post
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

PROGRESS = "/api/v1/admin/learning/progress"
ACTIVITY = "/api/v1/admin/learning/activity"
ROW_FIELDS = {"member", "course", "status", "progress_percent", "completed_video_lessons",
              "total_video_lessons", "completed_modules", "total_modules", "started_at",
              "last_activity_at", "completed_at"}


async def member_id(session: AsyncSession, email: str = EMAIL) -> UUID:
    return await session.scalar(select(User.id).where(User.email == email))


@pytest.fixture
async def second(auth_client: AsyncClient, auth_session: AsyncSession, password_hash: str) -> dict[str, str]:
    """A second member, so no figure can be mistaken for the first member's."""
    auth_session.add(User(email="second@example.com", first_name="Sarra", last_name="Mansour",
                          hashed_password=password_hash, role=UserRole.MEMBER))
    await auth_session.commit()
    response = await auth_client.post("/api/v1/auth/login",
                                      json={"email": "second@example.com", "password": PASSWORD})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
async def course(auth_client, admin_headers) -> dict:
    """M1: two VIDEOs and a TEXT; M2: one VIDEO, a DOCUMENT, a LINK; M3: a TEXT only."""
    return await build_two_modules(auth_client, admin_headers)


async def rows(client: AsyncClient, headers: dict, **params) -> dict:
    response = await client.get(PROGRESS, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def find(page: dict, email: str, course_id: str) -> dict:
    """The row of one member in one course; absent rows are a test failure, not None."""
    matching = [row for row in page["items"]
                if row["member"]["email"] == email and row["course"]["id"] == course_id]
    assert len(matching) == 1, f"{email} x {course_id}: {len(matching)} row(s)"
    return matching[0]


# ---------------------------------------------------------------- contract


async def test_the_matrix_pairs_every_member_with_every_published_course(
        auth_client, auth_session, admin_headers, member_headers, second, course, clock):
    other = await build_two_modules(auth_client, admin_headers)
    draft = await build_two_modules(auth_client, admin_headers, publish=False)
    await enroll(auth_client, member_headers, course["course"])

    page = await rows(auth_client, admin_headers, page_size=100)

    assert page["total"] == 4 and page["page"] == 1 and page["page_size"] == 100
    assert {(row["member"]["email"], row["course"]["id"]) for row in page["items"]} == {
        (email, course_id)
        for email in (EMAIL, "second@example.com")
        for course_id in (course["course"], other["course"])
    }
    assert all(row["course"]["id"] != draft["course"] for row in page["items"])
    row = find(page, EMAIL, course["course"])  # titles come from the fixture's course title
    assert set(row) == ROW_FIELDS
    assert set(row["member"]) == {"id", "first_name", "last_name", "email", "is_active"}
    assert set(row["course"]) == {"id", "title", "slug"}
    assert page["counts"] == {"all": 4, "not_started": 4, "in_progress": 0, "completed": 0, "started": 0}


async def test_the_figures_follow_one_member_only(auth_client, auth_session, admin_headers,
                                                  member_headers, second, course, clock):
    """Two members, two courses: each keeps their own lessons, modules and dates."""
    course_id = course["course"]
    other = await build_two_modules(auth_client, admin_headers)
    for headers in (member_headers, second):
        await enroll(auth_client, headers, course_id)
        await enroll(auth_client, headers, other["course"])
    await post(auth_client, member_headers, opened("course_opened", course))
    # The first member finishes module 1 (2 videos of 3) and nothing else.
    for lesson in ("M1-VIDEO-0", "M1-VIDEO-1"):
        await watch(auth_client, member_headers, course[lesson], 100)
    # The second finishes one video of module 2, whose only video it is.
    await watch(auth_client, second, course["M2-VIDEO-0"], 100)

    page = await rows(auth_client, admin_headers, page_size=100)

    first = find(page, EMAIL, course["course"])
    assert (first["completed_video_lessons"], first["total_video_lessons"]) == (2, 3)
    assert first["progress_percent"] == 66.67 and first["status"] == "IN_PROGRESS"
    # M1 is done (2 videos), M2 is not, M3 holds no video and is never done.
    assert (first["completed_modules"], first["total_modules"]) == (1, 3)
    assert first["started_at"] is not None and first["completed_at"] is None

    theirs = find(page, "second@example.com", course["course"])
    assert (theirs["completed_video_lessons"], theirs["total_video_lessons"]) == (1, 3)
    assert (theirs["completed_modules"], theirs["total_modules"]) == (1, 3)
    assert theirs["progress_percent"] == 33.33
    # The second member recorded no opening: only a completion, which starts them.
    assert theirs["status"] == "IN_PROGRESS" and theirs["started_at"] is not None

    # The other course of the same member borrows nothing from this one.
    elsewhere = find(page, EMAIL, other["course"])
    assert (elsewhere["completed_video_lessons"], elsewhere["completed_modules"]) == (0, 0)
    assert elsewhere["status"] == "NOT_STARTED" and elsewhere["total_modules"] == 3

    # Watching without finishing counts for nothing: only a completed video does.
    assert (await watch(auth_client, member_headers, course["M2-VIDEO-0"], 40)).status_code == 200
    again = find(await rows(auth_client, admin_headers, page_size=100), EMAIL, course["course"])
    assert (again["completed_video_lessons"], again["completed_modules"]) == (2, 1)
    assert again["progress_percent"] == 66.67


async def test_status_and_percentage_follow_the_existing_rules(auth_client, admin_headers,
                                                               member_headers, course, clock):
    course_id = course["course"]
    page = await rows(auth_client, admin_headers, page_size=100)
    row = find(page, EMAIL, course["course"])
    assert row["status"] == "NOT_STARTED" and row["progress_percent"] == 0
    assert row["started_at"] is None and row["last_activity_at"] is None

    await enroll(auth_client, member_headers, course_id)
    await post(auth_client, member_headers, opened("course_opened", course))
    row = find(await rows(auth_client, admin_headers, page_size=100), EMAIL, course["course"])
    assert row["status"] == "IN_PROGRESS" and row["progress_percent"] == 0
    assert row["completed_modules"] == 0

    for lesson in ("M1-VIDEO-0", "M1-VIDEO-1", "M2-VIDEO-0"):
        await watch(auth_client, member_headers, course[lesson], 100)
    row = find(await rows(auth_client, admin_headers, page_size=100), EMAIL, course["course"])
    assert row["status"] == "COMPLETED" and row["progress_percent"] == 100
    assert row["completed_at"] is not None and (row["completed_modules"], row["total_modules"]) == (2, 3)


async def test_a_course_without_video_never_completes(auth_client, admin_headers, member_headers, clock):
    course = await create_course(auth_client, admin_headers, title="Reading only " + uuid4().hex)
    module = await create_module(auth_client, admin_headers, course["id"], title="Only text")
    await create_lesson(auth_client, admin_headers, module["id"], title="Notes", position=1,
                        content_type="TEXT", content="Words")
    assert (await auth_client.post(f"{COURSES}/{course['id']}/publish", headers=admin_headers)).status_code == 200
    await enroll(auth_client, member_headers, course["id"])
    await post(auth_client, member_headers, {"type": "course_opened", "course_id": course["id"]})

    row = find(await rows(auth_client, admin_headers, page_size=100, course_id=course["id"]),
               EMAIL, course["id"])

    assert row["status"] == "IN_PROGRESS" and row["progress_percent"] == 0
    assert (row["completed_modules"], row["total_modules"]) == (0, 1)
    assert (row["completed_video_lessons"], row["total_video_lessons"]) == (0, 0)


# ----------------------------------------------------------------- filters


async def test_filters_counts_pagination_and_sorting(auth_client, auth_session, admin_headers,
                                                     member_headers, second, course, clock):
    other = await build_two_modules(auth_client, admin_headers)
    for headers in (member_headers, second):
        for ids in (course, other):
            await enroll(auth_client, headers, ids["course"])
    clock.advance(10)
    await post(auth_client, member_headers, opened("course_opened", course))
    for lesson in ("M1-VIDEO-0", "M1-VIDEO-1", "M2-VIDEO-0"):
        await watch(auth_client, member_headers, course[lesson], 100)
    clock.advance(10)
    await post(auth_client, second, opened("course_opened", other))

    page = await rows(auth_client, admin_headers, page_size=100)
    assert page["counts"] == {"all": 4, "not_started": 2, "in_progress": 1, "completed": 1, "started": 2}

    completed = await rows(auth_client, admin_headers, status="COMPLETED", page_size=100)
    assert [(row["member"]["email"], row["status"]) for row in completed["items"]] == [(EMAIL, "COMPLETED")]
    assert completed["total"] == 1
    # The counts describe the filtered set without the status filter itself.
    assert completed["counts"]["all"] == 4

    assert (await rows(auth_client, admin_headers, course_id=other["course"], page_size=100))["total"] == 2
    mine = await rows(auth_client, admin_headers, member_id=str(await member_id(auth_session)), page_size=100)
    assert {row["member"]["email"] for row in mine["items"]} == {EMAIL}
    assert (await rows(auth_client, admin_headers, search="Sarra", page_size=100))["total"] == 2
    assert (await rows(auth_client, admin_headers, search="nobody-here", page_size=100))["total"] == 0

    # Sorted by last activity, the pairs without any sort last.
    ordered = await rows(auth_client, admin_headers, page_size=100, sort="-last_activity")
    assert [row["last_activity_at"] is None for row in ordered["items"]] == [False, False, True, True]
    by_progress = await rows(auth_client, admin_headers, page_size=100, sort="-progress")
    assert by_progress["items"][0]["progress_percent"] == 100

    first_page = await rows(auth_client, admin_headers, page_size=1, page=1, sort="member")
    second_page = await rows(auth_client, admin_headers, page_size=1, page=2, sort="member")
    assert len(first_page["items"]) == 1 and first_page["total"] == 4
    assert first_page["items"][0] != second_page["items"][0]


async def test_active_since_keeps_only_recent_activity(auth_client, admin_headers, member_headers,
                                                       course, clock):
    await enroll(auth_client, member_headers, course["course"])
    moment = clock.advance(5)
    await post(auth_client, member_headers, opened("course_opened", course))

    before = (moment - timedelta(minutes=1)).isoformat()
    after = (moment + timedelta(minutes=1)).isoformat()
    assert (await rows(auth_client, admin_headers, active_since=before, page_size=100))["total"] == 1
    assert (await rows(auth_client, admin_headers, active_since=after, page_size=100))["total"] == 0


# ---------------------------------------------------------------- activity


async def test_activity_reports_the_last_lesson_opened_by_each_member(
        auth_client, auth_session, admin_headers, member_headers, second, course, clock):
    other = await build_two_modules(auth_client, admin_headers)
    for headers in (member_headers, second):
        for ids in (course, other):
            await enroll(auth_client, headers, ids["course"])
    first_moment = clock.advance(1)
    await post(auth_client, member_headers, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))
    await post(auth_client, second, opened("lesson_opened", course, "M1", "M1-TEXT-2"))
    last = clock.advance(1)
    await post(auth_client, second, opened("lesson_opened", other, "M2", "M2-DOCUMENT-1"))
    # A later course opening is activity, but it is not a lesson being viewed.
    await post(auth_client, second, opened("course_opened", other))

    body = (await auth_client.get(ACTIVITY, headers=admin_headers, params={"page_size": 100})).json()

    assert set(body) == {"items", "total", "page", "page_size", "members_with_activity", "active_members"}
    assert body["total"] == 2 and body["members_with_activity"] == 2 and body["active_members"] is None
    # Sorted by last activity, newest first.
    assert [row["member"]["email"] for row in body["items"]] == ["second@example.com", EMAIL]
    sarra, mine = body["items"]
    assert sarra["course"]["id"] == other["course"] and sarra["lesson"]["title"] == "M2-DOCUMENT-1"
    assert sarra["lesson"]["module_title"] == "M2" and sarra["lesson"]["module_position"] == 2
    assert sarra["status"] == "IN_PROGRESS" and sarra["total_video_lessons"] == 3
    assert mine["lesson"]["title"] == "M1-VIDEO-0" and mine["course"]["id"] == course["course"]
    assert datetime.fromisoformat(mine["last_activity_at"]).replace(tzinfo=timezone.utc) == first_moment
    assert datetime.fromisoformat(sarra["last_activity_at"]).replace(tzinfo=timezone.utc) == last


async def test_activity_says_plainly_when_a_member_has_none(auth_client, admin_headers, second, course):
    body = (await auth_client.get(ACTIVITY, headers=admin_headers, params={"page_size": 100})).json()

    assert body["members_with_activity"] == 0
    for row in body["items"]:
        assert row["last_activity_at"] is None and row["course"] is None and row["lesson"] is None
        assert row["status"] is None and row["progress_percent"] is None


async def test_active_since_counts_and_filters_members(auth_client, admin_headers, member_headers,
                                                       second, course, clock):
    await enroll(auth_client, member_headers, course["course"])
    await enroll(auth_client, second, course["course"])
    moment = clock.advance(3)
    await post(auth_client, member_headers, opened("course_opened", course))

    since = (moment - timedelta(minutes=1)).isoformat()
    body = (await auth_client.get(ACTIVITY, headers=admin_headers,
                                  params={"active_since": since, "page_size": 100})).json()
    assert body["active_members"] == 1 and body["total"] == 2

    only = (await auth_client.get(ACTIVITY, headers=admin_headers,
                                  params={"active_since": since, "only_active": True, "page_size": 100})).json()
    assert only["total"] == 1 and [row["member"]["email"] for row in only["items"]] == [EMAIL]


# ------------------------------------------------------------ member detail


async def test_a_member_page_lists_every_published_course_and_their_last_events(
        auth_client, auth_session, admin_headers, member_headers, second, course, clock):
    other = await build_two_modules(auth_client, admin_headers)
    await enroll(auth_client, member_headers, course["course"])
    await enroll(auth_client, second, course["course"])
    clock.advance(1)
    await post(auth_client, member_headers, opened("course_opened", course))
    clock.advance(1)
    await post(auth_client, member_headers, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))
    await watch(auth_client, member_headers, course["M1-VIDEO-0"], 100)
    # The other member's activity must not appear on this page.
    await post(auth_client, second, opened("lesson_opened", course, "M2", "M2-VIDEO-0"))

    body = (await auth_client.get(f"/api/v1/admin/learning/members/{await member_id(auth_session)}",
                                  headers=admin_headers)).json()

    assert set(body) == {"member", "counts", "last_activity_at", "latest", "courses", "recent_events"}
    assert body["member"]["email"] == EMAIL
    # Both published courses, the one never opened included.
    assert {row["course"]["id"] for row in body["courses"]} == {course["course"], other["course"]}
    assert body["counts"] == {"all": 2, "not_started": 1, "in_progress": 1, "completed": 0, "started": 1}
    assert body["latest"]["lesson"]["title"] == "M1-VIDEO-0"
    assert [event["type"] for event in body["recent_events"]] == [
        "lesson_completed", "lesson_opened", "course_opened"]
    assert body["recent_events"][0]["lesson_title"] == "M1-VIDEO-0"
    assert body["recent_events"][0]["module_title"] == "M1"
    assert body["recent_events"][-1]["module_id"] is None and body["recent_events"][-1]["lesson_id"] is None
    assert all(event["course_title"] for event in body["recent_events"])


async def test_a_member_page_keeps_to_ten_events(auth_client, auth_session, admin_headers,
                                                 member_headers, course, clock):
    await enroll(auth_client, member_headers, course["course"])
    for index in range(12):
        clock.advance(1)
        await post(auth_client, member_headers, opened("module_opened", course, "M1" if index % 2 else "M2"))

    body = (await auth_client.get(f"/api/v1/admin/learning/members/{await member_id(auth_session)}",
                                  headers=admin_headers)).json()

    assert len(body["recent_events"]) == 10
    assert await auth_session.scalar(select(func.count()).select_from(LearningEvent)) == 12
    times = [event["occurred_at"] for event in body["recent_events"]]
    assert times == sorted(times, reverse=True)


# ----------------------------------------------------------- course summary


async def test_a_course_page_sums_its_members(auth_client, admin_headers, member_headers, second,
                                              course, clock):
    course_id = course["course"]
    for headers in (member_headers, second):
        await enroll(auth_client, headers, course_id)
    await post(auth_client, member_headers, opened("course_opened", course))
    for lesson in ("M1-VIDEO-0", "M1-VIDEO-1", "M2-VIDEO-0"):
        await watch(auth_client, member_headers, course[lesson], 100)
    await watch(auth_client, second, course["M1-VIDEO-0"], 100)

    body = (await auth_client.get(f"{COURSES}/{course_id}/learning", headers=admin_headers)).json()

    assert body["course"]["id"] == course_id
    assert (body["total_modules"], body["total_video_lessons"]) == (3, 3)
    assert body["counts"] == {"all": 2, "not_started": 0, "in_progress": 1, "completed": 1, "started": 2}
    # (100 + 33.33) / 2 of the members who started, and 1 of 2 started completed.
    assert body["average_progress_percent"] == pytest.approx(66.67, abs=0.02)
    assert body["completion_rate_percent"] == 50

    # A course only one of the two members has touched: the average is of the
    # members who started, never diluted by the member who never did.
    other = await build_two_modules(auth_client, admin_headers)
    for headers in (member_headers, second):
        await enroll(auth_client, headers, other["course"])
    await watch(auth_client, member_headers, other["M1-VIDEO-0"], 100)
    half = (await auth_client.get(f"{COURSES}/{other['course']}/learning", headers=admin_headers)).json()
    assert half["counts"] == {"all": 2, "not_started": 1, "in_progress": 1, "completed": 0, "started": 1}
    assert half["average_progress_percent"] == pytest.approx(33.33, abs=0.02)
    assert half["completion_rate_percent"] == 0

    nobody = await build_two_modules(auth_client, admin_headers)
    empty = (await auth_client.get(f"{COURSES}/{nobody['course']}/learning", headers=admin_headers)).json()
    assert empty["counts"]["started"] == 0
    assert empty["average_progress_percent"] == 0 and empty["completion_rate_percent"] == 0


@pytest.mark.parametrize("state", ["draft", "archived", "missing"])
async def test_a_course_page_answers_404_for_a_course_no_member_can_reach(
        auth_client, admin_headers, state):
    if state == "missing":
        course_id = str(uuid4())
    else:
        ids = await build_two_modules(auth_client, admin_headers, publish=state == "archived")
        course_id = ids["course"]
        if state == "archived":
            assert (await auth_client.post(f"{COURSES}/{course_id}/archive", headers=admin_headers)).status_code == 200

    response = await auth_client.get(f"{COURSES}/{course_id}/learning", headers=admin_headers)

    assert response.status_code == 404
    assert response.json() == {"detail": "Published course not found"}


# ---------------------------------------------------------------- security


@pytest.mark.parametrize("path", [PROGRESS, ACTIVITY, "/api/v1/admin/learning/members/{member}",
                                  "/api/v1/admin/courses/{course}/learning"])
async def test_every_read_is_administrator_only(auth_client, auth_session, admin_headers,
                                                member_headers, course, path):
    url = path.replace("{member}", str(await member_id(auth_session))).replace("{course}", course["course"])

    assert (await auth_client.get(url)).status_code == 401
    assert (await auth_client.get(url, headers={"Authorization": "Bearer nope"})).status_code == 401
    # A member cannot read the tracking of anybody, including their own.
    assert (await auth_client.get(url, headers=member_headers)).status_code == 403
    assert (await auth_client.get(url, headers=admin_headers)).status_code == 200


async def test_an_inactive_administrator_is_refused(auth_client, auth_session, admin_headers, course):
    await auth_session.execute(update(User).where(User.email == "admin@example.com").values(is_active=False))
    await auth_session.commit()

    assert (await auth_client.get(PROGRESS, headers=admin_headers)).status_code == 401
    assert (await auth_client.get(ACTIVITY, headers=admin_headers)).status_code == 401


@pytest.mark.parametrize("who", ["unknown", "an administrator"])
async def test_a_member_page_answers_404_for_anybody_who_is_not_a_member(
        auth_client, auth_session, admin_headers, who):
    target = (uuid4() if who == "unknown"
              else await auth_session.scalar(select(User.id).where(User.email == "admin@example.com")))

    response = await auth_client.get(f"/api/v1/admin/learning/members/{target}", headers=admin_headers)

    assert response.status_code == 404
    assert response.json() == {"detail": "Member not found"}


async def test_changing_the_id_in_the_url_never_mixes_two_members(
        auth_client, auth_session, admin_headers, member_headers, second, course, clock):
    """The second member's work stays the second member's, whichever page is read."""
    for headers in (member_headers, second):
        await enroll(auth_client, headers, course["course"])
    await post(auth_client, second, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))
    for lesson in ("M1-VIDEO-0", "M1-VIDEO-1", "M2-VIDEO-0"):
        await watch(auth_client, second, course[lesson], 100)

    mine = (await auth_client.get(f"/api/v1/admin/learning/members/{await member_id(auth_session)}",
                                  headers=admin_headers)).json()
    theirs = (await auth_client.get(
        f"/api/v1/admin/learning/members/{await member_id(auth_session, 'second@example.com')}",
        headers=admin_headers)).json()

    assert [row["completed_video_lessons"] for row in mine["courses"]] == [0]
    assert mine["counts"]["not_started"] == 1 and mine["latest"] is None and mine["recent_events"] == []
    assert mine["last_activity_at"] is None
    assert theirs["courses"][0]["completed_video_lessons"] == 3
    assert theirs["counts"]["completed"] == 1 and theirs["latest"]["lesson"]["title"] == "M1-VIDEO-0"


# -------------------------------------------------------------- performance


async def test_a_page_of_the_matrix_costs_two_statements(auth_client, auth_session, admin_headers,
                                                         member_headers, second, course, clock):
    """Whatever the number of members, courses, modules or lessons."""
    await build_two_modules(auth_client, admin_headers)
    for headers in (member_headers, second):
        await enroll(auth_client, headers, course["course"])
    await watch(auth_client, member_headers, course["M1-VIDEO-0"], 100)
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        page = await rows(auth_client, admin_headers, page_size=100)
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert page["total"] == 4
    # The acting administrator, the rows, the counts.
    assert len(statements) == 3, statements


async def test_the_activity_list_costs_a_bounded_number_of_statements(
        auth_client, auth_session, admin_headers, member_headers, second, course, clock):
    for headers in (member_headers, second):
        await enroll(auth_client, headers, course["course"])
    await post(auth_client, member_headers, opened("lesson_opened", course, "M1", "M1-VIDEO-0"))
    await post(auth_client, second, opened("lesson_opened", course, "M2", "M2-VIDEO-0"))
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        body = (await auth_client.get(ACTIVITY, headers=admin_headers, params={"page_size": 100})).json()
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert len(body["items"]) == 2
    # The acting administrator, the rows, the total, the members with activity.
    assert len(statements) == 4, statements


async def test_the_contract_as_published(auth_client, admin_headers):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()

    for path in ("/api/v1/admin/learning/progress", "/api/v1/admin/learning/activity",
                 "/api/v1/admin/learning/members/{member_id}", "/api/v1/admin/courses/{course_id}/learning"):
        operation = schema["paths"][path]["get"]
        assert operation["security"] == [{"HTTPBearer": []}]
        assert {"200", "401", "403", "404", "422"} <= operation["responses"].keys()
        assert list(schema["paths"][path]) == ["get"]

    parameters = {p["name"] for p in schema["paths"]["/api/v1/admin/learning/progress"]["get"]["parameters"]}
    assert parameters == {"page", "page_size", "search", "course_id", "member_id", "status", "active_since", "sort"}
    row = schema["components"]["schemas"]["MemberCourseProgress"]
    assert set(row["properties"]) == ROW_FIELDS
    assert schema["components"]["schemas"]["CourseLearningStatus"]["enum"] == [
        "NOT_STARTED", "IN_PROGRESS", "COMPLETED"]
