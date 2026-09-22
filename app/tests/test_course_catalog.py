"""BE-COURSE-CATALOG-01: the member catalogue's tabs (G04) and course sizes (G05).

G04: ``GET /courses`` could not tell a member's courses apart, so the
Catalogue board's "All / Not enrolled / In progress / Completed" tabs and their
counts had nothing to stand on - filtering one page on the client would have
made every count wrong. The endpoint now filters by the caller's enrollment
state in SQL (``enrollment``) and returns every tab's size
(``enrollment_counts``).

G05: neither the catalogue rows nor ``GET /me/enrollments`` carried the
"3 modules · 11 videos" and "5 of 11 videos completed" figures. Catalogue rows
now carry ``module_count`` and ``total_video_lessons``; enrollment summaries
also carry ``completed_video_lessons``.

Every figure is asserted against a course whose shape the test built, so a
count that is merely plausible cannot pass.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.tests.test_auth import PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_courses import (
    CATALOG_FIELDS, COURSES, create_course, create_lesson, create_module, member_headers,
)
from app.tests.test_enrollments import enroll, watch
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

CATALOG = "/api/v1/courses"
ITEM_FIELDS = CATALOG_FIELDS | {"module_count", "total_video_lessons"}


@pytest.fixture(autouse=True)
async def enforce_foreign_keys(auth_session: AsyncSession) -> None:
    await auth_session.execute(text("PRAGMA foreign_keys=ON"))
    await auth_session.commit()


async def course_of(client: AsyncClient, headers: dict, title: str, modules: list[list[str]],
                    *, publish: bool = True) -> dict:
    """A course whose modules hold lessons of the given kinds, in order.

    ``[["VIDEO", "TEXT"], ["DOCUMENT"]]`` is two modules: a video and a text,
    then a document. Returns the course and its VIDEO lessons.
    """
    course = await create_course(client, headers, title=title, slug=f"{title.lower().replace(' ', '-')}-{uuid4().hex[:6]}")
    videos = []
    for module_position, kinds in enumerate(modules, start=1):
        module = await create_module(client, headers, course["id"], title=f"M{module_position}",
                                     position=module_position)
        for position, kind in enumerate(kinds, start=1):
            fields = {
                "VIDEO": {"content": "storage://videos/intro.mp4", "duration_seconds": 100},
                "DOCUMENT": {"content": "https://example.com/doc.pdf"},
                "LINK": {"content": "https://example.com/"},
                "TEXT": {"content": "Read this."},
            }[kind]
            lesson = await create_lesson(client, headers, module["id"], title=f"{kind} {position}",
                                         position=position, content_type=kind, **fields)
            if kind == "VIDEO":
                videos.append(lesson)
    if publish:
        assert (await client.post(f"{COURSES}/{course['id']}/publish", headers=headers)).status_code == 200
    return {"course": course, "videos": videos}


@pytest.fixture
async def catalogue(auth_client, admin_headers, member_headers) -> dict:
    """Five published courses in every state for the member, plus two never listed.

    Alpha Python    2 modules, 3 videos (+ text, document)   enrolled, all watched -> completed
    Beta Data       1 module, 2 videos                        enrolled, 1 watched   -> in_progress
    Gamma Empty     no module at all                          enrolled              -> in_progress
    Delta Reading   1 module, text and link only              not enrolled
    Epsilon Python  1 module, 1 video                         not enrolled
    Zeta Draft      draft                                     never listed
    Eta Archived    archived after the member enrolled        never listed
    """
    c = auth_client
    alpha = await course_of(c, admin_headers, "Alpha Python", [["VIDEO", "VIDEO", "TEXT"], ["VIDEO", "DOCUMENT"]])
    beta = await course_of(c, admin_headers, "Beta Data", [["VIDEO", "VIDEO"]])
    gamma = await course_of(c, admin_headers, "Gamma Empty", [])
    delta = await course_of(c, admin_headers, "Delta Reading", [["TEXT", "LINK"]])
    epsilon = await course_of(c, admin_headers, "Epsilon Python", [["VIDEO"]])
    zeta = await course_of(c, admin_headers, "Zeta Draft", [["VIDEO"]], publish=False)
    eta = await course_of(c, admin_headers, "Eta Archived", [["VIDEO"]])

    for entry in (alpha, beta, gamma, eta):
        await enroll(c, member_headers, entry["course"]["id"])
    for video in alpha["videos"]:
        assert (await watch(c, member_headers, video["id"], 100)).status_code == 200
    assert (await watch(c, member_headers, beta["videos"][0]["id"], 100)).status_code == 200
    assert (await watch(c, member_headers, eta["videos"][0]["id"], 100)).status_code == 200
    assert (await c.post(f"{COURSES}/{eta['course']['id']}/archive", headers=admin_headers)).status_code == 200
    return {"alpha": alpha, "beta": beta, "gamma": gamma, "delta": delta, "epsilon": epsilon,
            "zeta": zeta, "eta": eta}


async def get_page(client: AsyncClient, headers: dict, **params) -> dict:
    response = await client.get(CATALOG, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def titles(page: dict) -> list[str]:
    return [item["title"] for item in page["items"]]


async def second_member(client: AsyncClient, session: AsyncSession, password_hash: str) -> dict:
    session.add(User(email="second@example.com", hashed_password=password_hash,
                     first_name="Second", last_name="Member"))
    await session.commit()
    response = await client.post("/api/v1/auth/login", json={"email": "second@example.com", "password": PASSWORD})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ============================================================ G05: course sizes

async def test_each_row_carries_its_real_module_and_video_counts(auth_client, member_headers, catalogue):
    page = await get_page(auth_client, member_headers, page_size=100)

    sizes = {item["title"]: (item["module_count"], item["total_video_lessons"]) for item in page["items"]}
    assert sizes == {
        "Alpha Python": (2, 3),     # the text and the document are not videos
        "Beta Data": (1, 2),
        "Gamma Empty": (0, 0),      # an empty course is 0 and 0, not a missing value
        "Delta Reading": (1, 0),    # a module of text and a link: one module, no video
        "Epsilon Python": (1, 1),
    }


async def test_a_row_keeps_every_course_field_and_adds_only_the_two_counts(auth_client, member_headers, catalogue):
    page = await get_page(auth_client, member_headers, page_size=100)

    for item in page["items"]:
        assert set(item) == ITEM_FIELDS
    alpha = next(item for item in page["items"] if item["title"] == "Alpha Python")
    single = (await auth_client.get(f"{CATALOG}/{alpha['id']}", headers=member_headers)).json()
    # The single-course read is unchanged; the list row is that plus the counts.
    assert set(single) == CATALOG_FIELDS
    assert {field: alpha[field] for field in CATALOG_FIELDS} == single


async def test_the_counts_equal_what_the_public_outline_shows(auth_client, member_headers, catalogue):
    """The figures are the member's own outline, counted - nothing the member could not see."""
    page = await get_page(auth_client, member_headers, page_size=100)

    for item in page["items"]:
        modules = (await auth_client.get(f"{CATALOG}/{item['id']}/modules", headers=member_headers,
                                         params={"page_size": 100})).json()["items"]
        lessons = [lesson for module in modules for lesson in (await auth_client.get(
            f"/api/v1/modules/{module['id']}/lessons", headers=member_headers,
            params={"page_size": 100})).json()["items"]]
        assert item["module_count"] == len(modules)
        assert item["total_video_lessons"] == sum(lesson["content_type"] == "VIDEO" for lesson in lessons)


async def test_videos_of_one_course_are_never_counted_for_another(auth_client, admin_headers, member_headers):
    """Counted through each course's own modules: nothing leaks sideways."""
    await course_of(auth_client, admin_headers, "Big", [["VIDEO", "VIDEO"], ["VIDEO"]])
    await course_of(auth_client, admin_headers, "Small", [["TEXT"]])

    page = await get_page(auth_client, member_headers)

    sizes = {item["title"]: (item["module_count"], item["total_video_lessons"]) for item in page["items"]}
    assert sizes == {"Big": (2, 3), "Small": (1, 0)}


async def test_the_counts_follow_the_course_as_it_is_built(auth_client, admin_headers, member_headers):
    """Read from the database on every request, never cached or stored."""
    built = await course_of(auth_client, admin_headers, "Growing", [["VIDEO"]], publish=False)
    module = await create_module(auth_client, admin_headers, built["course"]["id"], title="M2", position=2)
    await create_lesson(auth_client, admin_headers, module["id"], content_type="VIDEO",
                        content="storage://videos/b.mp4", duration_seconds=50)
    assert (await auth_client.post(f"{COURSES}/{built['course']['id']}/publish",
                                   headers=admin_headers)).status_code == 200

    [item] = (await get_page(auth_client, member_headers))["items"]
    assert (item["module_count"], item["total_video_lessons"]) == (2, 2)


async def test_enrollment_summaries_carry_the_figures_behind_their_percentage(
    auth_client, member_headers, catalogue,
):
    response = await auth_client.get("/api/v1/me/enrollments", headers=member_headers, params={"page_size": 100})
    assert response.status_code == 200
    rows = {row["title"]: row for row in response.json()["items"]}

    figures = {title: (row["module_count"], row["total_video_lessons"], row["completed_video_lessons"])
               for title, row in rows.items()}
    assert figures == {
        "Alpha Python": (2, 3, 3),
        "Beta Data": (1, 2, 1),
        "Gamma Empty": (0, 0, 0),
        # The enrollment history keeps an archived course, with its real figures.
        "Eta Archived": (1, 1, 1),
    }
    # The same numbers as the percentage and the completion beside them.
    assert rows["Beta Data"]["progress_percent"] == 50 and rows["Beta Data"]["completed"] is False
    assert rows["Alpha Python"]["progress_percent"] == 100 and rows["Alpha Python"]["completed"] is True
    assert rows["Gamma Empty"]["progress_percent"] == 0 and rows["Gamma Empty"]["completed"] is False


async def test_enrollment_figures_match_the_course_progress_endpoint(auth_client, member_headers, catalogue):
    """One rule, three reads: the summary, the progress endpoint and the course tree agree."""
    rows = (await auth_client.get("/api/v1/me/enrollments", headers=member_headers,
                                  params={"page_size": 100})).json()["items"]
    for row in rows:
        if row["title"] == "Eta Archived":
            continue  # Archived: no longer readable through the course endpoints.
        progress = (await auth_client.get(f"{CATALOG}/{row['course_id']}/progress", headers=member_headers)).json()
        content = (await auth_client.get(f"{CATALOG}/{row['course_id']}/content", headers=member_headers)).json()
        assert row["total_video_lessons"] == progress["total_video_lessons"] == content["total_video_lessons"]
        assert row["completed_video_lessons"] == progress["completed_video_lessons"] == content["completed_video_lessons"]
        assert row["module_count"] == len(content["modules"])


# ============================================================ G04: the tabs

async def test_every_tab_is_counted_for_the_caller(auth_client, member_headers, catalogue):
    page = await get_page(auth_client, member_headers)

    assert page["enrollment_counts"] == {"all": 5, "not_enrolled": 2, "in_progress": 2, "completed": 1}
    assert page["total"] == 5


@pytest.mark.parametrize("tab,expected", [
    ("not_enrolled", ["Delta Reading", "Epsilon Python"]),
    # A course with no video is enrolled and can never complete: in progress.
    ("in_progress", ["Beta Data", "Gamma Empty"]),
    ("completed", ["Alpha Python"]),
])
async def test_a_tab_keeps_exactly_its_courses(auth_client, member_headers, catalogue, tab, expected):
    page = await get_page(auth_client, member_headers, enrollment=tab)

    assert sorted(titles(page)) == expected
    assert page["total"] == len(expected)
    # The other tabs are still sized: the counts ignore the page's own filter.
    assert page["enrollment_counts"] == {"all": 5, "not_enrolled": 2, "in_progress": 2, "completed": 1}


async def test_no_tab_lists_a_draft_or_an_archived_course(auth_client, member_headers, catalogue):
    """Eta was enrolled and fully watched, then archived: the catalogue no longer shows it."""
    for tab in (None, "not_enrolled", "in_progress", "completed"):
        page = await get_page(auth_client, member_headers, page_size=100, **({"enrollment": tab} if tab else {}))
        assert "Zeta Draft" not in titles(page) and "Eta Archived" not in titles(page)


async def test_the_tabs_are_the_caller_s_own(auth_client, auth_session, password_hash, admin_headers,
                                              member_headers, catalogue):
    other = await second_member(auth_client, auth_session, password_hash)

    theirs = await get_page(auth_client, other)
    assert theirs["enrollment_counts"] == {"all": 5, "not_enrolled": 5, "in_progress": 0, "completed": 0}
    assert (await get_page(auth_client, other, enrollment="completed"))["items"] == []

    # An administrator reads the same catalogue with their own - here empty - enrollments.
    admins = await get_page(auth_client, admin_headers)
    assert admins["enrollment_counts"]["not_enrolled"] == 5


async def test_another_member_s_progress_never_moves_my_course(
    auth_client, auth_session, password_hash, member_headers, catalogue,
):
    """Both enrolled in Alpha: only the one who watched it has completed it."""
    other = await second_member(auth_client, auth_session, password_hash)
    await enroll(auth_client, other, catalogue["alpha"]["course"]["id"])

    theirs = await get_page(auth_client, other)
    assert theirs["enrollment_counts"] == {"all": 5, "not_enrolled": 4, "in_progress": 1, "completed": 0}
    assert titles(await get_page(auth_client, other, enrollment="in_progress")) == ["Alpha Python"]
    # And the first member's tab is untouched by the second one's enrollment.
    assert titles(await get_page(auth_client, member_headers, enrollment="completed")) == ["Alpha Python"]
    summary = (await auth_client.get("/api/v1/me/enrollments", headers=other)).json()["items"][0]
    assert (summary["total_video_lessons"], summary["completed_video_lessons"]) == (3, 0)


async def test_a_course_changes_tab_as_the_member_progresses(auth_client, member_headers, catalogue):
    before = await get_page(auth_client, member_headers, enrollment="completed")
    assert titles(before) == ["Alpha Python"]

    assert (await watch(auth_client, member_headers, catalogue["beta"]["videos"][1]["id"], 100)).status_code == 200
    await enroll(auth_client, member_headers, catalogue["delta"]["course"]["id"])

    after = await get_page(auth_client, member_headers)
    assert after["enrollment_counts"] == {"all": 5, "not_enrolled": 1, "in_progress": 2, "completed": 2}
    assert sorted(titles(await get_page(auth_client, member_headers, enrollment="completed"))) == [
        "Alpha Python", "Beta Data"]


async def test_an_empty_catalogue_counts_zero_everywhere(auth_client, member_headers):
    page = await get_page(auth_client, member_headers)

    assert page["items"] == [] and page["total"] == 0
    assert page["enrollment_counts"] == {"all": 0, "not_enrolled": 0, "in_progress": 0, "completed": 0}


# ============================================================ search, pagination, validation

async def test_search_narrows_the_page_and_the_counts_alike(auth_client, member_headers, catalogue):
    page = await get_page(auth_client, member_headers, search="python")

    assert sorted(titles(page)) == ["Alpha Python", "Epsilon Python"]
    assert page["enrollment_counts"] == {"all": 2, "not_enrolled": 1, "in_progress": 0, "completed": 1}

    combined = await get_page(auth_client, member_headers, search="PYTHON", enrollment="completed")
    assert titles(combined) == ["Alpha Python"] and combined["total"] == 1


@pytest.mark.parametrize("search", ["  python  ", "Python"])
async def test_search_is_trimmed_and_case_insensitive(auth_client, member_headers, catalogue, search):
    page = await get_page(auth_client, member_headers, search=search)

    assert sorted(titles(page)) == ["Alpha Python", "Epsilon Python"]


@pytest.mark.parametrize("search", ["", "   "])
async def test_a_blank_search_is_no_search(auth_client, member_headers, catalogue, search):
    page = await get_page(auth_client, member_headers, search=search)

    assert page["total"] == 5 and page["enrollment_counts"]["all"] == 5


@pytest.mark.parametrize("search", ["' OR 1=1 --", "%", "_", "Alpha%' UNION SELECT * FROM users --"])
async def test_search_is_literal_never_sql(auth_client, member_headers, catalogue, search):
    page = await get_page(auth_client, member_headers, search=search)

    assert page["items"] == [] and page["total"] == 0
    assert page["enrollment_counts"]["all"] == 0


async def test_a_search_with_no_match_is_an_empty_page(auth_client, member_headers, catalogue):
    page = await get_page(auth_client, member_headers, search="Kubernetes", enrollment="in_progress")

    assert page == {"items": [], "total": 0, "page": 1, "page_size": 20,
                    "enrollment_counts": {"all": 0, "not_enrolled": 0, "in_progress": 0, "completed": 0}}


async def test_pagination_applies_after_the_filter(auth_client, member_headers, catalogue):
    first = await get_page(auth_client, member_headers, enrollment="not_enrolled", page_size=1, page=1)
    second = await get_page(auth_client, member_headers, enrollment="not_enrolled", page_size=1, page=2)

    assert first["total"] == second["total"] == 2
    assert len(first["items"]) == len(second["items"]) == 1
    assert {titles(first)[0], titles(second)[0]} == {"Delta Reading", "Epsilon Python"}
    assert (second["page"], second["page_size"]) == (2, 1)


async def test_a_page_past_the_end_is_empty_but_keeps_its_totals(auth_client, member_headers, catalogue):
    page = await get_page(auth_client, member_headers, enrollment="in_progress", page_size=1, page=3)

    assert page["items"] == []
    assert page["total"] == 2
    assert page["enrollment_counts"]["in_progress"] == 2


async def test_pages_are_ordered_and_never_repeat_a_course(auth_client, member_headers, catalogue):
    seen = []
    for number in range(1, 6):
        seen += titles(await get_page(auth_client, member_headers, page_size=1, page=number))
    everything = titles(await get_page(auth_client, member_headers, page_size=100))

    assert seen == everything and len(set(seen)) == 5


@pytest.mark.parametrize("params", [
    {"enrollment": "enrolled"}, {"enrollment": "COMPLETED"}, {"enrollment": ""},
    {"page": 0}, {"page": -1}, {"page_size": 0}, {"page_size": 101}, {"page_size": 100000},
    {"search": "x" * 201}, {"page": "one"},
])
async def test_invalid_parameters_are_refused(auth_client, member_headers, params):
    assert (await auth_client.get(CATALOG, headers=member_headers, params=params)).status_code == 422


async def test_a_status_parameter_cannot_reveal_drafts_or_archives(auth_client, member_headers, catalogue):
    """The catalogue has no status filter: it is always PUBLISHED, whatever is asked."""
    for status in ("DRAFT", "ARCHIVED", "PUBLISHED"):
        page = await get_page(auth_client, member_headers, status=status, page_size=100)
        assert page["total"] == 5
        assert {item["status"] for item in page["items"]} == {"PUBLISHED"}


# ============================================================ permissions

async def test_the_catalogue_requires_a_signed_in_account(auth_client, catalogue):
    for params in ({}, {"enrollment": "completed"}):
        assert (await auth_client.get(CATALOG, params=params)).status_code == 401
    bad = {"Authorization": "Bearer not-a-token"}
    assert (await auth_client.get(CATALOG, headers=bad)).status_code == 401


async def test_an_inactive_member_cannot_read_the_catalogue(auth_client, auth_session, member_headers, catalogue):
    await auth_session.execute(text("UPDATE users SET is_active = 0 WHERE email = 'member@example.com'"))
    await auth_session.commit()

    assert (await auth_client.get(CATALOG, headers=member_headers)).status_code == 401


async def test_members_and_administrators_both_read_it(auth_client, admin_headers, member_headers, catalogue):
    for headers in (member_headers, admin_headers):
        page = await get_page(auth_client, headers)
        assert page["total"] == 5
        for item in page["items"]:
            assert "lesson_count" not in item and "created_by" not in item


async def test_an_unknown_or_hidden_course_is_not_found(auth_client, member_headers, catalogue):
    for course_id in (str(uuid4()), catalogue["zeta"]["course"]["id"], catalogue["eta"]["course"]["id"]):
        response = await auth_client.get(f"{CATALOG}/{course_id}", headers=member_headers)
        assert response.status_code == 404


# ============================================================ query count

async def statements_for(client: AsyncClient, session: AsyncSession, headers: dict, path: str, **params) -> list[str]:
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await client.get(path, headers=headers, params=params)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200
    return statements


async def test_the_catalogue_costs_the_same_few_queries_however_large(
    auth_client, auth_session, admin_headers, member_headers,
):
    """Current user, tab counts, page: never a query per course, module or lesson."""
    await course_of(auth_client, admin_headers, "Only", [["VIDEO"]])
    small = await statements_for(auth_client, auth_session, member_headers, CATALOG)

    for index in range(6):
        entry = await course_of(auth_client, admin_headers, f"More {index}", [["VIDEO", "TEXT"], ["VIDEO"], []])
        await enroll(auth_client, member_headers, entry["course"]["id"])
    large = await statements_for(auth_client, auth_session, member_headers, CATALOG, enrollment="in_progress")

    assert len(large) == len(small) <= 3


async def test_enrollment_summaries_still_cost_three_queries(auth_client, auth_session, admin_headers,
                                                             member_headers, catalogue):
    statements = await statements_for(auth_client, auth_session, member_headers, "/api/v1/me/enrollments",
                                      page_size=100)

    assert len(statements) <= 3  # Current user, enrollment total, aggregate page.


# ============================================================ OpenAPI

async def test_the_contract_is_documented(auth_client):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()

    operation = schema["paths"]["/api/v1/courses"]["get"]
    parameter = next(p for p in operation["parameters"] if p["name"] == "enrollment")
    assert parameter["required"] is False
    components = schema["components"]["schemas"]
    assert set(components["EnrollmentFilter"]["enum"]) == {"not_enrolled", "in_progress", "completed"}
    assert set(components["CatalogCourseListItem"]["properties"]) == ITEM_FIELDS
    assert set(components["CatalogEnrollmentCounts"]["properties"]) == {
        "all", "not_enrolled", "in_progress", "completed"}
    assert {"module_count", "total_video_lessons", "completed_video_lessons"} <= set(
        components["EnrollmentSummary"]["properties"])
    # The single-course projection keeps its old shape.
    assert set(components["CatalogCourse"]["properties"]) == CATALOG_FIELDS
