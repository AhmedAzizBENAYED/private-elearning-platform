"""BE-SEC-01: the lesson detail endpoint is gated by enrollment.

Before this fix, ``GET /api/v1/lessons/{lesson_id}`` checked only that the
parent course was PUBLISHED. Any authenticated member could therefore read the
full body of every TEXT lesson and the target of every LINK lesson in every
published course without enrolling - and the outline endpoints, which are
deliberately open so a member can decide whether to enroll, handed out the
lesson ids needed to do it.

Each test here fails against the previous implementation.
"""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.tests.test_auth import auth_client, auth_session, password_hash
from app.tests.test_courses import (
    create_course, create_lesson, create_module, enforce_foreign_keys, member_headers,
)
from app.tests.test_enrollments import enroll
from app.tests.test_lesson_resources import MP4, PDF, storage, upload
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio

API = "/api/v1"
ADMIN = f"{API}/admin"

#: Values that must never appear in a refusal.
SECRET_TEXT = "SECRET TEST CONTENT"
SECRET_LINK = "https://example-test-private-link.invalid/material"


async def build_course(client: AsyncClient, headers: dict[str, str], *, publish: bool = True) -> dict:
    """One course carrying all four lesson kinds, with real files on two of them."""
    course = await create_course(client, headers, title="Sec " + uuid4().hex)
    module = await create_module(client, headers, course["id"])

    lessons = {
        "text": await create_lesson(client, headers, module["id"], position=1,
                                    content_type="TEXT", content=SECRET_TEXT),
        "link": await create_lesson(client, headers, module["id"], position=2,
                                    content_type="LINK", content=SECRET_LINK),
        "video": await create_lesson(client, headers, module["id"], position=3,
                                     content_type="VIDEO", content="storage://videos/pending",
                                     duration_seconds=100),
        "document": await create_lesson(client, headers, module["id"], position=4,
                                        content_type="DOCUMENT",
                                        content="storage://documents/pending"),
    }
    assert (await upload(client, headers, lessons["video"]["id"])).status_code == 200
    assert (await upload(client, headers, lessons["document"]["id"], payload=PDF,
                         filename="d.pdf", mime="application/pdf")).status_code == 200
    if publish:
        assert (await client.post(f"{ADMIN}/courses/{course['id']}/publish",
                                  headers=headers)).status_code == 200
    return {"course": course, "module": module, **lessons}


def detail(lesson: dict) -> str:
    return f"{API}/lessons/{lesson['id']}"


# ---------------------------------------------------------- authentication

async def test_anonymous_is_refused_without_disclosing_anything(auth_client, storage, admin_headers):
    built = await build_course(auth_client, admin_headers)

    for key in ("text", "link", "video", "document"):
        response = await auth_client.get(detail(built[key]))
        assert response.status_code == 401
        assert SECRET_TEXT not in response.text
        assert SECRET_LINK not in response.text


# ------------------------------------------------------ the vulnerable case

@pytest.mark.parametrize("key", ["text", "link", "video", "document"])
async def test_a_non_enrolled_member_cannot_read_a_lesson(auth_client, storage, admin_headers,
                                                          member_headers, key):
    built = await build_course(auth_client, admin_headers)

    response = await auth_client.get(detail(built[key]), headers=member_headers)

    assert response.status_code == 404
    # Indistinguishable from a lesson that does not exist: the refusal must not
    # confirm that this one is real.
    assert response.json() == {"detail": "Lesson not found"}
    assert response.json() == (
        await auth_client.get(f"{API}/lessons/{uuid4()}", headers=member_headers)
    ).json()


async def test_no_protected_content_appears_in_the_refusal(auth_client, storage, admin_headers,
                                                           member_headers):
    """The heart of the vulnerability: the body, not merely the status code."""
    built = await build_course(auth_client, admin_headers)

    text = await auth_client.get(detail(built["text"]), headers=member_headers)
    link = await auth_client.get(detail(built["link"]), headers=member_headers)

    assert text.status_code == 404 and link.status_code == 404
    assert SECRET_TEXT not in text.text
    assert SECRET_LINK not in link.text
    # Nothing else about the lesson escapes either.
    for response in (text, link):
        body = response.text.lower()
        for field in ("title", "description", "content_type", "position", "is_preview",
                      "introduction", "storage://"):
            assert field not in body, f"{field!r} leaked into a refusal"


@pytest.mark.parametrize("key,expected", [
    ("text", SECRET_TEXT),
    ("link", SECRET_LINK),
])
async def test_an_enrolled_member_still_reads_readable_kinds(auth_client, storage, admin_headers,
                                                             member_headers, key, expected):
    built = await build_course(auth_client, admin_headers)
    await enroll(auth_client, member_headers, built["course"]["id"])

    response = await auth_client.get(detail(built[key]), headers=member_headers)

    assert response.status_code == 200
    assert response.json()["content"] == expected


@pytest.mark.parametrize("key", ["video", "document"])
async def test_an_enrolled_member_reads_stored_kinds_without_the_reference(
    auth_client, storage, admin_headers, member_headers, key,
):
    built = await build_course(auth_client, admin_headers)
    await enroll(auth_client, member_headers, built["course"]["id"])

    response = await auth_client.get(detail(built[key]), headers=member_headers)

    assert response.status_code == 200
    # Unchanged by this ticket: the storage reference still never leaves.
    assert response.json()["content"] is None
    assert "storage://" not in response.text


# ------------------------------------------------------------- object level

async def test_enrollment_is_checked_against_the_lessons_own_course(
    auth_client, storage, admin_headers, member_headers,
):
    """Being enrolled *somewhere* must not open a lesson *anywhere*."""
    a = await build_course(auth_client, admin_headers)
    b = await build_course(auth_client, admin_headers)
    await enroll(auth_client, member_headers, a["course"]["id"])

    mine = await auth_client.get(detail(a["text"]), headers=member_headers)
    theirs = await auth_client.get(detail(b["text"]), headers=member_headers)

    assert mine.status_code == 200 and mine.json()["content"] == SECRET_TEXT
    assert theirs.status_code == 404
    assert SECRET_TEXT not in theirs.text


async def test_the_outline_stays_browsable_before_enrolling(auth_client, storage, admin_headers,
                                                            member_headers):
    """The ids are discoverable by design; what they unlock is what changed."""
    built = await build_course(auth_client, admin_headers)

    outline = await auth_client.get(
        f"{API}/modules/{built['module']['id']}/lessons?page=1&page_size=100",
        headers=member_headers,
    )

    assert outline.status_code == 200
    ids = [row["id"] for row in outline.json()["items"]]
    assert built["text"]["id"] in ids
    # Metadata only - the listing never carried content, and still does not.
    assert all("content" not in row for row in outline.json()["items"])
    # And every discovered id is refused.
    for lesson_id in ids:
        assert (await auth_client.get(f"{API}/lessons/{lesson_id}",
                                      headers=member_headers)).status_code == 404


# ----------------------------------------------------------------- preview

async def test_is_preview_grants_no_exemption(auth_client, storage, admin_headers, member_headers):
    """`is_preview` has never been an authorization concept; it still is not.

    No service reads it to decide access - it is carried in the schemas and in
    the course-content projection as a presentation flag. A security fix is not
    the place to give it a new meaning, so a preview lesson is gated exactly
    like any other.
    """
    course = await create_course(auth_client, admin_headers, title="Prev " + uuid4().hex)
    module = await create_module(auth_client, admin_headers, course["id"])
    preview = await create_lesson(auth_client, admin_headers, module["id"], position=1,
                                  content_type="TEXT", content=SECRET_TEXT, is_preview=True)
    assert (await auth_client.post(f"{ADMIN}/courses/{course['id']}/publish",
                                   headers=admin_headers)).status_code == 200

    refused = await auth_client.get(detail(preview), headers=member_headers)
    assert refused.status_code == 404
    assert SECRET_TEXT not in refused.text
    # The flag is still reported by the outline, unchanged.
    listing = await auth_client.get(f"{API}/modules/{module['id']}/lessons",
                                    headers=member_headers)
    assert listing.json()["items"][0]["is_preview"] is True

    await enroll(auth_client, member_headers, course["id"])
    assert (await auth_client.get(detail(preview), headers=member_headers)).status_code == 200


# --------------------------------------------------------------- lifecycle

async def test_a_draft_lesson_stays_invisible_even_to_an_enrolled_member(
    auth_client, storage, admin_headers, member_headers,
):
    """Enrollment cannot exist for a draft, and the published filter is kept."""
    built = await build_course(auth_client, admin_headers, publish=False)

    response = await auth_client.get(detail(built["text"]), headers=member_headers)
    assert response.status_code == 404
    assert SECRET_TEXT not in response.text
    # Enrolling is itself refused while the course is a draft.
    assert (await auth_client.post(f"{API}/courses/{built['course']['id']}/enroll",
                                   headers=member_headers)).status_code == 409


async def test_archiving_keeps_the_pre_existing_behaviour(auth_client, storage, admin_headers,
                                                          member_headers):
    """Unchanged by this ticket, and asserted so a later change is deliberate.

    `require_lesson(published=True)` filters on ``Course.status == PUBLISHED``,
    so archiving a course has always closed this endpoint - even for a member
    who is enrolled and who can still reach the same course through
    ``/courses/{id}/content``. That asymmetry predates BE-SEC-01 and is left
    exactly as it was; it is recorded here rather than silently altered.
    """
    built = await build_course(auth_client, admin_headers)
    await enroll(auth_client, member_headers, built["course"]["id"])
    assert (await auth_client.get(detail(built["text"]), headers=member_headers)).status_code == 200

    assert (await auth_client.post(f"{ADMIN}/courses/{built['course']['id']}/archive",
                                   headers=admin_headers)).status_code == 200

    assert (await auth_client.get(detail(built["text"]), headers=member_headers)).status_code == 404
    # The course tree still opens for the enrolled member, as it did before.
    assert (await auth_client.get(f"{API}/courses/{built['course']['id']}/content",
                                  headers=member_headers)).status_code == 200


# -------------------------------------------------------------------- roles

async def test_an_administrator_is_gated_exactly_like_a_member(auth_client, storage, admin_headers,
                                                               member_headers):
    """Not a new restriction: the enrollment-gated reads have never excused ADMIN.

    ``/courses/{id}/content`` already answers 404 to an administrator who is not
    enrolled, and so does the resource endpoint. Administrators read lesson
    content through ``/admin/lessons/{id}``, which is unaffected and still
    returns the stored reference in full.
    """
    built = await build_course(auth_client, admin_headers)

    assert (await auth_client.get(detail(built["text"]), headers=admin_headers)).status_code == 404
    assert (await auth_client.get(f"{API}/courses/{built['course']['id']}/content",
                                  headers=admin_headers)).status_code == 404

    admin_view = await auth_client.get(f"{ADMIN}/lessons/{built['text']['id']}",
                                       headers=admin_headers)
    assert admin_view.status_code == 200
    assert admin_view.json()["content"] == SECRET_TEXT


# ------------------------------------------------------- unchanged neighbours

async def test_resource_authorization_is_untouched(auth_client, storage, admin_headers,
                                                   member_headers):
    built = await build_course(auth_client, admin_headers)
    video = built["video"]["id"]

    assert (await auth_client.get(f"{API}/lessons/{video}/resource")).status_code == 401
    assert (await auth_client.get(f"{API}/lessons/{video}/resource",
                                  headers=member_headers)).status_code == 404

    await enroll(auth_client, member_headers, built["course"]["id"])
    allowed = await auth_client.get(f"{API}/lessons/{video}/resource", headers=member_headers)
    assert allowed.status_code == 200
    assert "storage_key" not in allowed.text


async def test_admin_endpoints_still_refuse_a_member(auth_client, storage, admin_headers,
                                                     member_headers):
    """The FE-15 role separation must survive the dependency rewiring."""
    built = await build_course(auth_client, admin_headers)
    course_id, module_id, lesson_id = (built["course"]["id"], built["module"]["id"],
                                       built["text"]["id"])

    probes = [
        ("GET", f"{ADMIN}/members"), ("GET", f"{ADMIN}/courses"),
        ("GET", f"{ADMIN}/courses/{course_id}"), ("PATCH", f"{ADMIN}/courses/{course_id}"),
        ("POST", f"{ADMIN}/courses/{course_id}/publish"),
        ("GET", f"{ADMIN}/courses/{course_id}/modules"),
        ("GET", f"{ADMIN}/modules/{module_id}"), ("DELETE", f"{ADMIN}/modules/{module_id}"),
        ("GET", f"{ADMIN}/modules/{module_id}/lessons"),
        ("GET", f"{ADMIN}/lessons/{lesson_id}"), ("PATCH", f"{ADMIN}/lessons/{lesson_id}"),
        ("DELETE", f"{ADMIN}/lessons/{lesson_id}"),
        ("GET", f"{ADMIN}/courses/{course_id}/resources"),
        ("GET", f"{ADMIN}/lessons/{lesson_id}/resource"),
        ("DELETE", f"{ADMIN}/lessons/{lesson_id}/resource"),
    ]

    for method, path in probes:
        kwargs = {"headers": member_headers}
        if method in {"POST", "PATCH"}:
            kwargs["json"] = {"title": "x"}
        response = await auth_client.request(method, path, **kwargs)
        assert response.status_code == 403, f"{method} {path} -> {response.status_code}"
