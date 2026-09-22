"""FE-17: the administrator listing reports how large each course is.

``CourseResponse`` carried no module or lesson count, so the dashboard's
"Recently created courses" table had nothing real to put in its Modules and
Lessons columns. The listing now returns both, and accepts ``sort`` so the
newest course can come first.

The counting tests fail against the previous implementation - the two fields
were absent from the response. The ordering tests fail there too: ``sort`` was
not a parameter, so it was ignored and the listing stayed oldest-first.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course

from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_courses import (
    COURSES, create_course, create_lesson, create_module, member_headers,
)
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
async def enforce_foreign_keys(auth_session: AsyncSession) -> None:
    await auth_session.execute(text("PRAGMA foreign_keys=ON"))
    await auth_session.commit()


async def listing(client, headers, **params) -> dict:
    response = await client.get(COURSES, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def row_for(client, headers, course_id: str, **params) -> dict:
    page = await listing(client, headers, page_size=100, **params)
    found = [item for item in page["items"] if item["id"] == course_id]
    assert len(found) == 1
    return found[0]


async def created_in_order(session: AsyncSession, client, headers, titles: list[str]) -> list[dict]:
    """Courses whose creation times are genuinely distinct, one day apart.

    SQLite's ``CURRENT_TIMESTAMP`` has one-second resolution, so courses made
    inside the same test share a ``created_at`` and the tie-break on ``id`` - a
    random UUID - decides the order. Postgres records microseconds and a
    distinct transaction time per request, so this is an artefact of the test
    database rather than of the endpoint. Stamping the rows removes it and
    makes these tests about ordering rather than about clock resolution.
    """
    courses = []
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for offset, title in enumerate(titles):
        course = await create_course(client, headers, title=title, slug=title.lower().replace(" ", "-"))
        await session.execute(update(Course).where(Course.id == UUID(course["id"]))
                              .values(created_at=base + timedelta(days=offset)))
        courses.append(course)
    await session.commit()
    return courses


async def build(client, headers, *, modules: int, lessons_each: int, **changes) -> dict:
    """A course of a known shape, so the counts have something to be wrong about."""
    course = await create_course(client, headers, **changes)
    for module_index in range(1, modules + 1):
        module = await create_module(client, headers, course["id"],
                                     title=f"Module {module_index}", position=module_index)
        for lesson_index in range(1, lessons_each + 1):
            await create_lesson(client, headers, module["id"],
                                title=f"Lesson {module_index}.{lesson_index}", position=lesson_index)
    return course


# ------------------------------------------------------------------- counting

async def test_the_counts_are_real(auth_client, admin_headers):
    """Three modules, four lessons each: twelve lessons across the course."""
    course = await build(auth_client, admin_headers, modules=3, lessons_each=4,
                         title="Counted", slug="counted")

    row = await row_for(auth_client, admin_headers, course["id"])

    assert row["module_count"] == 3
    assert row["lesson_count"] == 12


async def test_a_course_with_no_modules_counts_zero(auth_client, admin_headers):
    """Zero here is the true count, not a fallback for a missing field."""
    course = await create_course(auth_client, admin_headers, title="Empty", slug="empty")

    row = await row_for(auth_client, admin_headers, course["id"])

    assert row["module_count"] == 0
    assert row["lesson_count"] == 0


async def test_modules_without_lessons_are_still_counted(auth_client, admin_headers):
    course = await build(auth_client, admin_headers, modules=2, lessons_each=0,
                         title="Outline only", slug="outline-only")

    row = await row_for(auth_client, admin_headers, course["id"])

    assert row["module_count"] == 2
    assert row["lesson_count"] == 0


async def test_lessons_of_one_course_are_not_counted_for_another(auth_client, admin_headers):
    """The lesson count joins through modules, so it must not leak sideways."""
    mine = await build(auth_client, admin_headers, modules=1, lessons_each=3,
                       title="Mine", slug="mine")
    theirs = await build(auth_client, admin_headers, modules=1, lessons_each=0,
                         title="Theirs", slug="theirs")

    assert (await row_for(auth_client, admin_headers, mine["id"]))["lesson_count"] == 3
    assert (await row_for(auth_client, admin_headers, theirs["id"]))["lesson_count"] == 0


async def test_the_counts_follow_a_deletion(auth_client, admin_headers):
    course = await build(auth_client, admin_headers, modules=2, lessons_each=2,
                         title="Shrinking", slug="shrinking")
    modules = (await auth_client.get(f"{COURSES}/{course['id']}/modules",
                                     headers=admin_headers)).json()["items"]

    removed = await auth_client.delete(f"/api/v1/admin/modules/{modules[0]['id']}",
                                       headers=admin_headers)
    assert removed.status_code == 204

    row = await row_for(auth_client, admin_headers, course["id"])
    assert row["module_count"] == 1
    # The deleted module took its two lessons with it.
    assert row["lesson_count"] == 2


# ------------------------------------------------------- across every lifecycle

@pytest.mark.parametrize("lifecycle,expected", [
    ([], "DRAFT"),
    (["publish"], "PUBLISHED"),
    (["publish", "archive"], "ARCHIVED"),
])
async def test_counts_are_reported_in_every_status(auth_client, admin_headers, lifecycle, expected):
    slug = expected.lower()
    course = await build(auth_client, admin_headers, modules=2, lessons_each=3,
                         title=f"Course {slug}", slug=slug)
    for step in lifecycle:
        assert (await auth_client.post(f"{COURSES}/{course['id']}/{step}",
                                       headers=admin_headers)).status_code == 200

    row = await row_for(auth_client, admin_headers, course["id"], status=expected)

    assert row["status"] == expected
    assert row["module_count"] == 2
    assert row["lesson_count"] == 6


# -------------------------------------------------------------------- ordering

async def test_the_newest_course_comes_first_when_asked(auth_client, admin_headers, auth_session):
    titles = ["First", "Second", "Third"]
    await created_in_order(auth_session, auth_client, admin_headers, titles)

    newest = await listing(auth_client, admin_headers, sort="-created_at", page_size=100)

    ordered = [item["title"] for item in newest["items"]]
    assert ordered == list(reversed(titles))
    assert [item["created_at"] for item in newest["items"]] == sorted(
        (item["created_at"] for item in newest["items"]), reverse=True)


async def test_the_default_order_is_unchanged(auth_client, admin_headers, auth_session):
    """Omitting `sort` must return exactly what it always returned: oldest first."""
    titles = ["First", "Second", "Third"]
    await created_in_order(auth_session, auth_client, admin_headers, titles)

    default = await listing(auth_client, admin_headers, page_size=100)
    explicit = await listing(auth_client, admin_headers, sort="created_at", page_size=100)

    assert [item["title"] for item in default["items"]] == titles
    assert default == explicit


async def test_the_newest_page_is_limited_and_still_reports_the_total(
    auth_client, admin_headers, auth_session,
):
    """What the dashboard asks for: the five newest, and how many exist."""
    await created_in_order(auth_session, auth_client, admin_headers,
                           [f"Course {index}" for index in range(1, 8)])

    page = await listing(auth_client, admin_headers, sort="-created_at", page_size=5)

    assert len(page["items"]) == 5
    assert page["total"] == 7
    assert [item["title"] for item in page["items"]] == [f"Course {index}" for index in range(7, 2, -1)]


async def test_an_unknown_sort_is_refused(auth_client, admin_headers):
    """The parameter is a closed vocabulary, not free text handed to ORDER BY."""
    for value in ("title", "-title", "created_at; DROP TABLE courses", ""):
        response = await auth_client.get(COURSES, headers=admin_headers, params={"sort": value})
        assert response.status_code == 422, value


async def test_sorting_composes_with_the_existing_filters(auth_client, admin_headers, auth_session):
    courses = await created_in_order(auth_session, auth_client, admin_headers,
                                     ["Filtered 1", "Filtered 2", "Filtered 3", "Unrelated"])
    for index in (0, 2):
        assert (await auth_client.post(f"{COURSES}/{courses[index]['id']}/publish",
                                       headers=admin_headers)).status_code == 200

    page = await listing(auth_client, admin_headers, sort="-created_at",
                         status="PUBLISHED", search="Filtered")

    assert [item["title"] for item in page["items"]] == ["Filtered 3", "Filtered 1"]
    assert page["total"] == 2


# ------------------------------------------------------------------- the shape

async def test_the_listing_keeps_every_field_it_had(auth_client, admin_headers):
    """Additive: the two counts join the row, nothing is taken away."""
    course = await create_course(auth_client, admin_headers, title="Shape", slug="shape")

    row = await row_for(auth_client, admin_headers, course["id"])

    assert set(row) == set(course) | {"module_count", "lesson_count"}
    for field, value in course.items():
        assert row[field] == value


async def test_the_single_course_response_is_untouched(auth_client, admin_headers):
    """The counts are a listing concern; `GET /{id}` keeps its old contract."""
    course = await build(auth_client, admin_headers, modules=1, lessons_each=1,
                         title="Single", slug="single")

    response = await auth_client.get(f"{COURSES}/{course['id']}", headers=admin_headers)

    assert response.status_code == 200
    assert "module_count" not in response.json()
    assert "lesson_count" not in response.json()


async def test_the_member_catalogue_gains_only_what_its_outline_already_shows(
    auth_client, admin_headers, member_headers,
):
    """No administrator information reaches the catalogue.

    BE-COURSE-CATALOG-01 (G05) gives catalogue rows ``module_count`` and
    ``total_video_lessons``, as the Data-Needs board asks for the member's
    course card. Neither is administrator information: a signed-in member can
    already list every module and lesson of a published course through
    ``GET /courses/{id}/modules`` and ``GET /modules/{id}/lessons``. So the row
    must carry exactly those figures, and still none of the administrator
    listing's fields - ``lesson_count`` included.
    """
    course = await build(auth_client, admin_headers, modules=2, lessons_each=2,
                         title="Catalogued", slug="catalogued")
    await auth_client.post(f"{COURSES}/{course['id']}/publish", headers=admin_headers)

    page = await auth_client.get("/api/v1/courses", headers=member_headers)

    assert page.status_code == 200
    [item] = page.json()["items"]
    for field in ("lesson_count", "created_by", "created_at", "updated_at", "archived_at"):
        assert field not in item
    modules = (await auth_client.get(f"/api/v1/courses/{course['id']}/modules",
                                     headers=member_headers)).json()["items"]
    lessons = [lesson for module in modules for lesson in (await auth_client.get(
        f"/api/v1/modules/{module['id']}/lessons", headers=member_headers)).json()["items"]]
    assert item["module_count"] == len(modules) == 2
    assert item["total_video_lessons"] == sum(l["content_type"] == "VIDEO" for l in lessons) == 0


# ------------------------------------------------------------------- authorization

async def test_the_counts_are_not_exposed_to_anyone_but_an_administrator(
    auth_client, admin_headers, member_headers,
):
    await build(auth_client, admin_headers, modules=1, lessons_each=1,
                title="Protected", slug="protected")

    assert (await auth_client.get(COURSES)).status_code == 401
    assert (await auth_client.get(COURSES, headers=member_headers)).status_code == 403


# ------------------------------------------------------------------ no N+1

async def test_a_page_of_courses_costs_one_statement_per_page(auth_client, admin_headers, auth_session):
    """The point of the aggregate: rows do not multiply statements.

    Counting emitted SQL rather than timing anything - a query per course, or
    per module, is what this endpoint must never do.
    """
    from sqlalchemy import event

    for index in range(1, 7):
        course = await build(auth_client, admin_headers, modules=2, lessons_each=2,
                             title=f"Busy {index}", slug=f"busy-{index}")
        assert course["id"]

    statements: list[str] = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = auth_session.get_bind()
    engine = getattr(engine, "sync_engine", engine)
    event.listen(engine, "before_cursor_execute", record)
    try:
        page = await listing(auth_client, admin_headers, sort="-created_at", page_size=6)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    assert len(page["items"]) == 6
    assert all(item["module_count"] == 2 and item["lesson_count"] == 4 for item in page["items"])

    selects = [statement for statement in statements if statement.lstrip().upper().startswith("SELECT")]
    reads_courses = [statement for statement in selects if "FROM courses" in statement]
    # One count(*) for the total, one for the page. Authentication reads the
    # user row, which is why every SELECT is not asserted on.
    assert len(reads_courses) == 2, reads_courses
    assert not any("FROM modules" in statement and "FROM courses" not in statement
                   for statement in selects)
