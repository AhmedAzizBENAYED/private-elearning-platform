"""Public routes, metadata, and documentation controls."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings


def test_health(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["content-type"] == "application/json"


def test_metadata_and_versioned_schema(client: TestClient, settings: Settings) -> None:
    response = client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == settings.name
    assert schema["info"]["version"] == settings.version
    assert schema["info"]["description"] == settings.description
    assert set(schema["paths"]) == {
        "/api/v1/health", "/api/v1/health/db", "/api/v1/auth/login", "/api/v1/auth/me",
        "/api/v1/auth/setup-password", "/api/v1/auth/refresh", "/api/v1/admin/members",
        "/api/v1/admin/members/{member_id}", "/api/v1/admin/members/{member_id}/status",
        "/api/v1/admin/members/{member_id}/activation",
        "/api/v1/admin/courses", "/api/v1/admin/courses/{course_id}",
        "/api/v1/admin/courses/{course_id}/publish", "/api/v1/admin/courses/{course_id}/archive",
        "/api/v1/admin/courses/{course_id}/modules", "/api/v1/admin/modules/{module_id}",
        "/api/v1/admin/modules/{module_id}/lessons", "/api/v1/admin/lessons/{lesson_id}",
        "/api/v1/courses", "/api/v1/courses/{course_id}",
        "/api/v1/courses/{course_id}/modules", "/api/v1/modules/{module_id}/lessons",
        "/api/v1/lessons/{lesson_id}",
        "/api/v1/courses/{course_id}/enroll", "/api/v1/me/enrollments",
        "/api/v1/courses/{course_id}/enrollment", "/api/v1/courses/{course_id}/progress",
        "/api/v1/courses/{course_id}/content",
        "/api/v1/lessons/{lesson_id}/progress",
        "/api/v1/admin/lessons/{lesson_id}/resource", "/api/v1/lessons/{lesson_id}/resource",
        "/api/v1/lessons/{lesson_id}/resource/content",
        "/api/v1/admin/courses/{course_id}/resources",
        # BE-COURSE-REORDER-01: the atomic reorganisation, additive.
        "/api/v1/admin/courses/{course_id}/structure",
        "/api/v1/auth/logout", "/api/v1/auth/change-password",
        # BE-THUMBNAIL-UPLOAD-01: the upload, and the public read of its bytes.
        "/api/v1/admin/courses/{course_id}/thumbnail",
        "/api/v1/course-thumbnails/{course_id}/{name}",
        # BE-LEARNING-TRACKING-01: a member's own course/module/lesson openings.
        "/api/v1/me/learning-events",
        # BE-LEARNING-TRACKING-02: the administrator reads of that tracking.
        "/api/v1/admin/learning/progress", "/api/v1/admin/learning/activity",
        "/api/v1/admin/learning/members/{member_id}", "/api/v1/admin/courses/{course_id}/learning",
    }
    assert client.get("/docs").status_code == 200


@pytest.mark.parametrize("path", ["/", "/hello/User", "/health", "/api/v2/health"])
def test_unknown_routes_use_json_errors(client: TestClient, path: str) -> None:
    response = client.get(path)

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_docs_can_be_disabled() -> None:
    from app.main import create_app

    application = create_app(
        # A production instance must name a durable storage provider and a
        # non-loopback frontend origin.
        Settings(_env_file=None, environment="production", docs_enabled=False,
                 storage_provider="google_drive", google_drive_client_id="client",
                 google_drive_client_secret="secret", google_drive_refresh_token="refresh",
                 google_drive_root_folder_id="folder",
                 cors_allowed_origins="https://app.example.com")
    )
    with TestClient(application) as client:
        for path in ("/docs", "/redoc", "/api/v1/openapi.json"):
            assert client.get(path).status_code == 404
        assert client.get("/api/v1/health").status_code == 200


def test_legacy_entry_point_uses_the_same_application() -> None:
    from app.main import app
    from main import app as legacy_app

    assert legacy_app is app
