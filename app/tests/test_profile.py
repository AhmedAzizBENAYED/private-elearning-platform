"""BE-PROFILE-01: a signed-in user reads and edits their own profile.

`GET /auth/me` already existed; `PATCH /auth/me` and
`POST /auth/change-password` are new. Neither takes an identifier: the account
edited is always the one the access token resolves to, for a MEMBER and for an
ADMIN alike.
"""

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models.user import User, UserRole
from app.repositories.profile_repository import ProfileRepository
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_members import SAFE_FIELDS, admin_headers, login

pytestmark = pytest.mark.anyio
ME = "/api/v1/auth/me"
CHANGE = "/api/v1/auth/change-password"
NEW_PASSWORD = "a-brand-new-password-of-mine"


async def member_headers(client: AsyncClient, password: str = PASSWORD) -> dict[str, str]:
    response = await login(client, EMAIL, password)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def stored(session: AsyncSession, email: str = EMAIL) -> User:
    user = await session.scalar(select(User).where(User.email == email))
    await session.refresh(user)
    return user


def change(current: str = PASSWORD, new: str = NEW_PASSWORD) -> dict[str, str]:
    return {"current_password": current, "new_password": new}


# ------------------------------------------------------------------ reading

async def test_the_profile_is_the_callers_own(auth_client, admin_headers):
    member = await auth_client.get(ME, headers=await member_headers(auth_client))
    admin = await auth_client.get(ME, headers=admin_headers)

    assert member.status_code == 200 and admin.status_code == 200
    assert member.headers["cache-control"] == "no-store"
    assert (member.json()["email"], member.json()["role"]) == (EMAIL, "MEMBER")
    assert (admin.json()["email"], admin.json()["role"]) == ("admin@example.com", "ADMIN")
    for response in (member, admin):
        assert set(response.json()) == SAFE_FIELDS
        assert "$argon2" not in response.text


# ----------------------------------------------------------- authentication

@pytest.mark.parametrize("method,path,payload", [
    ("GET", ME, None),
    ("PATCH", ME, {"first_name": "X"}),
    ("POST", CHANGE, change()),
])
async def test_every_profile_route_needs_a_session(auth_client, auth_session, method, path, payload):
    assert (await auth_client.request(method, path, json=payload)).status_code == 401
    bad = {"Authorization": "Bearer not-a-token"}
    assert (await auth_client.request(method, path, headers=bad, json=payload)).status_code == 401
    # Nothing was written by the refused attempts.
    user = await stored(auth_session)
    assert user.first_name == "Test" and verify_password(PASSWORD, user.hashed_password)


async def test_a_deactivated_account_cannot_edit_itself(auth_client, auth_session):
    headers = await member_headers(auth_client)
    user = await stored(auth_session)
    user.is_active = False
    await auth_session.commit()

    assert (await auth_client.patch(ME, headers=headers, json={"first_name": "X"})).status_code == 401
    assert (await auth_client.post(CHANGE, headers=headers, json=change())).status_code == 401


# ------------------------------------------------------------ profile edit

async def test_a_member_changes_their_name(auth_client, auth_session):
    headers = await member_headers(auth_client)
    before = await stored(auth_session)
    unchanged = (before.id, before.email, before.role, before.is_active, before.hashed_password)

    response = await auth_client.patch(ME, headers=headers,
                                       json={"first_name": "  Amira ", "last_name": "Trabelsi"})

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == SAFE_FIELDS
    assert (body["first_name"], body["last_name"]) == ("Amira", "Trabelsi")
    user = await stored(auth_session)
    assert (user.first_name, user.last_name) == ("Amira", "Trabelsi")
    assert (user.id, user.email, user.role, user.is_active, user.hashed_password) == unchanged
    # And it is what the next read returns.
    assert (await auth_client.get(ME, headers=headers)).json()["first_name"] == "Amira"


@pytest.mark.parametrize("payload,expected", [
    ({"first_name": "Only"}, ("Only", "Member")),
    ({"last_name": "Only"}, ("Test", "Only")),
])
async def test_one_name_can_change_alone(auth_client, auth_session, payload, expected):
    response = await auth_client.patch(ME, headers=await member_headers(auth_client), json=payload)
    assert response.status_code == 200
    user = await stored(auth_session)
    assert (user.first_name, user.last_name) == expected


async def test_an_administrator_edits_their_own_profile_only(auth_client, auth_session, admin_headers):
    response = await auth_client.patch(ME, headers=admin_headers, json={"first_name": "Amal"})

    assert response.status_code == 200
    assert response.json()["role"] == "ADMIN" and response.json()["email"] == "admin@example.com"
    admin = await stored(auth_session, "admin@example.com")
    assert admin.first_name == "Amal" and admin.role == UserRole.ADMIN
    # The member sharing the database was not touched.
    assert (await stored(auth_session)).first_name == "Test"


@pytest.mark.parametrize("extra", [
    {"email": "changed@example.com"}, {"role": "ADMIN"}, {"role": "MEMBER"}, {"is_active": False},
    {"id": "00000000-0000-0000-0000-000000000001"}, {"password": NEW_PASSWORD},
    {"new_password": NEW_PASSWORD}, {"hashed_password": "x"}, {"activation_token_hash": "x"},
    {"created_at": "2020-01-01T00:00:00Z"}, {"updated_at": "2020-01-01T00:00:00Z"},
])
async def test_protected_fields_are_refused(auth_client, auth_session, extra):
    before = await stored(auth_session)
    snapshot = (before.email, before.first_name, before.role, before.is_active, before.hashed_password)

    response = await auth_client.patch(ME, headers=await member_headers(auth_client),
                                       json={"first_name": "Changed", **extra})

    # Refused whole: not even the valid name is applied.
    assert response.status_code == 422
    after = await stored(auth_session)
    assert (after.email, after.first_name, after.role, after.is_active, after.hashed_password) == snapshot


@pytest.mark.parametrize("payload", [
    {}, {"first_name": None}, {"first_name": ""}, {"first_name": "   "},
    {"last_name": "x" * 101}, {"first_name": 42},
])
async def test_invalid_or_empty_changes_are_refused(auth_client, payload):
    response = await auth_client.patch(ME, headers=await member_headers(auth_client), json=payload)
    assert response.status_code == 422


async def test_there_is_no_route_to_edit_someone_else(auth_client, auth_session, admin_headers):
    member = await stored(auth_session)
    for path in (f"{ME}/{member.id}", f"/api/v1/auth/users/{member.id}"):
        response = await auth_client.patch(path, headers=admin_headers, json={"first_name": "Hijacked"})
        assert response.status_code in (404, 405)
    assert (await stored(auth_session)).first_name == "Test"


# --------------------------------------------------------- password change

async def test_a_member_changes_their_password(auth_client, auth_session):
    headers = await member_headers(auth_client)

    response = await auth_client.post(CHANGE, headers=headers, json=change())

    assert response.status_code == 204 and response.content == b""
    assert response.headers["cache-control"] == "no-store"
    user = await stored(auth_session)
    assert user.hashed_password.startswith("$argon2id$")
    assert NEW_PASSWORD not in user.hashed_password
    assert verify_password(NEW_PASSWORD, user.hashed_password)
    assert (user.first_name, user.email, user.role) == ("Test", EMAIL, UserRole.MEMBER)


async def test_the_new_password_signs_in_and_the_old_one_no_longer_does(auth_client):
    await auth_client.post(CHANGE, headers=await member_headers(auth_client), json=change())

    assert (await login(auth_client, EMAIL, NEW_PASSWORD)).status_code == 200
    assert (await login(auth_client, EMAIL, PASSWORD)).status_code == 401


async def test_the_current_session_stays_signed_in(auth_client):
    """Existing session behaviour is kept: changing the password signs nobody out."""
    signed_in = await login(auth_client, EMAIL, PASSWORD)
    headers = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}

    await auth_client.post(CHANGE, headers=headers, json=change())

    assert (await auth_client.get(ME, headers=headers)).status_code == 200
    refreshed = await auth_client.post("/api/v1/auth/refresh",
                                       json={"refresh_token": signed_in.json()["refresh_token"]})
    assert refreshed.status_code == 200


async def test_an_administrator_changes_their_own_password(auth_client, admin_headers):
    response = await auth_client.post(CHANGE, headers=admin_headers, json=change())
    assert response.status_code == 204
    assert (await login(auth_client, "admin@example.com", NEW_PASSWORD)).status_code == 200
    # The member's password is untouched.
    assert (await login(auth_client, EMAIL, PASSWORD)).status_code == 200


async def test_a_wrong_current_password_is_refused_with_400(auth_client, auth_session):
    headers = await member_headers(auth_client)

    response = await auth_client.post(CHANGE, headers=headers, json=change(current="not-my-password"))

    # 400, not 401: the session is valid, and a 401 would make a client
    # refresh and replay the request.
    assert response.status_code == 400
    assert response.json() == {"detail": "Current password is incorrect"}
    assert verify_password(PASSWORD, (await stored(auth_session)).hashed_password)
    assert (await auth_client.get(ME, headers=headers)).status_code == 200


@pytest.mark.parametrize("payload", [
    {"new_password": NEW_PASSWORD},
    {"current_password": "", "new_password": NEW_PASSWORD},
    {"current_password": None, "new_password": NEW_PASSWORD},
    {"current_password": PASSWORD},
])
async def test_the_current_password_is_required(auth_client, auth_session, payload):
    response = await auth_client.post(CHANGE, headers=await member_headers(auth_client), json=payload)
    assert response.status_code == 422
    assert verify_password(PASSWORD, (await stored(auth_session)).hashed_password)


async def test_the_new_password_follows_the_platform_policy(auth_client, auth_session):
    headers = await member_headers(auth_client)

    assert (await auth_client.post(CHANGE, headers=headers, json=change(new="x" * 11))).status_code == 422
    assert (await auth_client.post(CHANGE, headers=headers, json=change(new="x" * 1025))).status_code == 422
    assert verify_password(PASSWORD, (await stored(auth_session)).hashed_password)

    assert (await auth_client.post(CHANGE, headers=headers, json=change(new="x" * 12))).status_code == 204
    assert (await login(auth_client, EMAIL, "x" * 12)).status_code == 200


@pytest.mark.parametrize("extra", [{"email": "x@example.com"}, {"role": "ADMIN"}, {"user_id": "anyone"}])
async def test_the_password_change_accepts_nothing_else(auth_client, auth_session, extra):
    response = await auth_client.post(CHANGE, headers=await member_headers(auth_client),
                                      json={**change(), **extra})
    assert response.status_code == 422
    assert verify_password(PASSWORD, (await stored(auth_session)).hashed_password)


async def test_raw_passwords_never_leave_the_server(auth_client, caplog):
    headers = await member_headers(auth_client)
    short = "tooShort-11"
    responses = [
        await auth_client.post(CHANGE, headers=headers, json=change(new=short)),
        await auth_client.post(CHANGE, headers=headers, json=change(current="wrong-current-pw")),
        await auth_client.post(CHANGE, headers=headers, json={"current_password": PASSWORD}),
        await auth_client.patch(ME, headers=headers, json={"first_name": "X", "password": NEW_PASSWORD}),
        await auth_client.post(CHANGE, headers=headers, json=change()),
        await auth_client.get(ME, headers=headers),
    ]
    for secret in (PASSWORD, NEW_PASSWORD, short, "wrong-current-pw"):
        for response in responses:
            assert secret not in response.text
        assert secret not in caplog.text


async def test_a_concurrent_change_cannot_reuse_the_old_password(auth_session):
    """The swap is conditional on the hash that was verified.

    Two requests presenting the same current password cannot both win: once
    the first has replaced the hash, the second's expected hash is stale.
    """
    user = await stored(auth_session)
    repository = ProfileRepository(auth_session)
    stale = user.hashed_password

    assert await repository.replace_password(user.id, stale, "first-new-hash") is True
    assert await repository.replace_password(user.id, stale, "second-new-hash") is False
    await auth_session.commit()
    assert (await stored(auth_session)).hashed_password == "first-new-hash"


async def test_a_deactivated_account_is_never_written(auth_session):
    user = await stored(auth_session)
    user.is_active = False
    await auth_session.commit()
    current = user.hashed_password

    replaced = await ProfileRepository(auth_session).replace_password(UUID(str(user.id)), current, "new-hash")

    assert replaced is False
    await auth_session.commit()
    assert (await stored(auth_session)).hashed_password == current
