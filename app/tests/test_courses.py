"""Catalog APIs through the existing authentication/database test fixtures."""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course
from app.models.lesson import Lesson
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio
ADMIN = "/api/v1/admin"
COURSES = ADMIN + "/courses"
CATALOG_FIELDS = {"id", "title", "slug", "description", "thumbnail_url", "status", "published_at"}
MODULE_FIELDS = {"id", "title", "description", "position"}
LESSON_FIELDS = {"id", "title", "description", "content_type", "duration_seconds", "position", "is_preview"}


@pytest.fixture(autouse=True)
async def enforce_foreign_keys(auth_session: AsyncSession) -> None:
    # Existing SQLite fixtures predate relational content; enable actual FK/cascade checks.
    await auth_session.execute(text("PRAGMA foreign_keys=ON"))
    await auth_session.commit()
    assert await auth_session.scalar(text("PRAGMA foreign_keys")) == 1


@pytest.fixture
async def member_headers(auth_client: AsyncClient) -> dict[str, str]:
    response = await auth_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def create_course(client: AsyncClient, headers: dict[str, str], **changes) -> dict:
    response = await client.post(COURSES, headers=headers, json={
        "title": "Practical Python", "description": "Learn Python", **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()


async def create_module(client: AsyncClient, headers: dict[str, str], course_id: str, **changes) -> dict:
    response = await client.post(f"{COURSES}/{course_id}/modules", headers=headers, json={
        "title": "Getting started", "position": 1, **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()


async def create_lesson(client: AsyncClient, headers: dict[str, str], module_id: str, **changes) -> dict:
    response = await client.post(f"{ADMIN}/modules/{module_id}/lessons", headers=headers, json={
        "title": "Introduction", "position": 1, "content_type": "TEXT", "content": "Welcome!", **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("method,path", [
    ("POST", "/courses"), ("GET", "/courses"), ("GET", "/courses/{id}"),
    ("PATCH", "/courses/{id}"), ("POST", "/courses/{id}/publish"), ("POST", "/courses/{id}/archive"),
    ("POST", "/courses/{id}/modules"), ("GET", "/courses/{id}/modules"),
    ("GET", "/modules/{id}"), ("PATCH", "/modules/{id}"), ("DELETE", "/modules/{id}"),
    ("POST", "/modules/{id}/lessons"), ("GET", "/modules/{id}/lessons"),
    ("GET", "/lessons/{id}"), ("PATCH", "/lessons/{id}"), ("DELETE", "/lessons/{id}"),
])
async def test_admin_authorization(auth_client, member_headers, method, path):
    path = ADMIN + path.replace("{id}", str(uuid4()))
    assert (await auth_client.request(method, path, json={})).status_code == 401
    assert (await auth_client.request(method, path, headers=member_headers, json={})).status_code == 403


@pytest.mark.parametrize("path", ["/courses", "/courses/{id}", "/courses/{id}/modules", "/modules/{id}/lessons", "/lessons/{id}"])
async def test_catalog_requires_authentication(auth_client, path):
    assert (await auth_client.get("/api/v1" + path.replace("{id}", str(uuid4())))).status_code == 401


async def test_course_creation_slug_and_update(auth_client, admin_headers):
    created = await create_course(auth_client, admin_headers, title="  Café & Python: Basics!  ")
    assert created["slug"] == "cafe-python-basics"
    assert created["status"] == "DRAFT" and created["published_at"] is None and created["archived_at"] is None
    me = (await auth_client.get("/api/v1/auth/me", headers=admin_headers)).json()
    assert created["created_by"] == me["id"]
    path = f"{COURSES}/{created['id']}"
    assert (await auth_client.get(path, headers=admin_headers)).json() == created
    updated = await auth_client.patch(path, headers=admin_headers, json={
        "title": "Advanced Python", "description": "New description", "thumbnail_url": "https://example.com/image.png",
    })
    assert updated.status_code == 200 and updated.json()["slug"] == created["slug"]
    assert updated.json()["title"] == "Advanced Python"
    updated = await auth_client.patch(path, headers=admin_headers, json={"slug": "custom-slug", "thumbnail_url": None})
    assert updated.status_code == 200 and updated.json()["slug"] == "custom-slug"
    assert updated.json()["thumbnail_url"] is None
    assert (await auth_client.delete(path, headers=admin_headers)).status_code == 405
    unicode_course = await create_course(auth_client, admin_headers, title="تعلم")
    assert unicode_course["slug"].startswith("course-")


async def test_slug_uniqueness_create_and_update(auth_client, admin_headers):
    first = await create_course(auth_client, admin_headers)
    duplicate = await auth_client.post(COURSES, headers=admin_headers, json={"title": first["title"], "description": "Other"})
    assert duplicate.status_code == 409
    second = await create_course(auth_client, admin_headers, title="Other")
    response = await auth_client.patch(f"{COURSES}/{second['id']}", headers=admin_headers, json={"slug": first["slug"]})
    assert response.status_code == 409
    assert "IntegrityError" not in response.text and "INSERT" not in response.text


@pytest.mark.parametrize("changes", [
    {"status": "PUBLISHED"}, {"created_by": str(uuid4())}, {"id": str(uuid4())},
    {"created_at": "2020-01-01"}, {"updated_at": "2020-01-01"}, {"published_at": "2020-01-01"},
    {"archived_at": "2020-01-01"}, {"title": " "}, {"description": " "},
    {"slug": "Invalid Slug"}, {"slug": "../path"}, {"thumbnail_url": "javascript:alert(1)"},
])
async def test_course_input_validation(auth_client, admin_headers, changes):
    assert (await auth_client.post(COURSES, headers=admin_headers, json={
        "title": "Title", "description": "Description", **changes,
    })).status_code == 422


async def test_listing_pagination_search_status(auth_client, admin_headers):
    first = await create_course(auth_client, admin_headers)
    second = await create_course(auth_client, admin_headers, title="Advanced SQL")
    await auth_client.post(f"{COURSES}/{second['id']}/publish", headers=admin_headers)
    page1 = (await auth_client.get(COURSES, headers=admin_headers, params={"page_size": 1})).json()
    page2 = (await auth_client.get(COURSES, headers=admin_headers, params={"page_size": 1, "page": 2})).json()
    assert page1["total"] == page2["total"] == 2
    assert page1["items"][0]["id"] != page2["items"][0]["id"]
    assert page2["page"] == 2 and page2["page_size"] == 1
    search = (await auth_client.get(COURSES, headers=admin_headers, params={"search": "PYTHON"})).json()
    assert search["total"] == 1 and search["items"][0]["id"] == first["id"]
    assert (await auth_client.get(COURSES, headers=admin_headers, params={"search": "%"})).json()["total"] == 0
    for status in ("DRAFT", "PUBLISHED"):
        result = (await auth_client.get(COURSES, headers=admin_headers, params={"status": status})).json()
        assert result["total"] == 1 and result["items"][0]["status"] == status
    for params in ({"page": 0}, {"page_size": 101}, {"status": "invalid"}):
        assert (await auth_client.get(COURSES, headers=admin_headers, params=params)).status_code == 422


async def test_lifecycle_is_forward_only_and_idempotent(auth_client, admin_headers):
    created = await create_course(auth_client, admin_headers)
    path = f"{COURSES}/{created['id']}"
    assert (await auth_client.post(path + "/archive", headers=admin_headers)).status_code == 409
    published = await auth_client.post(path + "/publish", headers=admin_headers)
    assert published.status_code == 200 and published.json()["published_at"] is not None
    assert (await auth_client.post(path + "/publish", headers=admin_headers)).json() == published.json()
    assert (await auth_client.patch(path, headers=admin_headers, json={"title": "Changed"})).status_code == 409
    archived = await auth_client.post(path + "/archive", headers=admin_headers)
    assert archived.status_code == 200 and archived.json()["status"] == "ARCHIVED"
    assert archived.json()["archived_at"] >= archived.json()["published_at"]
    assert archived.json()["published_at"] == published.json()["published_at"]
    assert (await auth_client.post(path + "/archive", headers=admin_headers)).json() == archived.json()
    assert (await auth_client.post(path + "/publish", headers=admin_headers)).status_code == 409
    for payload in ({"status": "DRAFT"}, {"published_at": None}, {}, {"title": None}):
        assert (await auth_client.patch(path, headers=admin_headers, json=payload)).status_code == 422
    assert (await auth_client.patch(path, headers=admin_headers, json={"title": "Changed"})).status_code == 409


async def test_catalog_visibility_and_safe_read_models(auth_client, admin_headers, member_headers):
    """The outline is open to any signed-in member; the lesson body is not.

    BE-SEC-01: reading a lesson now requires enrollment in its own course, so
    the detail path is asserted separately from the three outline paths that
    deliberately remain browsable before enrolling.
    """
    course = await create_course(auth_client, admin_headers)
    module = await create_module(auth_client, admin_headers, course["id"])
    lesson = await create_lesson(auth_client, admin_headers, module["id"], is_preview=True)
    outline = [f"/api/v1/courses/{course['id']}", f"/api/v1/courses/{course['id']}/modules",
               f"/api/v1/modules/{module['id']}/lessons"]
    detail = f"/api/v1/lessons/{lesson['id']}"
    for state in ("DRAFT", "PUBLISHED", "ARCHIVED"):
        if state != "DRAFT":
            action = "publish" if state == "PUBLISHED" else "archive"
            assert (await auth_client.post(f"{COURSES}/{course['id']}/{action}", headers=admin_headers)).status_code == 200
        listing = (await auth_client.get("/api/v1/courses", headers=member_headers)).json()
        assert listing["total"] == (1 if state == "PUBLISHED" else 0)
        responses = [await auth_client.get(path, headers=member_headers) for path in outline]
        assert all(response.status_code == (200 if state == "PUBLISHED" else 404) for response in responses)

        # is_preview is a presentation flag, not an enrollment exemption: this
        # lesson carries it and is still refused to a member who has not
        # enrolled, in every lifecycle state.
        refused = await auth_client.get(detail, headers=member_headers)
        assert refused.status_code == 404
        assert refused.json() == {"detail": "Lesson not found"}
        assert "Welcome!" not in refused.text

        if state == "PUBLISHED":
            assert set(responses[0].json()) == CATALOG_FIELDS
            assert set(responses[1].json()["items"][0]) == MODULE_FIELDS
            assert set(responses[2].json()["items"][0]) == LESSON_FIELDS
            # Administrators may use the same safe member-facing projection.
            assert (await auth_client.get(outline[0], headers=admin_headers)).status_code == 200

            # Enrolled, the same member reads the same lesson in full.
            # Enrolled inline rather than through test_enrollments.enroll:
            # that module imports this one, so the helper cannot be imported
            # back without a cycle.
            assert (await auth_client.post(f"/api/v1/courses/{course['id']}/enroll",
                                           headers=member_headers)).status_code == 200
            granted = await auth_client.get(detail, headers=member_headers)
            assert granted.status_code == 200
            assert set(granted.json()) == LESSON_FIELDS | {"content"}
            assert granted.json()["content"] == "Welcome!"
            assert granted.headers["cache-control"] == "no-store"


async def test_module_order_uniqueness_update_and_cascade(auth_client, auth_session, admin_headers):
    course = await create_course(auth_client, admin_headers)
    late = await create_module(auth_client, admin_headers, course["id"], position=3)
    early = await create_module(auth_client, admin_headers, course["id"], position=1)
    await create_lesson(auth_client, admin_headers, early["id"])
    kept = await create_lesson(auth_client, admin_headers, late["id"])
    path = f"{COURSES}/{course['id']}/modules"
    rows = (await auth_client.get(path, headers=admin_headers)).json()
    assert [row["position"] for row in rows["items"]] == [1, 3]
    assert (await auth_client.post(path, headers=admin_headers, json={"title": "Duplicate", "position": 1})).status_code == 409
    assert (await auth_client.patch(f"{ADMIN}/modules/{late['id']}", headers=admin_headers, json={"position": 1})).status_code == 409
    response = await auth_client.patch(f"{ADMIN}/modules/{late['id']}", headers=admin_headers, json={"title": "Updated", "position": 2, "description": "New"})
    assert response.status_code == 200 and response.json()["position"] == 2
    assert (await auth_client.get(f"{ADMIN}/modules/{late['id']}", headers=admin_headers)).json() == response.json()
    assert (await auth_client.delete(f"{ADMIN}/modules/{early['id']}", headers=admin_headers)).status_code == 204
    assert await auth_session.scalar(select(func.count()).select_from(Lesson)) == 1
    assert await auth_session.scalar(select(Lesson.id)) == UUID(kept["id"])
    assert await auth_session.scalar(select(func.count()).select_from(Course)) == 1


async def test_lesson_order_uniqueness_and_delete(auth_client, admin_headers):
    course = await create_course(auth_client, admin_headers)
    module = await create_module(auth_client, admin_headers, course["id"])
    later = await create_lesson(auth_client, admin_headers, module["id"], position=3)
    earlier = await create_lesson(auth_client, admin_headers, module["id"])
    path = f"{ADMIN}/modules/{module['id']}/lessons"
    rows = (await auth_client.get(path, headers=admin_headers)).json()["items"]
    assert [row["position"] for row in rows] == [1, 3]
    response = await auth_client.post(path, headers=admin_headers, json={
        "title": "Duplicate", "position": 1, "content_type": "TEXT", "content": "Hello",
    })
    assert response.status_code == 409
    assert (await auth_client.patch(f"{ADMIN}/lessons/{later['id']}", headers=admin_headers, json={"position": 1})).status_code == 409
    assert (await auth_client.delete(f"{ADMIN}/lessons/{earlier['id']}", headers=admin_headers)).status_code == 204
    assert (await auth_client.get(f"{ADMIN}/lessons/{earlier['id']}", headers=admin_headers)).status_code == 404


@pytest.mark.parametrize("status", ["PUBLISHED", "ARCHIVED"])
async def test_content_is_immutable_after_publication(auth_client, admin_headers, status):
    course = await create_course(auth_client, admin_headers)
    module = await create_module(auth_client, admin_headers, course["id"])
    lesson = await create_lesson(auth_client, admin_headers, module["id"])
    await auth_client.post(f"{COURSES}/{course['id']}/publish", headers=admin_headers)
    if status == "ARCHIVED":
        await auth_client.post(f"{COURSES}/{course['id']}/archive", headers=admin_headers)
    cases = [
        ("POST", f"{COURSES}/{course['id']}/modules", {"title": "New", "position": 2}),
        ("PATCH", f"{ADMIN}/modules/{module['id']}", {"title": "Changed"}),
        ("PATCH", f"{ADMIN}/modules/{module['id']}", {"position": 2}),
        ("DELETE", f"{ADMIN}/modules/{module['id']}", None),
        ("POST", f"{ADMIN}/modules/{module['id']}/lessons", {"title": "New", "position": 2, "content_type": "TEXT", "content": "New"}),
        ("PATCH", f"{ADMIN}/lessons/{lesson['id']}", {"content": "Changed"}),
        ("PATCH", f"{ADMIN}/lessons/{lesson['id']}", {"position": 2}),
        ("DELETE", f"{ADMIN}/lessons/{lesson['id']}", None),
    ]
    for method, path, payload in cases:
        assert (await auth_client.request(method, path, headers=admin_headers, json=payload)).status_code == 409


@pytest.mark.parametrize("kind,content,duration,expected", [
    ("VIDEO", "https://example.com/video", 60, 201), ("VIDEO", "storage://videos/intro.mp4", None, 201),
    ("DOCUMENT", "https://example.com/document", None, 201), ("DOCUMENT", "storage://documents/file.pdf", None, 201),
    ("LINK", "https://example.com/", None, 201), ("TEXT", "Text content", None, 201),
    ("LINK", "javascript:alert(1)", None, 422), ("LINK", "not-a-url", None, 422),
    ("LINK", "storage://file", None, 422), ("LINK", "https://user:password@example.com", None, 422),
    ("VIDEO", "storage://../file", None, 422), ("VIDEO", "file:///video.mp4", None, 422),
    ("DOCUMENT", "unstructured reference", None, 422), ("TEXT", "   ", None, 422),
    ("DOCUMENT", "https://example.com/file", 60, 422), ("TEXT", "Text", 1, 422),
    ("LINK", "https://example.com", 1, 422), ("VIDEO", "https://example.com", 0, 422),
    ("INVALID", "https://example.com", None, 422), ("LINK", "https://example.com/a b", None, 422),
    ("LINK", "https:example.com", None, 422), ("LINK", "https://example.com\\secret", None, 422),
])
async def test_lesson_content_validation(auth_client, admin_headers, kind, content, duration, expected):
    course = await create_course(auth_client, admin_headers)
    module = await create_module(auth_client, admin_headers, course["id"])
    response = await auth_client.post(f"{ADMIN}/modules/{module['id']}/lessons", headers=admin_headers, json={
        "title": "Lesson", "position": 1, "content_type": kind, "content": content, "duration_seconds": duration,
    })
    assert response.status_code == expected, response.text


async def test_lesson_partial_update_validates_merged_state(auth_client, admin_headers):
    course = await create_course(auth_client, admin_headers)
    module = await create_module(auth_client, admin_headers, course["id"])
    lesson = await create_lesson(auth_client, admin_headers, module["id"], content_type="VIDEO",
                                 content="https://example.com/video", duration_seconds=60)
    path = f"{ADMIN}/lessons/{lesson['id']}"
    assert (await auth_client.patch(path, headers=admin_headers, json={"content_type": "TEXT"})).status_code == 422
    response = await auth_client.patch(path, headers=admin_headers, json={
        "content_type": "TEXT", "content": "Updated text", "duration_seconds": None, "position": 2,
    })
    assert response.status_code == 200 and response.json()["duration_seconds"] is None
    assert response.json()["position"] == 2
    assert (await auth_client.patch(path, headers=admin_headers, json={"content_type": "LINK"})).status_code == 422
    assert (await auth_client.get(path, headers=admin_headers)).json()["content_type"] == "TEXT"
    for payload in ({"module_id": str(uuid4())}, {"content": None}, {"content_type": None}, {"is_preview": None}, {"position": 0}, {"position": True}, {}):
        assert (await auth_client.patch(path, headers=admin_headers, json=payload)).status_code == 422


@pytest.mark.parametrize("identifier,expected", [(str(uuid4()), 404), ("invalid", 422)])
async def test_unknown_or_invalid_identifiers(auth_client, admin_headers, identifier, expected):
    for path in (f"{COURSES}/{identifier}", f"{COURSES}/{identifier}/modules", f"{ADMIN}/modules/{identifier}",
                 f"{ADMIN}/modules/{identifier}/lessons", f"{ADMIN}/lessons/{identifier}"):
        assert (await auth_client.get(path, headers=admin_headers)).status_code == expected
    assert (await auth_client.post(f"{COURSES}/{identifier}/publish", headers=admin_headers)).status_code == expected
    assert (await auth_client.post(f"{COURSES}/{identifier}/modules", headers=admin_headers,
                                  json={"title": "Missing", "position": 1})).status_code == expected
    assert (await auth_client.post(f"{ADMIN}/modules/{identifier}/lessons", headers=admin_headers,
                                  json={"title": "Missing", "position": 1, "content_type": "TEXT", "content": "Text"})).status_code == expected


async def test_module_input_validation(auth_client, admin_headers):
    course = await create_course(auth_client, admin_headers)
    for changes in ({"position": 0}, {"position": -1}, {"position": True}, {"course_id": str(uuid4())}, {"title": " "}):
        assert (await auth_client.post(f"{COURSES}/{course['id']}/modules", headers=admin_headers,
                                      json={"title": "Module", "position": 1, **changes})).status_code == 422


async def test_course_creator_checked_at_service_boundary(auth_client, auth_session, member_headers):
    from app.core.exceptions import BusinessError
    from app.repositories.course_repository import CourseRepository
    from app.schemas.course import CourseCreate
    from app.services.course_service import CourseService

    member = (await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()
    service = CourseService(CourseRepository(auth_session))
    for creator in (UUID(member["id"]), uuid4()):
        with pytest.raises(BusinessError) as error:
            await service.create(CourseCreate(title="Title", description="Description"), creator)
        assert error.value.status_code == 403


async def test_catalog_openapi(auth_client):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()
    for path, operations in schema["paths"].items():
        if any(resource in path for resource in ("/courses", "/modules", "/lessons")):
            for operation in operations.values():
                assert operation["security"] == [{"HTTPBearer": []}]
                assert {"401", "403", "404", "422"} <= operation["responses"].keys()
    assert set(schema["components"]["schemas"]["CatalogCourse"]["properties"]) == CATALOG_FIELDS
    assert set(schema["components"]["schemas"]["CatalogLesson"]["properties"]) == LESSON_FIELDS
    assert schema["components"]["schemas"]["CourseCreate"]["additionalProperties"] is False


@pytest.mark.parametrize("case", ["module_position", "module_parent", "lesson_position", "lesson_parent", "lesson_duration", "course_creator", "course_lifecycle"])
async def test_database_constraints(auth_client, auth_session, admin_headers, case):
    from sqlalchemy.exc import IntegrityError
    from app.models.course import CourseStatus
    from app.models.module import Module
    from app.models.lesson import ContentType

    course = await create_course(auth_client, admin_headers)
    module = await create_module(auth_client, admin_headers, course["id"])
    if case.startswith("module"):
        record = Module(course_id=uuid4() if case == "module_parent" else UUID(course["id"]),
                        title="Module", position=0 if case == "module_position" else 2)
    elif case.startswith("lesson"):
        record = Lesson(module_id=uuid4() if case == "lesson_parent" else UUID(module["id"]),
                        title="Lesson", position=0 if case == "lesson_position" else 1,
                        content_type=ContentType.TEXT, content="Text",
                        duration_seconds=10 if case == "lesson_duration" else None)
    else:
        record = Course(title="Invalid", slug="invalid", description="Invalid",
                        created_by=uuid4() if case == "course_creator" else UUID(course["created_by"]),
                        status=CourseStatus.PUBLISHED if case == "course_lifecycle" else CourseStatus.DRAFT)
    with pytest.raises(IntegrityError):
        async with auth_session.begin_nested():
            auth_session.add(record)
            await auth_session.flush()


async def test_parent_positions_are_independent_and_lists_paginated(auth_client, admin_headers):
    one = await create_course(auth_client, admin_headers)
    two = await create_course(auth_client, admin_headers, title="Second")
    module_one = await create_module(auth_client, admin_headers, one["id"])
    module_two = await create_module(auth_client, admin_headers, two["id"])
    await create_module(auth_client, admin_headers, one["id"], position=2)
    await create_lesson(auth_client, admin_headers, module_one["id"])
    await create_lesson(auth_client, admin_headers, module_two["id"])
    await create_lesson(auth_client, admin_headers, module_one["id"], position=2)
    for path in (f"{COURSES}/{one['id']}/modules", f"{ADMIN}/modules/{module_one['id']}/lessons"):
        response = await auth_client.get(path, headers=admin_headers, params={"page_size": 1, "page": 2})
        assert response.status_code == 200
        assert response.json()["total"] == 2 and len(response.json()["items"]) == 1
        assert response.json()["items"][0]["position"] == 2


async def test_content_storage_errors_are_safe(auth_client, admin_headers, monkeypatch, caplog):
    from sqlalchemy.exc import OperationalError
    from app.repositories.course_repository import CourseRepository

    async def fail_save(self, course):
        raise OperationalError("private-sql", {"content": "private-content"}, Exception("private-error"))

    monkeypatch.setattr(CourseRepository, "save", fail_save)
    response = await auth_client.post(COURSES, headers=admin_headers, json={"title": "Title", "description": "Description"})
    assert response.status_code == 503
    assert "private-" not in response.text and "private-" not in caplog.text


async def test_inactive_users_cannot_access_content(auth_client, auth_session, admin_headers, member_headers):
    from sqlalchemy import update
    from app.models.user import User

    await auth_session.execute(update(User).values(is_active=False))
    await auth_session.commit()
    assert (await auth_client.get(COURSES, headers=admin_headers)).status_code == 401
    assert (await auth_client.get("/api/v1/courses", headers=member_headers)).status_code == 401
