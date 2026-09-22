"""BE-COURSE-REORDER-01: ``PUT /admin/courses/{id}/structure``.

One request reorders a draft course's modules, reorders the lessons of its
modules and moves lessons between them, in one transaction. Before it,
swapping two rows took three ``PATCH`` requests, because positions are unique
per parent and checked row by row, and a lesson could not change module at all.

Every test starts from a course whose stored positions have gaps, so the
renumbering to 1..n is exercised rather than assumed.
"""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event, select, text, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lesson import Lesson
from app.models.module import Module
from app.models.user import User
from app.services.structure_service import StructureService, free_positions
from app.tests.test_auth import PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_courses import COURSES, create_course, create_lesson, create_module, member_headers
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

MISMATCH = "The submitted structure does not match the course; reload it and try again"


@pytest.fixture(autouse=True)
async def enforce_foreign_keys(auth_session: AsyncSession) -> None:
    await auth_session.execute(text("PRAGMA foreign_keys=ON"))
    await auth_session.commit()


def structure_path(course_id: str) -> str:
    return f"{COURSES}/{course_id}/structure"


async def build(client: AsyncClient, headers: dict, title: str, shape: dict[str, list[str]],
                *, gap: int = 3) -> dict:
    """A draft course of named modules holding named lessons, stored with gaps.

    ``{"M1": ["A", "B"], "M2": []}`` - module positions 1, 1+gap, ...; lesson
    positions likewise, so nothing starts out as 1..n.
    """
    course = await create_course(client, headers, title=title, slug=f"{title.lower()}-{uuid4().hex[:6]}")
    ids: dict[str, str] = {"course": course["id"]}
    for index, (module_title, lesson_titles) in enumerate(shape.items()):
        module = await create_module(client, headers, course["id"], title=module_title, position=1 + index * gap)
        ids[module_title] = module["id"]
        for lesson_index, lesson_title in enumerate(lesson_titles):
            lesson = await create_lesson(client, headers, module["id"], title=lesson_title,
                                         position=1 + lesson_index * gap)
            ids[lesson_title] = lesson["id"]
    return ids


@pytest.fixture
async def tree(auth_client, admin_headers) -> dict:
    """M1: A, B · M2: C, D · M3: (empty) - the ticket's own example, plus an empty module."""
    return await build(auth_client, admin_headers, "Tree", {"M1": ["A", "B"], "M2": ["C", "D"], "M3": []})


@pytest.fixture
async def other(auth_client, admin_headers) -> dict:
    """Another draft course: X holding Y."""
    return await build(auth_client, admin_headers, "Other", {"X": ["Y"]})


async def stored(client: AsyncClient, headers: dict, course_id: str) -> list[tuple[str, int, list[tuple[str, int]]]]:
    """The course as the existing read endpoints report it: titles and positions, in order."""
    modules = (await client.get(f"{COURSES}/{course_id}/modules", headers=headers,
                                params={"page_size": 100})).json()["items"]
    result = []
    for module in modules:
        lessons = (await client.get(f"/api/v1/admin/modules/{module['id']}/lessons", headers=headers,
                                    params={"page_size": 100})).json()["items"]
        result.append((module["title"], module["position"], [(l["title"], l["position"]) for l in lessons]))
    return result


def body(ids: dict, shape: dict[str, list[str]]) -> dict:
    """A request body from titles: ``{"M2": ["C", "A"], ...}`` in order."""
    return {"modules": [{"id": ids[module], "lesson_ids": [ids[lesson] for lesson in lessons]}
                        for module, lessons in shape.items()]}


async def put(client: AsyncClient, headers: dict, course_id: str, payload: dict):
    return await client.put(structure_path(course_id), headers=headers, json=payload)


INITIAL = [("M1", 1, [("A", 1), ("B", 4)]), ("M2", 4, [("C", 1), ("D", 4)]), ("M3", 7, [])]


# ================================================================== modules

async def test_two_modules_trade_places(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M2": ["C", "D"], "M1": ["A", "B"], "M3": []}))

    assert response.status_code == 200, response.text
    assert await stored(auth_client, admin_headers, tree["course"]) == [
        ("M2", 1, [("C", 1), ("D", 2)]), ("M1", 2, [("A", 1), ("B", 2)]), ("M3", 3, [])]


async def test_several_modules_reorder_at_once(auth_client, admin_headers):
    ids = await build(auth_client, admin_headers, "Five", {f"M{n}": [] for n in range(1, 6)})

    response = await put(auth_client, admin_headers, ids["course"],
                         body(ids, {"M5": [], "M3": [], "M1": [], "M4": [], "M2": []}))

    assert response.status_code == 200
    assert [(title, position) for title, position, _ in await stored(auth_client, admin_headers, ids["course"])] == [
        ("M5", 1), ("M3", 2), ("M1", 3), ("M4", 4), ("M2", 5)]


async def test_the_current_order_normalises_positions_and_keeps_the_order(auth_client, admin_headers, tree):
    """Same order as stored: the gaps close to 1..n, nothing is reordered."""
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["A", "B"], "M2": ["C", "D"], "M3": []}))

    assert response.status_code == 200
    assert await stored(auth_client, admin_headers, tree["course"]) == [
        ("M1", 1, [("A", 1), ("B", 2)]), ("M2", 2, [("C", 1), ("D", 2)]), ("M3", 3, [])]


async def test_a_structure_already_in_place_writes_nothing(auth_client, auth_session, admin_headers):
    ids = await build(auth_client, admin_headers, "Tidy", {"M1": ["A", "B"], "M2": []}, gap=1)
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("UPDATE"):
            statements.append(statement)

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await put(auth_client, admin_headers, ids["course"], body(ids, {"M1": ["A", "B"], "M2": []}))
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert statements == []


async def test_only_the_rows_that_move_are_written(auth_client, auth_session, admin_headers):
    """Swapping two of four lessons: two rows, each written twice (stage, settle)."""
    ids = await build(auth_client, admin_headers, "Few", {"M1": ["A", "B", "C", "D"]}, gap=1)
    statements: list[str] = []

    def capture(_connection, _cursor, statement, parameters, _context, executemany):
        # A pass's rows may go out as one executemany: count rows, not statements.
        if statement.lstrip().upper().startswith("UPDATE LESSONS"):
            statements.extend([statement] * (len(parameters) if executemany else 1))

    engine = auth_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await put(auth_client, admin_headers, ids["course"], body(ids, {"M1": ["A", "C", "B", "D"]}))
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 200
    assert len(statements) == 4


async def test_an_empty_course_accepts_an_empty_structure(auth_client, admin_headers):
    course = await create_course(auth_client, admin_headers, title="Empty", slug="empty-structure")

    response = await put(auth_client, admin_headers, course["id"], {"modules": []})

    assert response.status_code == 200
    assert response.json() == {"course_id": course["id"], "modules": []}


async def test_an_empty_list_cannot_erase_a_course_s_modules(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"], {"modules": []})

    assert response.status_code == 409
    assert response.json() == {"detail": MISMATCH}
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_a_missing_module_is_refused_and_nothing_changes(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M2": ["C", "D"], "M1": ["A", "B"]}))

    assert response.status_code == 409
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


@pytest.mark.parametrize("payload", [
    {"modules": [{"id": "M1", "lesson_ids": [], "position": 1}]},     # positions are not sent
    {"modules": [{"id": "M1"}]},                                        # lesson_ids required
    {"modules": [{"id": "not-a-uuid", "lesson_ids": []}]},
    {"modules": [{"id": "M1", "lesson_ids": ["not-a-uuid"]}]},
    {"modules": "M1"},
    {},
    {"modules": [], "extra": True},
])
async def test_a_malformed_body_is_refused(auth_client, admin_headers, tree, payload):
    raw = str(payload).replace("'M1'", f"'{tree['M1']}'").replace("'", '"').replace("True", "true")
    # Declared as JSON, so the refusal is the schema's, not a body left unparsed.
    response = await auth_client.put(structure_path(tree["course"]),
                                     headers={**admin_headers, "Content-Type": "application/json"},
                                     content=raw)

    assert response.status_code == 422
    # Pydantic's field report, not a JSON decoding error.
    assert all(error["type"] != "json_invalid" for error in response.json()["detail"])
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_a_repeated_module_is_refused(auth_client, admin_headers, tree):
    payload = body(tree, {"M1": ["A", "B"], "M2": ["C", "D"], "M3": []})
    payload["modules"].append({"id": tree["M1"], "lesson_ids": []})

    response = await put(auth_client, admin_headers, tree["course"], payload)

    assert response.status_code == 422
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


# ================================================================== lessons

async def test_two_lessons_trade_places(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["B", "A"], "M2": ["C", "D"], "M3": []}))

    assert response.status_code == 200
    assert (await stored(auth_client, admin_headers, tree["course"]))[0] == ("M1", 1, [("B", 1), ("A", 2)])


async def test_several_lessons_reorder_at_once(auth_client, admin_headers):
    ids = await build(auth_client, admin_headers, "Many", {"M1": ["A", "B", "C", "D", "E"]})

    response = await put(auth_client, admin_headers, ids["course"], body(ids, {"M1": ["E", "C", "A", "D", "B"]}))

    assert response.status_code == 200
    assert (await stored(auth_client, admin_headers, ids["course"]))[0][2] == [
        ("E", 1), ("C", 2), ("A", 3), ("D", 4), ("B", 5)]


async def test_an_empty_module_stays_empty(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M3": [], "M1": ["A", "B"], "M2": ["C", "D"]}))

    assert response.status_code == 200
    assert (await stored(auth_client, admin_headers, tree["course"]))[0] == ("M3", 1, [])


@pytest.mark.parametrize("shape", [
    {"M1": ["A", "A", "B"], "M2": ["C", "D"], "M3": []},     # twice in one module
    {"M1": ["A", "B"], "M2": ["C", "D", "A"], "M3": []},     # in two modules
])
async def test_a_repeated_lesson_is_refused(auth_client, admin_headers, tree, shape):
    response = await put(auth_client, admin_headers, tree["course"], body(tree, shape))

    assert response.status_code == 422
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_a_missing_lesson_is_refused_and_nothing_changes(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["B"], "M2": ["C", "D"], "M3": []}))

    assert response.status_code == 409
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


# ================================================================== moves

async def test_the_ticket_s_move_a_lesson_to_another_module(auth_client, admin_headers, tree):
    """M1: A, B · M2: C, D  ->  M1: B · M2: C, A, D."""
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["B"], "M2": ["C", "A", "D"], "M3": []}))

    assert response.status_code == 200
    assert await stored(auth_client, admin_headers, tree["course"]) == [
        ("M1", 1, [("B", 1)]), ("M2", 2, [("C", 1), ("A", 2), ("D", 3)]), ("M3", 3, [])]
    moved = (await auth_client.get(f"/api/v1/admin/lessons/{tree['A']}", headers=admin_headers)).json()
    assert moved["module_id"] == tree["M2"] and moved["position"] == 2


async def test_move_into_an_empty_module(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["A"], "M2": ["C", "D"], "M3": ["B"]}))

    assert response.status_code == 200
    assert (await stored(auth_client, admin_headers, tree["course"]))[2] == ("M3", 3, [("B", 1)])


@pytest.mark.parametrize("destination,expected", [
    (["A", "C", "D"], [("A", 1), ("C", 2), ("D", 3)]),     # first
    (["C", "A", "D"], [("C", 1), ("A", 2), ("D", 3)]),     # between
    (["C", "D", "A"], [("C", 1), ("D", 2), ("A", 3)]),     # last
])
async def test_move_to_any_position_of_the_destination(auth_client, admin_headers, tree, destination, expected):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["B"], "M2": destination, "M3": []}))

    assert response.status_code == 200
    assert (await stored(auth_client, admin_headers, tree["course"]))[1][2] == expected


async def test_a_module_can_be_emptied_by_moves(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": [], "M2": ["C", "D", "A", "B"], "M3": []}))

    assert response.status_code == 200
    assert await stored(auth_client, admin_headers, tree["course"]) == [
        ("M1", 1, []), ("M2", 2, [("C", 1), ("D", 2), ("A", 3), ("B", 4)]), ("M3", 3, [])]


async def test_moves_and_reorders_together_in_one_request(auth_client, admin_headers, tree):
    """Modules reversed, A and D swapped across modules, the empty module filled."""
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M3": ["C"], "M2": ["A"], "M1": ["D", "B"]}))

    assert response.status_code == 200
    assert await stored(auth_client, admin_headers, tree["course"]) == [
        ("M3", 1, [("C", 1)]), ("M2", 2, [("A", 1)]), ("M1", 3, [("D", 1), ("B", 2)])]


async def test_the_response_is_the_stored_structure(auth_client, admin_headers, tree):
    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M1": ["B"], "M2": ["C", "A", "D"], "M3": []}))

    data = response.json()
    assert response.headers["cache-control"] == "no-store"
    assert data["course_id"] == tree["course"]
    assert [module["id"] for module in data["modules"]] == [tree["M1"], tree["M2"], tree["M3"]]
    assert [lesson["id"] for lesson in data["modules"][1]["lessons"]] == [tree["C"], tree["A"], tree["D"]]
    assert [(lesson["module_id"], lesson["position"]) for lesson in data["modules"][1]["lessons"]] == [
        (tree["M2"], 1), (tree["M2"], 2), (tree["M2"], 3)]
    single = (await auth_client.get(f"/api/v1/admin/modules/{tree['M2']}", headers=admin_headers)).json()
    assert {key: data["modules"][1][key] for key in single} == single


async def test_a_lesson_keeps_everything_but_its_place(auth_client, admin_headers, tree):
    before = (await auth_client.get(f"/api/v1/admin/lessons/{tree['A']}", headers=admin_headers)).json()

    await put(auth_client, admin_headers, tree["course"], body(tree, {"M1": ["B"], "M2": ["C", "A", "D"], "M3": []}))

    after = (await auth_client.get(f"/api/v1/admin/lessons/{tree['A']}", headers=admin_headers)).json()
    for field in ("id", "title", "description", "content_type", "content", "duration_seconds", "is_preview", "created_at"):
        assert after[field] == before[field]


# ================================================================== other courses

async def test_a_lesson_from_another_course_is_refused(auth_client, admin_headers, tree, other):
    payload = body(tree, {"M1": ["A", "B"], "M2": ["C", "D"], "M3": []})
    payload["modules"][2]["lesson_ids"] = [other["Y"]]

    response = await put(auth_client, admin_headers, tree["course"], payload)

    assert response.status_code == 409 and response.json() == {"detail": MISMATCH}
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL
    assert await stored(auth_client, admin_headers, other["course"]) == [("X", 1, [("Y", 1)])]


async def test_a_module_from_another_course_is_refused(auth_client, admin_headers, tree, other):
    payload = body(tree, {"M1": ["A", "B"], "M2": ["C", "D"], "M3": []})
    payload["modules"].append({"id": other["X"], "lesson_ids": [other["Y"]]})

    response = await put(auth_client, admin_headers, tree["course"], payload)

    assert response.status_code == 409 and response.json() == {"detail": MISMATCH}
    assert await stored(auth_client, admin_headers, other["course"]) == [("X", 1, [("Y", 1)])]


async def test_a_lesson_cannot_be_sent_under_another_course_s_module(auth_client, admin_headers, tree, other):
    """Moving A into course Other's module X through Tree's endpoint - refused."""
    payload = body(tree, {"M1": ["B"], "M2": ["C", "D"], "M3": []})
    payload["modules"].append({"id": other["X"], "lesson_ids": [other["Y"], tree["A"]]})

    response = await put(auth_client, admin_headers, tree["course"], payload)

    assert response.status_code == 409
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL
    assert await stored(auth_client, admin_headers, other["course"]) == [("X", 1, [("Y", 1)])]


async def test_another_course_s_structure_through_this_one_is_refused(auth_client, admin_headers, tree, other):
    """Other's complete, valid structure sent to Tree's endpoint: Tree's is not Other's."""
    response = await put(auth_client, admin_headers, tree["course"], body(other, {"X": ["Y"]}))

    assert response.status_code == 409
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


@pytest.mark.parametrize("kind", ["module", "lesson"])
async def test_an_unknown_identifier_is_refused_without_saying_so(auth_client, admin_headers, tree, kind):
    payload = body(tree, {"M1": ["A", "B"], "M2": ["C", "D"], "M3": []})
    if kind == "module":
        payload["modules"].append({"id": str(uuid4()), "lesson_ids": []})
    else:
        payload["modules"][2]["lesson_ids"] = [str(uuid4())]

    response = await put(auth_client, admin_headers, tree["course"], payload)

    assert response.status_code == 409 and response.json() == {"detail": MISMATCH}
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_an_unknown_course_is_not_found(auth_client, admin_headers):
    response = await put(auth_client, admin_headers, str(uuid4()), {"modules": []})

    assert response.status_code == 404
    assert (await auth_client.put(f"{COURSES}/not-a-uuid/structure", headers=admin_headers,
                                  json={"modules": []})).status_code == 422


# ================================================================== lifecycle

@pytest.mark.parametrize("steps", [["publish"], ["publish", "archive"]])
async def test_only_a_draft_can_be_reorganised(auth_client, admin_headers, tree, steps):
    for step in steps:
        assert (await auth_client.post(f"{COURSES}/{tree['course']}/{step}", headers=admin_headers)).status_code == 200

    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M2": ["C", "D"], "M1": ["A", "B"], "M3": []}))

    assert response.status_code == 409
    assert response.json() == {"detail": "Only DRAFT courses can be edited"}
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


# ================================================================== atomicity

async def lesson_rows(session: AsyncSession) -> list[tuple[UUID, UUID, int]]:
    rows = await session.execute(select(Lesson.id, Lesson.module_id, Lesson.position).order_by(Lesson.id))
    return [tuple(row) for row in rows]


async def module_rows(session: AsyncSession) -> list[tuple[UUID, int]]:
    rows = await session.execute(select(Module.id, Module.position).order_by(Module.id))
    return [tuple(row) for row in rows]


@pytest.mark.parametrize("failure,status", [
    (OperationalError("UPDATE lessons", {}, Exception("connection lost")), 503),
    (IntegrityError("UPDATE lessons", {}, Exception("unique")), 409),
])
async def test_a_failure_between_the_two_passes_leaves_nothing_behind(
    auth_client, auth_session, admin_headers, tree, monkeypatch, failure, status,
):
    """The first pass has been flushed - rows sit at staging positions, one lesson
    in another module - when the second fails. None of it may remain."""
    lessons_before, modules_before = await lesson_rows(auth_session), await module_rows(auth_session)
    staged: dict[str, object] = {}

    async def failing_settle(self, moving_modules, moving_lessons, module_targets, lesson_targets):
        staged["lesson"] = await self.structure.session.scalar(
            select(Lesson.module_id).where(Lesson.id == UUID(tree["A"])))
        staged["moving"] = len(moving_lessons)
        raise failure

    monkeypatch.setattr(StructureService, "_settle", failing_settle)

    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M3": [], "M2": ["C", "A", "D"], "M1": ["B"]}))

    assert response.status_code == status
    # The first pass really was written inside the transaction...
    assert staged["lesson"] == UUID(tree["M2"]) and staged["moving"] >= 2
    # ...and none of it survived the failure.
    auth_session.expire_all()
    assert await lesson_rows(auth_session) == lessons_before
    assert await module_rows(auth_session) == modules_before
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_a_stale_structure_is_refused_after_a_concurrent_addition(auth_client, admin_headers, tree):
    """The editor's snapshot predates a lesson added since: refused, not half-applied."""
    snapshot = body(tree, {"M2": ["C", "D"], "M1": ["B", "A"], "M3": []})
    await create_lesson(auth_client, admin_headers, tree["M3"], title="Late", position=1)

    response = await put(auth_client, admin_headers, tree["course"], snapshot)

    assert response.status_code == 409
    after = await stored(auth_client, admin_headers, tree["course"])
    assert after[:2] == INITIAL[:2] and after[2] == ("M3", 7, [("Late", 1)])


async def test_staging_positions_avoid_every_used_one_and_stay_small():
    assert free_positions({1, 2, 3, 5}, 3) == [4, 6, 7]
    assert free_positions(set(), 2) == [1, 2]
    # A course holding the column's largest position still stages near 1.
    assert free_positions({1, 2, 2_147_483_647}, 2) == [3, 4]


# ================================================================== permissions

async def test_a_member_is_forbidden(auth_client, member_headers, admin_headers, tree):
    response = await put(auth_client, member_headers, tree["course"],
                         body(tree, {"M2": ["C", "D"], "M1": ["A", "B"], "M3": []}))

    assert response.status_code == 403
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer not-a-token"}, {"Authorization": "Basic x"}])
async def test_authentication_is_required(auth_client, admin_headers, tree, headers):
    response = await put(auth_client, headers, tree["course"], body(tree, {"M2": ["C", "D"], "M1": ["A", "B"], "M3": []}))

    assert response.status_code == 401
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_an_inactive_administrator_is_refused(auth_client, auth_session, admin_headers, tree):
    await auth_session.execute(update(User).where(User.email == "admin@example.com").values(is_active=False))
    await auth_session.commit()

    response = await put(auth_client, admin_headers, tree["course"],
                         body(tree, {"M2": ["C", "D"], "M1": ["A", "B"], "M3": []}))

    assert response.status_code == 401
    await auth_session.execute(update(User).where(User.email == "admin@example.com").values(is_active=True))
    await auth_session.commit()
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_another_administrator_may_reorganise_any_draft(auth_client, auth_session, password_hash, tree):
    """Admin routes are not owner-scoped (as every other content write)."""
    from app.models.user import UserRole

    auth_session.add(User(email="second-admin@example.com", first_name="S", last_name="A",
                          role=UserRole.ADMIN, hashed_password=password_hash))
    await auth_session.commit()
    login = await auth_client.post("/api/v1/auth/login", json={"email": "second-admin@example.com", "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = await put(auth_client, headers, tree["course"], body(tree, {"M2": ["C", "D"], "M1": ["A", "B"], "M3": []}))

    assert response.status_code == 200


# ================================================================== compatibility

async def test_patch_still_cannot_move_a_lesson_between_modules(auth_client, admin_headers, tree):
    response = await auth_client.patch(f"/api/v1/admin/lessons/{tree['A']}", headers=admin_headers,
                                       json={"module_id": tree["M2"]})

    assert response.status_code == 422
    assert await stored(auth_client, admin_headers, tree["course"]) == INITIAL


async def test_the_existing_structure_endpoints_still_work_after_a_reorganisation(auth_client, admin_headers, tree):
    await put(auth_client, admin_headers, tree["course"], body(tree, {"M1": ["B"], "M2": ["C", "A", "D"], "M3": []}))

    added = await auth_client.post(f"/api/v1/admin/modules/{tree['M3']}/lessons", headers=admin_headers, json={
        "title": "New", "position": 1, "content_type": "TEXT", "content": "Hello"})
    assert added.status_code == 201
    moved = await auth_client.patch(f"/api/v1/admin/lessons/{tree['B']}", headers=admin_headers, json={"position": 9})
    assert moved.status_code == 200
    taken = await auth_client.patch(f"/api/v1/admin/lessons/{tree['C']}", headers=admin_headers, json={"position": 2})
    assert taken.status_code == 409  # A holds position 2 of M2 now
    assert (await auth_client.delete(f"/api/v1/admin/lessons/{tree['D']}", headers=admin_headers)).status_code == 204


async def test_the_contract_is_documented(auth_client):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()

    operation = schema["paths"]["/api/v1/admin/courses/{course_id}/structure"]["put"]
    assert operation["security"] == [{"HTTPBearer": []}]
    assert {"200", "401", "403", "404", "409", "422"} <= operation["responses"].keys()
    components = schema["components"]["schemas"]
    assert components["CourseStructureUpdate"]["additionalProperties"] is False
    assert components["StructureModuleOrder"]["additionalProperties"] is False
    assert set(components["StructureModuleOrder"]["properties"]) == {"id", "lesson_ids"}
    assert "lessons" in components["StructureModuleResponse"]["properties"]
