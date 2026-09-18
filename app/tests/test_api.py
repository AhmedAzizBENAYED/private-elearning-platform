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
        "/api/v1/auth/setup-password", "/api/v1/admin/members",
        "/api/v1/admin/members/{member_id}", "/api/v1/admin/members/{member_id}/status",
        "/api/v1/admin/members/{member_id}/activation",
        "/api/v1/admin/courses", "/api/v1/admin/courses/{course_id}",
        "/api/v1/admin/courses/{course_id}/publish", "/api/v1/admin/courses/{course_id}/archive",
        "/api/v1/admin/courses/{course_id}/modules", "/api/v1/admin/modules/{module_id}",
        "/api/v1/admin/modules/{module_id}/lessons", "/api/v1/admin/lessons/{lesson_id}",
        "/api/v1/courses", "/api/v1/courses/{course_id}",
        "/api/v1/courses/{course_id}/modules", "/api/v1/modules/{module_id}/lessons",
        "/api/v1/lessons/{lesson_id}",
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
        Settings(_env_file=None, environment="production", docs_enabled=False)
    )
    with TestClient(application) as client:
        for path in ("/docs", "/redoc", "/api/v1/openapi.json"):
            assert client.get(path).status_code == 404
        assert client.get("/api/v1/health").status_code == 200


def test_legacy_entry_point_uses_the_same_application() -> None:
    from app.main import app
    from main import app as legacy_app

    assert legacy_app is app
