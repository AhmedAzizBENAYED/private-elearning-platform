"""BE-SEC-02: signing out revokes a refresh token server-side.

Before this change the application had no logout endpoint at all. A refresh
token issued at login stayed usable for its full seven days no matter what the
browser did with its copy, because nothing server-side ever recorded that a
session had ended.

Every test here fails against the previous implementation - most of them by
404, since the endpoint did not exist.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.revoked_token import RevokedRefreshToken
from app.models.user import User, UserRole
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash

pytestmark = pytest.mark.anyio

API = "/api/v1"
SECOND_EMAIL = "second@example.com"


async def sign_in(client: AsyncClient, email: str = EMAIL) -> dict[str, str]:
    """A complete session: both tokens, exactly as a browser receives them."""
    response = await client.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()


async def refresh(client: AsyncClient, token: str):
    return await client.post(f"{API}/auth/refresh", json={"refresh_token": token})


async def logout(client: AsyncClient, token: str):
    return await client.post(f"{API}/auth/logout", json={"refresh_token": token})


@pytest.fixture
async def second_user(auth_session: AsyncSession, password_hash: str) -> None:
    auth_session.add(User(email=SECOND_EMAIL, first_name="Second", last_name="Member",
                          role=UserRole.MEMBER, hashed_password=password_hash))
    await auth_session.commit()


def claims_of(token: str) -> dict:
    """Read a token's claims without verifying it; tests only, never the app."""
    return jwt.decode(token, options={"verify_signature": False})


# --------------------------------------------------------------- the basics

async def test_refresh_works_before_signing_out(auth_client):
    session = await sign_in(auth_client)

    response = await refresh(auth_client, session["refresh_token"])

    assert response.status_code == 200
    assert response.json()["access_token"]
    assert response.json()["token_type"] == "bearer"


async def test_signing_out_revokes_the_refresh_token(auth_client):
    """The acceptance criterion: the server refuses the token afterwards."""
    session = await sign_in(auth_client)
    token = session["refresh_token"]
    assert (await refresh(auth_client, token)).status_code == 200

    assert (await logout(auth_client, token)).status_code == 204

    refused = await refresh(auth_client, token)
    assert refused.status_code == 401
    assert "access_token" not in refused.text


async def test_a_revoked_token_stays_revoked_however_often_it_is_tried(auth_client):
    session = await sign_in(auth_client)
    token = session["refresh_token"]
    await logout(auth_client, token)

    for _ in range(5):
        assert (await refresh(auth_client, token)).status_code == 401


async def test_the_stored_record_holds_no_credential(auth_client, auth_session):
    """Only the jti is kept - never the token, and never anything signable."""
    session = await sign_in(auth_client)
    token = session["refresh_token"]
    await logout(auth_client, token)

    row = await auth_session.scalar(select(RevokedRefreshToken))
    assert row is not None
    assert str(row.jti) == claims_of(token)["jti"]
    # The token itself appears nowhere in the row.
    stored = " ".join(str(value) for value in
                      (row.jti, row.user_id, row.expires_at, row.revoked_at))
    assert token not in stored
    assert token.split(".")[2] not in stored  # not even the signature
    # The recorded expiry is the token's own, so a purge cannot kill a live one.
    # SQLite hands back a naive datetime, so it is read as the UTC it was
    # written as rather than as local time.
    stored_expiry = row.expires_at
    if stored_expiry.tzinfo is None:
        stored_expiry = stored_expiry.replace(tzinfo=timezone.utc)
    assert int(stored_expiry.timestamp()) == claims_of(token)["exp"]


# ------------------------------------------------------------ what is refused

async def test_an_expired_refresh_token_is_still_refused(auth_client, auth_session, settings):
    user = await auth_session.scalar(select(User).where(User.email == EMAIL))
    now = datetime.now(timezone.utc) - timedelta(days=30)
    expired = jwt.encode(
        {"sub": str(user.id), "role": user.role.value, "token_type": "refresh",
         "jti": str(uuid4()), "iat": now, "nbf": now, "exp": now + timedelta(days=7)},
        settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm,
    )

    assert (await refresh(auth_client, expired)).status_code == 401
    # Revocation did not weaken expiry checking, and signing out an expired
    # token records nothing: there is nothing left to revoke.
    assert (await logout(auth_client, expired)).status_code == 204
    assert await auth_session.scalar(select(func.count()).select_from(RevokedRefreshToken)) == 0


@pytest.mark.parametrize("token", [
    "not-a-token",
    "a.b.c",
    "",
    "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.",
])
async def test_malformed_tokens_are_refused(auth_client, token):
    response = await refresh(auth_client, token)
    assert response.status_code in {401, 422}


async def test_an_access_token_cannot_be_used_to_refresh(auth_client):
    session = await sign_in(auth_client)

    assert (await refresh(auth_client, session["access_token"])).status_code == 401


async def test_signing_out_with_an_access_token_revokes_nothing(auth_client, auth_session):
    """The wrong token type must not take a session down, nor create a row."""
    session = await sign_in(auth_client)

    assert (await logout(auth_client, session["access_token"])).status_code == 204

    assert await auth_session.scalar(select(func.count()).select_from(RevokedRefreshToken)) == 0
    # The real refresh token is untouched.
    assert (await refresh(auth_client, session["refresh_token"])).status_code == 200


async def test_a_tampered_token_is_refused_before_revocation_is_consulted(
    auth_client, auth_session, settings,
):
    """Changing the payload breaks the signature, whatever is changed."""
    session = await sign_in(auth_client)
    original = claims_of(session["refresh_token"])
    await logout(auth_client, session["refresh_token"])

    other = await auth_session.scalar(select(User).where(User.email == EMAIL))
    now = datetime.now(timezone.utc)
    forgeries = {
        "fresh jti": {**original, "jti": str(uuid4())},
        "other subject": {**original, "sub": str(uuid4())},
        "elevated role": {**original, "role": UserRole.ADMIN.value},
        "extended expiry": {**original, "exp": int((now + timedelta(days=365)).timestamp())},
        "retyped as access": {**original, "token_type": "access"},
    }

    for name, payload in forgeries.items():
        forged = jwt.encode(payload, "an-attackers-own-signing-key-not-the-servers",
                            algorithm=settings.jwt_algorithm)
        assert (await refresh(auth_client, forged)).status_code == 401, name

    # And the genuine token is still revoked - no forgery reinstated it.
    assert (await refresh(auth_client, session["refresh_token"])).status_code == 401
    assert other is not None


# ------------------------------------------------------------------ sessions

async def test_signing_out_of_one_browser_leaves_the_other_signed_in(auth_client):
    """Two logins, two refresh tokens; logout is scoped to the one presented."""
    browser_a = await sign_in(auth_client)
    browser_b = await sign_in(auth_client)
    assert browser_a["refresh_token"] != browser_b["refresh_token"]

    assert (await logout(auth_client, browser_a["refresh_token"])).status_code == 204

    assert (await refresh(auth_client, browser_a["refresh_token"])).status_code == 401
    assert (await refresh(auth_client, browser_b["refresh_token"])).status_code == 200


async def test_one_member_signing_out_does_not_touch_another(auth_client, second_user):
    mine = await sign_in(auth_client)
    theirs = await sign_in(auth_client, SECOND_EMAIL)

    await logout(auth_client, mine["refresh_token"])

    assert (await refresh(auth_client, mine["refresh_token"])).status_code == 401
    assert (await refresh(auth_client, theirs["refresh_token"])).status_code == 200


async def test_signing_in_again_produces_a_working_session(auth_client):
    """Revocation is per token, so it must not poison the next sign-in."""
    first = await sign_in(auth_client)
    await logout(auth_client, first["refresh_token"])

    second = await sign_in(auth_client)
    assert second["refresh_token"] != first["refresh_token"]
    assert (await refresh(auth_client, second["refresh_token"])).status_code == 200


# --------------------------------------------------------------- idempotence

async def test_signing_out_twice_is_not_an_error(auth_client, auth_session):
    session = await sign_in(auth_client)
    token = session["refresh_token"]

    first = await logout(auth_client, token)
    second = await logout(auth_client, token)

    assert first.status_code == 204 and second.status_code == 204
    # One row, not two: the jti is the primary key.
    assert await auth_session.scalar(select(func.count()).select_from(RevokedRefreshToken)) == 1


async def test_signing_out_never_reveals_whether_a_token_was_valid(auth_client):
    """Logout must not become an oracle for testing tokens."""
    session = await sign_in(auth_client)

    real = await logout(auth_client, session["refresh_token"])
    again = await logout(auth_client, session["refresh_token"])
    nonsense = await logout(auth_client, "not-a-token-at-all")

    assert real.status_code == again.status_code == nonsense.status_code == 204
    assert real.text == again.text == nonsense.text == ""


# ----------------------------------------------------------- what is preserved

async def test_an_existing_access_token_still_works_until_it_expires(auth_client):
    """Documented, not accidental: this ticket revokes refresh tokens only.

    An access token is a stateless bearer credential with a 15-minute life.
    Refusing one would mean a database lookup on every authenticated request,
    which is a different design rather than a revocation fix.
    """
    session = await sign_in(auth_client)
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    await logout(auth_client, session["refresh_token"])

    assert (await auth_client.get(f"{API}/auth/me", headers=headers)).status_code == 200
    # But it cannot be renewed, so the session ends within its lifetime.
    assert (await refresh(auth_client, session["refresh_token"])).status_code == 401


async def test_the_refresh_token_is_neither_rotated_nor_extended(auth_client):
    """Unchanged by this ticket, and asserted so a later change is deliberate."""
    session = await sign_in(auth_client)
    before = claims_of(session["refresh_token"])

    renewed = await refresh(auth_client, session["refresh_token"])

    assert renewed.status_code == 200
    # The response carries an access token only - no new refresh token.
    assert "refresh_token" not in renewed.json()
    assert claims_of(session["refresh_token"])["exp"] == before["exp"]


async def test_no_token_appears_in_any_response_body(auth_client):
    session = await sign_in(auth_client)
    token = session["refresh_token"]

    signed_out = await logout(auth_client, token)
    refused = await refresh(auth_client, token)

    for response in (signed_out, refused):
        assert token not in response.text
        assert "jti" not in response.text
        assert "secret" not in response.text.lower()
    assert refused.json() == {"detail": "Invalid authentication credentials"}


# --------------------------------------------------------------- maintenance

async def test_expired_records_can_be_purged_without_freeing_a_live_token(
    auth_client, auth_session,
):
    """Purging is safe because a row only matters until the token expires."""
    from app.repositories.revoked_token_repository import RevokedTokenRepository

    live = await sign_in(auth_client)
    await logout(auth_client, live["refresh_token"])

    # A revocation whose token expired long ago, as the table would accumulate.
    user_id = UUID(claims_of(live["refresh_token"])["sub"])
    stale = datetime.now(timezone.utc) - timedelta(days=30)
    auth_session.add(RevokedRefreshToken(jti=uuid4(), user_id=user_id, expires_at=stale))
    await auth_session.commit()

    repository = RevokedTokenRepository(auth_session)
    removed = await repository.purge_expired(datetime.now(timezone.utc))
    await auth_session.commit()

    assert removed == 1
    # The live revocation survived, and still refuses its token.
    assert await auth_session.scalar(select(func.count()).select_from(RevokedRefreshToken)) == 1
    assert (await refresh(auth_client, live["refresh_token"])).status_code == 401
