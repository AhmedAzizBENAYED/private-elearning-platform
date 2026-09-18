"""Optional read-only checks against a real PostgreSQL database."""

import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings


@pytest.mark.integration
@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="Set TEST_DATABASE_URL to run the live PostgreSQL check.",
)
def test_postgresql_connectivity() -> None:
    from app.main import create_app

    application = create_app(
        Settings(
            _env_file=None,
            environment="test",
            database_url=os.environ["TEST_DATABASE_URL"],
        )
    )
    with TestClient(application) as client:
        response = client.get("/api/v1/health/db")

    assert response.status_code == 200
    assert response.json() == {"database": "connected"}
