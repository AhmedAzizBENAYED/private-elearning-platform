"""Refresh flow: exchanging a refresh token for a new access token.

The flow is stateless, so these tests assert on JWT claims and on database
state rather than on any stored session.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, update

from app.core.config import Settings
from app.models.user import User, UserRole
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, login, password_hash
from app.tests.test_members import admin_headers

pytestmark = pytest.mark.anyio
REFRESH = "/api/v1/auth/refresh"


def claims_of(token: str, settings: Settings) -> dict:
    return jwt.decode(token, settings.jwt_secret_key.get_secret_value(),
                      algorithms=[settings.jwt_algorithm])


async def refresh(client: AsyncClient, token: str):
    return await client.post(REFRESH, json={"refresh_token": token})


def forge(settings: Settings, *, key: str | None = None, algorithm: str | None = None,
          **overrides) -> str:
    """Build a token with full control over its claims, signed by default correctly."""
    now = datetime.now(timezone.utc)
    payload = {"sub": str(uuid4()), "role": "MEMBER", "token_type": "refresh",
               "jti": str(uuid4()), "iat": now, "nbf": now, "exp": now + timedelta(days=1)}
    payload.update(overrides)
    for absent in [name for name, value in overrides.items() if value is None]:
        payload.pop(absent, None)
    return jwt.encode(payload, key or settings.jwt_secret_key.get_secret_value(),
                      algorithm=algorithm or settings.jwt_algorithm)


async def member_id(client: AsyncClient, tokens: dict) -> UUID:
    me = await client.get("/api/v1/auth/me",
                          headers={"Authorization": f"Bearer {tokens['access_token']}"})
    return UUID(me.json()["id"])


# ------------------------------------------------------------- happy path

async def test_refresh_returns_a_usable_access_token(auth_client, auth_session, settings):
    tokens = await login(auth_client)
    response = await refresh(auth_client, tokens["refresh_token"])

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "token_type"}
    assert body["token_type"] == "bearer"
    assert response.headers["cache-control"] == "no-store"

    claims = claims_of(body["access_token"], settings)
    assert claims["token_type"] == "access"
    assert claims["sub"] == str(await member_id(auth_client, tokens))
    assert claims["exp"] - claims["iat"] == settings.access_token_expire_minutes * 60

    # The renewed token authenticates a normal request.
    me = await auth_client.get("/api/v1/auth/me",
                               headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == EMAIL


async def test_refresh_neither_rotates_nor_extends_the_refresh_token(
    auth_client, auth_session, settings,
):
    """The session still ends when the original refresh token expires."""
    tokens = await login(auth_client)
    before = claims_of(tokens["refresh_token"], settings)

    first = await refresh(auth_client, tokens["refresh_token"])
    assert first.status_code == 200
    assert "refresh_token" not in first.json()

    # The same refresh token keeps working, unchanged, until it expires.
    second = await refresh(auth_client, tokens["refresh_token"])
    assert second.status_code == 200
    assert claims_of(tokens["refresh_token"], settings) == before


async def test_an_admin_can_refresh(auth_client, auth_session, admin_headers, settings):
    tokens = (await auth_client.post("/api/v1/auth/login", json={
        "email": "admin@example.com", "password": PASSWORD})).json()
    response = await refresh(auth_client, tokens["refresh_token"])
    assert response.status_code == 200
    assert claims_of(response.json()["access_token"], settings)["role"] == "ADMIN"


# -------------------------------------------------------- token isolation

async def test_an_access_token_is_not_a_refresh_token(auth_client, auth_session):
    tokens = await login(auth_client)
    assert (await refresh(auth_client, tokens["access_token"])).status_code == 401


async def test_a_playback_token_is_not_a_refresh_token(auth_client, auth_session, settings):
    """Ticket 8's media credential must not renew a session."""
    tokens = await login(auth_client)
    user_id = await member_id(auth_client, tokens)
    now = datetime.now(timezone.utc)
    playback = jwt.encode(
        {"sub": str(user_id), "role": "MEMBER", "token_type": "playback", "jti": str(uuid4()),
         "iat": now, "nbf": now, "exp": now + timedelta(minutes=30), "lesson_id": str(uuid4())},
        settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm,
    )
    assert (await refresh(auth_client, playback)).status_code == 401


async def test_a_refresh_token_is_not_an_access_token(auth_client, auth_session):
    """The reverse direction still holds after adding the endpoint."""
    tokens = await login(auth_client)
    headers = {"Authorization": f"Bearer {tokens['refresh_token']}"}
    assert (await auth_client.get("/api/v1/auth/me", headers=headers)).status_code == 401


# ------------------------------------------------------ token validation

@pytest.mark.parametrize("token", [
    "not-a-jwt",
    "a.b.c",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.",
])
async def test_malformed_tokens_are_rejected(auth_client, auth_session, token):
    assert (await refresh(auth_client, token)).status_code == 401


async def test_tampered_token_is_rejected(auth_client, auth_session):
    tokens = await login(auth_client)
    token = tokens["refresh_token"]
    tampered = token[:-1] + ("a" if token[-1] != "a" else "b")
    assert (await refresh(auth_client, tampered)).status_code == 401


async def test_token_signed_with_another_key_is_rejected(auth_client, auth_session, settings):
    forged = forge(settings, key="a-different-signing-key-long-enough-for-hs256-use")
    assert (await refresh(auth_client, forged)).status_code == 401


async def test_expired_refresh_token_is_rejected(auth_client, auth_session, settings):
    tokens = await login(auth_client)
    past = datetime.now(timezone.utc) - timedelta(days=30)
    expired = forge(settings, sub=str(await member_id(auth_client, tokens)),
                    iat=past, nbf=past, exp=past + timedelta(days=7))
    assert (await refresh(auth_client, expired)).status_code == 401


@pytest.mark.parametrize("missing", ["sub", "role", "token_type", "jti", "iat", "nbf", "exp"])
async def test_tokens_missing_required_claims_are_rejected(
    auth_client, auth_session, settings, missing,
):
    assert (await refresh(auth_client, forge(settings, **{missing: None}))).status_code == 401


@pytest.mark.parametrize("claims", [
    {"sub": "not-a-uuid"},
    {"role": "SUPERUSER"},
    {"token_type": "other"},
    {"jti": "not-a-uuid"},
])
async def test_tokens_with_invalid_claim_values_are_rejected(
    auth_client, auth_session, settings, claims,
):
    assert (await refresh(auth_client, forge(settings, **claims))).status_code == 401


async def test_algorithm_confusion_is_rejected(auth_client, auth_session, settings):
    """An unsigned token must never be accepted, whatever it claims."""
    tokens = await login(auth_client)
    now = datetime.now(timezone.utc)
    unsigned = jwt.encode(
        {"sub": str(await member_id(auth_client, tokens)), "role": "ADMIN",
         "token_type": "refresh", "jti": str(uuid4()), "iat": now, "nbf": now,
         "exp": now + timedelta(days=1)}, key="", algorithm="none",
    )
    assert (await refresh(auth_client, unsigned)).status_code == 401


# --------------------------------------------------------- request shape

@pytest.mark.parametrize("payload", [
    {}, {"refresh_token": ""}, {"refresh_token": None}, {"refresh_token": 12345},
    {"token": "x"}, {"refresh_token": "x", "role": "ADMIN"},
])
async def test_invalid_request_bodies_are_rejected(auth_client, auth_session, payload):
    """Structural problems use the existing 422 validation convention."""
    response = await auth_client.post(REFRESH, json=payload)
    assert response.status_code == 422


async def test_the_response_exposes_nothing_beyond_the_access_token(
    auth_client, auth_session, settings,
):
    tokens = await login(auth_client)
    response = await refresh(auth_client, tokens["refresh_token"])
    body = response.text
    assert set(response.json()) == {"access_token", "token_type"}
    assert tokens["refresh_token"] not in body
    for leaked in ("password", "hashed", "secret", "argon2", EMAIL):
        assert leaked.lower() not in body.lower()


# -------------------------------------------------------- user lifecycle

async def test_a_deactivated_member_cannot_refresh(auth_client, auth_session):
    tokens = await login(auth_client)
    user_id = await member_id(auth_client, tokens)

    await auth_session.execute(update(User).where(User.id == user_id).values(is_active=False))
    await auth_session.commit()
    auth_session.expire_all()  # A real request would load a fresh identity.

    response = await refresh(auth_client, tokens["refresh_token"])
    assert response.status_code == 401
    # The message must not distinguish deactivation from a bad token.
    assert response.json() == {"detail": "Invalid authentication credentials"}


async def test_a_deleted_user_cannot_refresh(auth_client, auth_session):
    tokens = await login(auth_client)
    user_id = await member_id(auth_client, tokens)

    await auth_session.execute(delete(User).where(User.id == user_id))
    await auth_session.commit()
    auth_session.expire_all()

    response = await refresh(auth_client, tokens["refresh_token"])
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid authentication credentials"}


async def test_a_token_for_an_unknown_user_is_rejected(auth_client, auth_session, settings):
    """A perfectly signed token for a subject that never existed."""
    response = await refresh(auth_client, forge(settings, sub=str(uuid4())))
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid authentication credentials"}


# ----------------------------------------------------------- role changes

async def test_promotion_to_admin_takes_effect_on_refresh(auth_client, auth_session, settings):
    """The refresh token's stale MEMBER claim must not win over the database."""
    tokens = await login(auth_client)
    user_id = await member_id(auth_client, tokens)
    assert claims_of(tokens["refresh_token"], settings)["role"] == "MEMBER"

    await auth_session.execute(
        update(User).where(User.id == user_id).values(role=UserRole.ADMIN))
    await auth_session.commit()
    auth_session.expire_all()

    renewed = await refresh(auth_client, tokens["refresh_token"])
    assert renewed.status_code == 200
    access = renewed.json()["access_token"]
    assert claims_of(access, settings)["role"] == "ADMIN"
    # And the new token really carries admin authority.
    assert (await auth_client.get("/test/admin",
                                  headers={"Authorization": f"Bearer {access}"})).status_code == 200


async def test_demotion_to_member_takes_effect_on_refresh(
    auth_client, auth_session, admin_headers, settings,
):
    tokens = (await auth_client.post("/api/v1/auth/login", json={
        "email": "admin@example.com", "password": PASSWORD})).json()
    assert claims_of(tokens["refresh_token"], settings)["role"] == "ADMIN"

    await auth_session.execute(
        update(User).where(User.email == "admin@example.com").values(role=UserRole.MEMBER))
    await auth_session.commit()
    auth_session.expire_all()

    renewed = await refresh(auth_client, tokens["refresh_token"])
    assert renewed.status_code == 200
    access = renewed.json()["access_token"]
    assert claims_of(access, settings)["role"] == "MEMBER"
    # The demotion is enforced, not merely reported.
    assert (await auth_client.get("/test/admin",
                                  headers={"Authorization": f"Bearer {access}"})).status_code == 403


async def test_a_forged_role_claim_does_not_grant_admin(auth_client, auth_session, settings):
    """Even a correctly signed token cannot self-promote its subject."""
    tokens = await login(auth_client)
    user_id = await member_id(auth_client, tokens)
    forged = forge(settings, sub=str(user_id), role="ADMIN")

    renewed = await refresh(auth_client, forged)
    assert renewed.status_code == 200
    access = renewed.json()["access_token"]
    assert claims_of(access, settings)["role"] == "MEMBER"
    assert (await auth_client.get("/test/admin",
                                  headers={"Authorization": f"Bearer {access}"})).status_code == 403


# ------------------------------------------------------- existing behavior

async def test_login_contract_is_unchanged(auth_client, auth_session, settings):
    tokens = await login(auth_client)
    assert set(tokens) == {"access_token", "refresh_token", "token_type"}
    assert tokens["token_type"] == "bearer"
    assert claims_of(tokens["access_token"], settings)["token_type"] == "access"
    assert claims_of(tokens["refresh_token"], settings)["token_type"] == "refresh"


async def test_refresh_requires_no_authorization_header(auth_client, auth_session):
    """The refresh token in the body is the only credential needed."""
    tokens = await login(auth_client)
    response = await auth_client.post(
        REFRESH, json={"refresh_token": tokens["refresh_token"]},
        headers={"Authorization": "Bearer garbage"},
    )
    assert response.status_code == 200
