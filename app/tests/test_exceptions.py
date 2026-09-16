"""HTTP errors, input validation, and safe responses for unexpected failures."""

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel


class ExampleRequest(BaseModel):
    quantity: int


def test_http_error_preserves_status_detail_and_headers(application: FastAPI) -> None:
    @application.get("/test/http-error")
    async def http_error() -> None:
        raise HTTPException(
            status_code=429,
            detail="Try again later",
            headers={"Retry-After": "60"},
        )

    with TestClient(application) as client:
        response = client.get("/test/http-error")

    assert response.status_code == 429
    assert response.json() == {"detail": "Try again later"}
    assert response.headers["retry-after"] == "60"


def test_validation_does_not_echo_submitted_input(application: FastAPI) -> None:
    @application.post("/test/validation")
    async def validate(payload: ExampleRequest) -> ExampleRequest:
        return payload

    with TestClient(application) as client:
        response = client.post(
            "/test/validation", json={"quantity": "private-submitted-value"}
        )

    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "quantity"]
    assert error["type"] == "int_parsing"
    assert "msg" in error
    assert "input" not in error
    assert "ctx" not in error
    assert "private-submitted-value" not in response.text


def test_unexpected_error_returns_safe_json(application: FastAPI) -> None:
    @application.get("/test/unexpected-error")
    async def unexpected_error() -> None:
        raise RuntimeError("Internal connection information")

    with TestClient(application, raise_server_exceptions=False) as client:
        response = client.get("/test/unexpected-error")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "Internal connection information" not in response.text
    assert "Traceback" not in response.text
