"""CORS for the browser frontend, exercised through the real application.

CORS only tells a browser what it may read; it is not an authorization
boundary. The last section pins that distinction explicitly.
"""

import pytest
from contextlib import contextmanager

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import CORS_EXPOSED_HEADERS, CORS_METHODS, CORS_REQUEST_HEADERS, create_app

DEV = "http://localhost:5173"
OTHER = "https://app.example.com"
EVIL = "https://attacker.example"
PRODUCTION = {
    "storage_provider": "google_drive", "google_drive_client_id": "client",
    "google_drive_client_secret": "secret", "google_drive_refresh_token": "refresh",
    "google_drive_root_folder_id": "folder",
}


@contextmanager
def build(origins, **overrides):
    """A real client over a real app; the lifespan wires state the routes need."""
    settings = Settings(_env_file=None, environment="test",
                        cors_allowed_origins=origins, **overrides)
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture
def client():
    with build((DEV, OTHER)) as test_client:
        yield test_client


def preflight(client: TestClient, origin: str, *, method: str = "GET",
              headers: str = "authorization", path: str = "/api/v1/health"):
    return client.options(path, headers={
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": headers,
    })


# ------------------------------------------------------------ allowed origin

def test_configured_origin_receives_cors_headers(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": DEV})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == DEV
    # Responses differ per origin, so caches must not reuse them across origins.
    assert "origin" in response.headers.get("vary", "").lower()


def test_both_configured_origins_are_allowed(client: TestClient) -> None:
    for origin in (DEV, OTHER):
        response = client.get("/api/v1/health", headers={"Origin": origin})
        assert response.headers["access-control-allow-origin"] == origin
        assert preflight(client, origin).status_code == 200


def test_a_single_configured_origin_works() -> None:
    with build((DEV,)) as single:
        assert single.get("/api/v1/health", headers={"Origin": DEV}
                          ).headers["access-control-allow-origin"] == DEV
        assert "access-control-allow-origin" not in single.get(
            "/api/v1/health", headers={"Origin": OTHER}).headers


# --------------------------------------------------------- disallowed origin

def test_unconfigured_origin_is_not_allowed(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": EVIL})
    # The request still executes server-side; the browser is simply never told
    # it may read the result.
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_unconfigured_origin_preflight_is_refused(client: TestClient) -> None:
    response = preflight(client, EVIL)
    assert response.headers.get("access-control-allow-origin") != EVIL
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("origin", [
    "http://localhost:5174",            # neighbouring port
    "https://localhost:5173",           # different scheme
    "http://localhost.attacker.test",   # suffix trick
    "http://LOCALHOST:5173",            # case-different host
    "null",
])
def test_near_miss_origins_are_not_allowed(client: TestClient, origin: str) -> None:
    response = client.get("/api/v1/health", headers={"Origin": origin})
    assert response.headers.get("access-control-allow-origin") != origin


def test_no_wildcard_is_ever_advertised(client: TestClient) -> None:
    for origin in (DEV, EVIL):
        response = client.get("/api/v1/health", headers={"Origin": origin})
        assert response.headers.get("access-control-allow-origin") != "*"


# ------------------------------------------------------------------ preflight

def test_preflight_allows_the_authorization_header(client: TestClient) -> None:
    response = preflight(client, DEV, method="GET", headers="authorization")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == DEV
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed


def test_preflight_allows_json_content_type(client: TestClient) -> None:
    response = preflight(client, DEV, method="POST", headers="content-type")
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "content-type" in allowed
    assert "POST" in response.headers["access-control-allow-methods"]


def test_preflight_allows_a_login_style_request(client: TestClient) -> None:
    """The exact preflight a fetch() JSON login triggers."""
    response = preflight(client, DEV, method="POST",
                         headers="authorization,content-type",
                         path="/api/v1/auth/login")
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed and "content-type" in allowed


@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "PUT", "DELETE"])
def test_every_verb_the_api_uses_is_allowed(client: TestClient, method: str) -> None:
    response = preflight(client, DEV, method=method)
    assert response.status_code == 200
    assert method in response.headers["access-control-allow-methods"]


def test_preflight_is_cacheable(client: TestClient) -> None:
    assert int(preflight(client, DEV).headers["access-control-max-age"]) > 0


def test_unlisted_request_header_is_not_advertised(client: TestClient) -> None:
    response = preflight(client, DEV, headers="x-made-up-header")
    assert "x-made-up-header" not in response.headers.get(
        "access-control-allow-headers", "").lower()


# ---------------------------------------------------------------- credentials

def test_credentials_are_never_advertised(client: TestClient) -> None:
    """Authentication is a Bearer header, not a cookie, so credentials stay off."""
    simple = client.get("/api/v1/health", headers={"Origin": DEV})
    assert "access-control-allow-credentials" not in simple.headers
    assert "access-control-allow-credentials" not in preflight(client, DEV).headers


def test_no_cookie_is_ever_set(client: TestClient) -> None:
    """Nothing in the request path issues a cookie, so none can be relied upon."""
    health = client.get("/api/v1/health", headers={"Origin": DEV})
    # An invalid body is rejected before the route runs, so this needs no database.
    rejected = client.post("/api/v1/auth/login", headers={"Origin": DEV}, json={})
    assert rejected.status_code == 422
    for response in (health, rejected):
        assert "set-cookie" not in response.headers
        # An error response still tells the browser it may be read.
        assert response.headers["access-control-allow-origin"] == DEV


# ------------------------------------------------------------ video playback

def test_playback_headers_remain_readable_cross_origin(client: TestClient) -> None:
    """Range metadata must survive CORS or seeking breaks in the player."""
    exposed = {header.lower() for header in CORS_EXPOSED_HEADERS}
    assert {"content-range", "accept-ranges"} <= exposed

    response = client.get("/api/v1/health", headers={"Origin": DEV})
    advertised = {part.strip().lower()
                  for part in response.headers["access-control-expose-headers"].split(",")}
    assert {"content-range", "accept-ranges", "content-disposition"} <= advertised


def test_range_is_an_allowed_request_header(client: TestClient) -> None:
    response = preflight(client, DEV, headers="range")
    assert response.status_code == 200
    assert "range" in response.headers["access-control-allow-headers"].lower()


def test_playback_token_urls_are_unaffected_by_cors(client: TestClient) -> None:
    """A media request without a credential is still rejected by the API itself."""
    from uuid import uuid4

    response = client.get(
        f"/api/v1/lessons/{uuid4()}/resource/content", headers={"Origin": DEV})
    assert response.status_code == 401  # CORS did not become an auth bypass.


# ------------------------------------------- CORS is not an auth boundary

def test_cors_does_not_authorize_anything(client: TestClient) -> None:
    """An allowed origin gets CORS headers and still gets 401 without a token."""
    response = client.get("/api/v1/me/enrollments", headers={"Origin": DEV})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == DEV


def test_a_disallowed_origin_does_not_gain_access_either(client: TestClient) -> None:
    response = client.get("/api/v1/me/enrollments", headers={"Origin": EVIL})
    assert response.status_code == 401
    assert "access-control-allow-origin" not in response.headers


def test_requests_without_an_origin_are_untouched(client: TestClient) -> None:
    """Server-to-server and curl clients see no CORS headers and work normally."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


# -------------------------------------------------------------- configuration

def test_no_origins_registers_no_middleware() -> None:
    """A same-origin deployment needs no CORS headers at all."""
    with build(()) as empty:
        response = empty.get("/api/v1/health", headers={"Origin": DEV})
        assert response.status_code == 200
        assert "access-control-allow-origin" not in response.headers


def test_origins_parse_from_a_comma_separated_variable(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", f"{DEV}, {OTHER} ,")
    settings = Settings(_env_file=None, environment="test")
    assert settings.cors_allowed_origins == (DEV, OTHER)


@pytest.mark.parametrize("value", [
    "*", "http://localhost:5173/", "localhost:5173", "http://a.example.com/path",
    "https://*.example.com", "ftp://a.example.com", "https://user:pw@a.example.com",
    "http://a.example.com?q=1",
])
def test_invalid_origins_are_refused_at_startup(monkeypatch, value: str) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="test")


def test_production_refuses_the_development_default(monkeypatch) -> None:
    """Shipping without setting CORS_ALLOWED_ORIGINS must fail, not allow localhost."""
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, environment="production", **PRODUCTION)
    assert "loopback" in str(error.value)


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173",
                                    "http://0.0.0.0:8000", "http://[::1]:5173"])
def test_production_refuses_loopback_origins(origin: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production",
                 cors_allowed_origins=origin, **PRODUCTION)


def test_production_refuses_an_empty_origin_list() -> None:
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, environment="production",
                 cors_allowed_origins="", **PRODUCTION)
    assert "must name the frontend origin" in str(error.value)


def test_production_accepts_an_explicit_public_origin() -> None:
    settings = Settings(_env_file=None, environment="production",
                        cors_allowed_origins=OTHER, **PRODUCTION)
    assert settings.cors_allowed_origins == (OTHER,)


def test_development_default_is_the_vite_dev_server() -> None:
    assert Settings(_env_file=None, environment="development").cors_allowed_origins == (DEV,)


def test_configured_methods_and_headers_cover_the_api() -> None:
    assert set(CORS_METHODS) >= {"GET", "POST", "PATCH", "PUT", "DELETE"}
    assert set(CORS_REQUEST_HEADERS) == {"Authorization", "Content-Type", "Range"}
    # Safelisted response headers are not re-exposed; only what a client cannot
    # otherwise read is listed.
    assert "Content-Type" not in CORS_EXPOSED_HEADERS
    assert "Content-Length" not in CORS_EXPOSED_HEADERS
