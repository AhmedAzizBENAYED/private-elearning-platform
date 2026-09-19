"""Browser video playback: lesson-scoped playback tokens and streaming.

These tests drive the real routers, services and storage port. The playback
token is exercised exactly as a browser would use it — in the URL, with no
``Authorization`` header at all.
"""

from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import jwt
import pytest
from httpx import AsyncClient

from app.core.config import Settings
from app.models.user import UserRole
from app.services.auth_service import AuthenticationError, AuthService
from app.storage.memory import InMemoryStorage
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_members import admin_headers
from app.tests.test_courses import create_course, create_module, create_lesson, member_headers, enforce_foreign_keys
from app.tests.test_enrollments import enroll
from app.tests.test_lesson_resources import MP4, PDF, build_lesson, storage, upload

pytestmark = pytest.mark.anyio
ADMIN = "/api/v1/admin"


async def playable_lesson(client: AsyncClient, admin: dict, member: dict, *,
                          content_type: str = "VIDEO") -> dict:
    """Publish a lesson with a stored file and enroll the member in its course."""
    data = await build_lesson(client, admin, content_type=content_type,
                              duration=100 if content_type == "VIDEO" else None)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    if content_type == "VIDEO":
        assert (await upload(client, admin, lesson_id)).status_code == 200
    else:
        assert (await upload(client, admin, lesson_id, payload=PDF, filename="d.pdf",
                             mime="application/pdf")).status_code == 200
    assert (await client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin)).status_code == 200
    await enroll(client, member, course_id)
    return {"lesson_id": lesson_id, "course_id": course_id}


async def playback_url(client: AsyncClient, headers: dict, lesson_id: str) -> str:
    response = await client.get(f"/api/v1/lessons/{lesson_id}/resource", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["download_url"]


def token_of(url: str) -> str:
    return parse_qs(urlparse(url).query)["playback_token"][0]


def auth_service(settings: Settings) -> AuthService:
    return AuthService(settings, None, None)


def claims_of(token: str, settings: Settings) -> dict:
    return jwt.decode(token, settings.jwt_secret_key.get_secret_value(),
                      algorithms=[settings.jwt_algorithm])


# ------------------------------------------------------------ token claims

async def test_video_url_carries_a_playback_token_with_the_expected_claims(
    auth_client, auth_session, storage, admin_headers, member_headers, settings,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    assert url.startswith(f"/api/v1/lessons/{lesson['lesson_id']}/resource/content?playback_token=")

    claims = claims_of(token_of(url), settings)
    me = (await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()
    assert claims["token_type"] == "playback"
    assert claims["sub"] == me["id"]
    assert claims["lesson_id"] == lesson["lesson_id"]
    assert claims["exp"] > claims["iat"]
    expected = settings.playback_token_expire_minutes * 60
    assert claims["exp"] - claims["iat"] == pytest.approx(expected, abs=5)
    assert "jti" in claims and "nbf" in claims


async def test_token_lifetime_follows_configuration(
    auth_client, application, storage, admin_headers, member_headers,
):
    application.state.settings = application.state.settings.model_copy(
        update={"playback_token_expire_minutes": 7})
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    claims = claims_of(token_of(url), application.state.settings)
    assert claims["exp"] - claims["iat"] == pytest.approx(7 * 60, abs=5)


@pytest.mark.parametrize("value", ["0", "-1", "241"])
async def test_playback_lifetime_is_bounded(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    from pydantic import ValidationError

    monkeypatch.setenv("PLAYBACK_TOKEN_EXPIRE_MINUTES", value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


# ------------------------------------------------------- browser playback

async def test_browser_streams_video_without_any_authorization_header(
    auth_client, storage, admin_headers, member_headers,
):
    """The whole point of the ticket: <video src="..."> with no headers."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])

    response = await auth_client.get(url)  # No Authorization header at all.
    assert response.status_code == 200
    assert response.content == MP4
    assert response.headers["content-type"].startswith("video/mp4")
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == str(len(MP4))


async def test_range_requests_still_work_through_a_playback_token(
    auth_client, storage, admin_headers, member_headers,
):
    """Seeking forward and backward must not require a fresh URL."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])

    forward = await auth_client.get(url, headers={"Range": "bytes=4-7"})
    assert forward.status_code == 206 and forward.content == b"ftyp"
    assert forward.headers["content-range"] == f"bytes 4-7/{len(MP4)}"
    assert forward.headers["accept-ranges"] == "bytes"
    assert forward.headers["content-length"] == "4"

    backward = await auth_client.get(url, headers={"Range": "bytes=0-3"})
    assert backward.status_code == 206 and backward.content == MP4[:4]

    open_ended = await auth_client.get(url, headers={"Range": "bytes=500-"})
    assert open_ended.status_code == 206 and open_ended.content == MP4[500:]

    # A malformed range is a full read, exactly as before.
    assert (await auth_client.get(url, headers={"Range": "rows=1-2"})).status_code == 200


async def test_bearer_access_to_the_content_endpoint_still_works(
    auth_client, storage, admin_headers, member_headers,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    response = await auth_client.get(path, headers=member_headers)
    assert response.status_code == 200 and response.content == MP4
    partial = await auth_client.get(path, headers={**member_headers, "Range": "bytes=4-7"})
    assert partial.status_code == 206 and partial.content == b"ftyp"


async def test_content_without_any_credential_is_rejected(auth_client, storage, admin_headers, member_headers):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    assert (await auth_client.get(path)).status_code == 401


# ---------------------------------------------------- token validation

@pytest.mark.parametrize("mangle", [
    lambda token: token[:-1] + ("a" if token[-1] != "a" else "b"),  # broken signature
    lambda token: "not-a-jwt",
    lambda token: "",
    lambda token: token.split(".", 1)[1],
])
async def test_malformed_or_tampered_tokens_are_rejected(
    auth_client, storage, admin_headers, member_headers, mangle,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    token = token_of(url)
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    assert (await auth_client.get(path, params={"playback_token": mangle(token)})).status_code == 401


async def test_token_signed_with_another_key_is_rejected(
    auth_client, storage, admin_headers, member_headers, settings,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    me = (await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()
    now = datetime.now(timezone.utc)
    forged = jwt.encode(
        {"sub": me["id"], "role": "MEMBER", "token_type": "playback", "jti": str(uuid4()),
         "iat": now, "nbf": now, "exp": now + timedelta(minutes=10),
         "lesson_id": lesson["lesson_id"]},
        "a-different-signing-key-that-is-long-enough-for-hs256", algorithm="HS256",
    )
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    assert (await auth_client.get(path, params={"playback_token": forged})).status_code == 401


async def test_expired_token_is_rejected(
    auth_client, storage, admin_headers, member_headers, settings,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    me = (await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    expired = jwt.encode(
        {"sub": me["id"], "role": "MEMBER", "token_type": "playback", "jti": str(uuid4()),
         "iat": past, "nbf": past, "exp": past + timedelta(minutes=30),
         "lesson_id": lesson["lesson_id"]},
        settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm,
    )
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    assert (await auth_client.get(path, params={"playback_token": expired})).status_code == 401


@pytest.mark.parametrize("token_kind", ["access_token", "refresh_token"])
async def test_session_tokens_are_not_accepted_as_playback_tokens(
    auth_client, storage, admin_headers, member_headers, token_kind,
):
    """An access or refresh token in the URL must not stream anything."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    tokens = (await auth_client.post("/api/v1/auth/login",
                                     json={"email": EMAIL, "password": PASSWORD})).json()
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    response = await auth_client.get(path, params={"playback_token": tokens[token_kind]})
    assert response.status_code == 401


async def test_playback_token_cannot_be_used_as_a_session_token(
    auth_client, storage, admin_headers, member_headers,
):
    """The reverse direction: a playback token authenticates nothing else."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    token = token_of(await playback_url(auth_client, member_headers, lesson["lesson_id"]))
    forged = {"Authorization": f"Bearer {token}"}
    assert (await auth_client.get("/api/v1/auth/me", headers=forged)).status_code == 401
    assert (await auth_client.get("/api/v1/me/enrollments", headers=forged)).status_code == 401
    assert (await auth_client.get(f"/api/v1/lessons/{lesson['lesson_id']}/resource",
                                  headers=forged)).status_code == 401


async def test_token_for_one_lesson_cannot_stream_another(
    auth_client, storage, admin_headers, member_headers,
):
    first = await playable_lesson(auth_client, admin_headers, member_headers)
    second = await playable_lesson(auth_client, admin_headers, member_headers)
    token = token_of(await playback_url(auth_client, member_headers, first["lesson_id"]))

    other = f"/api/v1/lessons/{second['lesson_id']}/resource/content"
    assert (await auth_client.get(other, params={"playback_token": token})).status_code == 401
    # It still works for the lesson it was minted for.
    own = f"/api/v1/lessons/{first['lesson_id']}/resource/content"
    assert (await auth_client.get(own, params={"playback_token": token})).status_code == 200


async def test_token_is_bound_to_the_member_it_was_issued_to(
    auth_client, auth_session, storage, admin_headers, member_headers,
):
    """A token issued to the admin streams as the admin, never as someone else."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    await enroll(auth_client, admin_headers, lesson["course_id"])
    admin_token = token_of(await playback_url(auth_client, admin_headers, lesson["lesson_id"]))
    member_token = token_of(await playback_url(auth_client, member_headers, lesson["lesson_id"]))
    assert admin_token != member_token

    admin_claims = claims_of(admin_token, Settings(_env_file=None, environment="test"))
    member_claims = claims_of(member_token, Settings(_env_file=None, environment="test"))
    admin_id = (await auth_client.get("/api/v1/auth/me", headers=admin_headers)).json()["id"]
    member_id = (await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()["id"]
    assert admin_claims["sub"] == admin_id and member_claims["sub"] == member_id


async def test_deactivated_member_cannot_keep_streaming(
    auth_client, auth_session, storage, admin_headers, member_headers,
):
    """Identity is re-checked against the database on every media request."""
    from sqlalchemy import update

    from app.models.user import User

    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    assert (await auth_client.get(url)).status_code == 200

    member_id = UUID((await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()["id"])
    await auth_session.execute(update(User).where(User.id == member_id).values(is_active=False))
    await auth_session.commit()
    assert (await auth_client.get(url)).status_code == 401


# -------------------------------------------------------- authorization

async def test_playback_url_requires_enrollment(auth_client, storage, admin_headers, member_headers):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)

    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource",
                                  headers=member_headers)).status_code == 404
    await enroll(auth_client, member_headers, course_id)
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource",
                                  headers=member_headers)).status_code == 200


async def test_a_valid_token_does_not_survive_losing_enrollment(
    auth_client, auth_session, storage, admin_headers, member_headers,
):
    """Authorization is re-evaluated per request, never implied by the token."""
    from sqlalchemy import delete

    from app.models.enrollment import Enrollment

    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    assert (await auth_client.get(url)).status_code == 200

    await auth_session.execute(delete(Enrollment))
    await auth_session.commit()
    assert (await auth_client.get(url)).status_code == 404


async def test_playback_still_works_for_an_archived_course(
    auth_client, storage, admin_headers, member_headers,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    assert (await auth_client.post(f"{ADMIN}/courses/{lesson['course_id']}/archive",
                                   headers=admin_headers)).status_code == 200
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    assert (await auth_client.get(url)).status_code == 200


# ----------------------------------------------------- resource validation

async def test_document_lessons_get_no_playback_token(
    auth_client, storage, admin_headers, member_headers,
):
    """The token authorizes video playback only; documents stay bearer-only."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers, content_type="DOCUMENT")
    response = await auth_client.get(f"/api/v1/lessons/{lesson['lesson_id']}/resource",
                                     headers=member_headers)
    url = response.json()["download_url"]
    assert "playback_token" not in url
    assert url == f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    # Bearer access to the document is unchanged.
    assert (await auth_client.get(url, headers=member_headers)).status_code == 200
    assert (await auth_client.get(url)).status_code == 401


async def test_a_playback_token_cannot_stream_a_document(
    auth_client, auth_session, storage, admin_headers, member_headers, settings,
):
    """Defence in depth: even a correctly signed token is video-only."""
    lesson = await playable_lesson(auth_client, admin_headers, member_headers, content_type="DOCUMENT")
    me = (await auth_client.get("/api/v1/auth/me", headers=member_headers)).json()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": me["id"], "role": "MEMBER", "token_type": "playback", "jti": str(uuid4()),
         "iat": now, "nbf": now, "exp": now + timedelta(minutes=10),
         "lesson_id": lesson["lesson_id"]},
        settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm,
    )
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    assert (await auth_client.get(path, params={"playback_token": token})).status_code == 401


async def test_removed_resource_stops_playing(
    auth_client, auth_session, storage, admin_headers, member_headers,
):
    """An unexpired token cannot outlive the resource it points at."""
    from sqlalchemy import delete

    from app.models.resource import LessonResource

    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    url = await playback_url(auth_client, member_headers, lesson["lesson_id"])
    assert (await auth_client.get(url)).status_code == 200

    # Resource removal through the API needs a DRAFT course, so the published
    # lesson's row is deleted directly to simulate the post-removal state.
    await auth_session.execute(delete(LessonResource))
    await auth_session.commit()
    assert (await auth_client.get(url)).status_code == 404


async def test_replaced_resource_is_served_after_replacement(
    auth_client, storage, admin_headers, member_headers,
):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await upload(auth_client, admin_headers, lesson_id)
    replacement = MP4 + b"-second-take"
    assert (await upload(auth_client, admin_headers, lesson_id,
                         payload=replacement, filename="v2.mp4")).status_code == 200
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)

    url = await playback_url(auth_client, member_headers, lesson_id)
    response = await auth_client.get(url)
    assert response.status_code == 200 and response.content == replacement


async def test_lesson_without_a_resource_returns_the_existing_error(
    auth_client, storage, admin_headers, member_headers,
):
    data = await build_lesson(auth_client, admin_headers)
    lesson_id, course_id = data["lesson"]["id"], data["course"]["id"]
    await auth_client.post(f"{ADMIN}/courses/{course_id}/publish", headers=admin_headers)
    await enroll(auth_client, member_headers, course_id)
    assert (await auth_client.get(f"/api/v1/lessons/{lesson_id}/resource",
                                  headers=member_headers)).status_code == 404


# ------------------------------------------------------------- url safety

async def test_url_leaks_no_session_token_or_provider_detail(
    auth_client, storage, admin_headers, member_headers,
):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    tokens = (await auth_client.post("/api/v1/auth/login",
                                     json={"email": EMAIL, "password": PASSWORD})).json()
    response = await auth_client.get(f"/api/v1/lessons/{lesson['lesson_id']}/resource",
                                     headers=member_headers)
    body = response.text
    assert tokens["access_token"] not in body
    assert tokens["refresh_token"] not in body
    for leaked in ("google", "drive", "storage_key", "provider_reference", "secret", "refresh_token"):
        assert leaked not in body.lower()
    assert set(response.json()) == {
        "lesson_id", "resource_id", "content_type", "filename", "mime_type",
        "size_bytes", "duration_seconds", "download_url",
    }


async def test_each_request_mints_a_fresh_token(auth_client, storage, admin_headers, member_headers):
    lesson = await playable_lesson(auth_client, admin_headers, member_headers)
    first = token_of(await playback_url(auth_client, member_headers, lesson["lesson_id"]))
    second = token_of(await playback_url(auth_client, member_headers, lesson["lesson_id"]))
    assert first != second  # Distinct jti, so a leaked URL cannot be correlated.
    path = f"/api/v1/lessons/{lesson['lesson_id']}/resource/content"
    for token in (first, second):
        assert (await auth_client.get(path, params={"playback_token": token})).status_code == 200


# ------------------------------------------------- service-level contract

async def test_decode_rejects_a_playback_token_for_another_lesson(settings: Settings) -> None:
    from app.models.user import User

    service = auth_service(settings)
    user = User(id=uuid4(), email="a@example.com", first_name="A", last_name="B",
                role=UserRole.MEMBER, hashed_password="x", is_active=True)
    lesson_id = uuid4()
    token = service.issue_playback_token(user, lesson_id)

    claims = service.decode_token(token, expected_type="playback", lesson_id=lesson_id)
    assert claims.sub == user.id and claims.lesson_id == lesson_id

    with pytest.raises(AuthenticationError):
        service.decode_token(token, expected_type="playback", lesson_id=uuid4())
    with pytest.raises(AuthenticationError):
        service.decode_token(token, expected_type="access")


async def test_inactive_user_cannot_be_issued_a_playback_token(settings: Settings) -> None:
    from app.models.user import User

    service = auth_service(settings)
    user = User(id=uuid4(), email="a@example.com", first_name="A", last_name="B",
                role=UserRole.MEMBER, hashed_password="x", is_active=False)
    with pytest.raises(AuthenticationError):
        service.issue_playback_token(user, uuid4())


async def test_playback_token_without_a_lesson_claim_is_rejected(settings: Settings) -> None:
    service = auth_service(settings)
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": str(uuid4()), "role": "MEMBER", "token_type": "playback", "jti": str(uuid4()),
         "iat": now, "nbf": now, "exp": now + timedelta(minutes=5)},
        settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(AuthenticationError):
        service.decode_token(token, expected_type="playback", lesson_id=uuid4())
