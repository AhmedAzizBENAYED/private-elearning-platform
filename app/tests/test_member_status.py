"""MEMBERS-02: an administrator switches a MEMBER account off and on again.

`PATCH /admin/members/{id}/status` already existed; no backend change was
needed. These tests pin the requirements of the ticket one by one - only the
activation state moves, the role never does, and every way of reaching the
platform (sign-in, refresh, an access token already held) follows the state.
"""

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models.user import User, UserRole
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash
from app.tests.test_members import INITIAL_PASSWORD, ROOT, SAFE_FIELDS, admin_headers, create, login

pytestmark = pytest.mark.anyio


def status_path(member_id: str) -> str:
    return f"{ROOT}/{member_id}/status"


async def member_headers(client: AsyncClient) -> dict[str, str]:
    response = await login(client, EMAIL, PASSWORD)
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ------------------------------------------------------------ authorization

async def test_only_an_administrator_may_change_a_status(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    path = status_path(created["id"])

    assert (await auth_client.patch(path, json={"is_active": False})).status_code == 401
    assert (await auth_client.patch(path, headers=await member_headers(auth_client),
                                    json={"is_active": False})).status_code == 403
    assert (await auth_client.patch(path, headers=admin_headers,
                                    json={"is_active": False})).status_code == 200


async def test_a_member_cannot_switch_themselves_or_anyone_back_on(auth_client, auth_session, admin_headers):
    created = await create(auth_client, admin_headers)
    await auth_client.patch(status_path(created["id"]), headers=admin_headers, json={"is_active": False})
    member = await auth_session.scalar(select(User).where(User.email == EMAIL))

    headers = await member_headers(auth_client)
    for target in (created["id"], str(member.id)):
        response = await auth_client.patch(status_path(target), headers=headers, json={"is_active": True})
        assert response.status_code == 403
    target = await auth_session.get(User, UUID(created["id"]))
    await auth_session.refresh(target)
    assert target.is_active is False


# --------------------------------------------------------- the transitions

async def test_deactivation_changes_the_state_and_nothing_else(auth_client, auth_session, admin_headers):
    created = await create(auth_client, admin_headers)
    user = await auth_session.get(User, UUID(created["id"]))
    before = (user.email, user.first_name, user.last_name, user.role, user.hashed_password)

    response = await auth_client.patch(status_path(created["id"]), headers=admin_headers,
                                       json={"is_active": False})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == SAFE_FIELDS
    assert body["is_active"] is False and body["role"] == "MEMBER"
    assert (body["email"], body["first_name"], body["last_name"]) == before[:3]
    await auth_session.refresh(user)
    assert user.is_active is False
    assert (user.email, user.first_name, user.last_name, user.role, user.hashed_password) == before
    # The member's password still works the moment they are reactivated.
    assert verify_password(INITIAL_PASSWORD, user.hashed_password)


async def test_activation_restores_the_account_and_keeps_the_role(auth_client, auth_session, admin_headers):
    created = await create(auth_client, admin_headers)
    path = status_path(created["id"])
    await auth_client.patch(path, headers=admin_headers, json={"is_active": False})

    response = await auth_client.patch(path, headers=admin_headers, json={"is_active": True})

    assert response.status_code == 200
    assert response.json()["is_active"] is True and response.json()["role"] == "MEMBER"
    user = await auth_session.get(User, UUID(created["id"]))
    await auth_session.refresh(user)
    assert user.is_active is True and user.role == UserRole.MEMBER


@pytest.mark.parametrize("state", [False, True])
async def test_repeating_a_transition_is_harmless(auth_client, admin_headers, state):
    created = await create(auth_client, admin_headers)
    path = status_path(created["id"])
    await auth_client.patch(path, headers=admin_headers, json={"is_active": state})

    again = await auth_client.patch(path, headers=admin_headers, json={"is_active": state})

    assert again.status_code == 200 and again.json()["is_active"] is state


# ---------------------------------------------------------- protected fields

@pytest.mark.parametrize("extra", [
    {"role": "ADMIN"}, {"role": "MEMBER"}, {"email": "changed@example.com"},
    {"first_name": "Changed"}, {"last_name": "Changed"}, {"password": "a-new-password-attempt"},
    {"hashed_password": "x"}, {"activation_token_hash": "x"},
])
async def test_the_status_endpoint_cannot_touch_any_other_field(auth_client, auth_session, admin_headers, extra):
    created = await create(auth_client, admin_headers)
    user = await auth_session.get(User, UUID(created["id"]))
    before = (user.email, user.first_name, user.last_name, user.role, user.hashed_password, user.is_active)

    response = await auth_client.patch(status_path(created["id"]), headers=admin_headers,
                                       json={"is_active": False, **extra})

    # Refused as a whole: not even the valid half of the request is applied.
    assert response.status_code == 422
    await auth_session.refresh(user)
    assert (user.email, user.first_name, user.last_name, user.role,
            user.hashed_password, user.is_active) == before


@pytest.mark.parametrize("payload", [{}, {"is_active": "false"}, {"is_active": 0}, {"is_active": None}])
async def test_the_state_must_be_a_real_boolean(auth_client, admin_headers, payload):
    """`strict=True`: no string or integer is coerced into a status."""
    created = await create(auth_client, admin_headers)
    response = await auth_client.patch(status_path(created["id"]), headers=admin_headers, json=payload)
    assert response.status_code == 422


@pytest.mark.parametrize("identifier,expected", [(str(uuid4()), 404), ("not-a-uuid", 422)])
async def test_an_unknown_member_is_the_existing_error(auth_client, admin_headers, identifier, expected):
    response = await auth_client.patch(status_path(identifier), headers=admin_headers, json={"is_active": False})
    assert response.status_code == expected


# ------------------------------------------------------------ authentication

async def test_sign_in_follows_the_state_through_a_full_cycle(auth_client, admin_headers):
    """The ticket's acceptance criterion: active, deactivated, reactivated."""
    created = await create(auth_client, admin_headers)
    path = status_path(created["id"])

    active = await login(auth_client, "new@example.com", INITIAL_PASSWORD)
    assert active.status_code == 200
    held_access = {"Authorization": f"Bearer {active.json()['access_token']}"}
    held_refresh = active.json()["refresh_token"]

    await auth_client.patch(path, headers=admin_headers, json={"is_active": False})

    # Every door closes at once - not only a new sign-in.
    denied = await login(auth_client, "new@example.com", INITIAL_PASSWORD)
    assert denied.status_code == 401
    # Indistinguishable from a wrong password: the refusal reveals nothing.
    wrong = await login(auth_client, "new@example.com", "not-the-password-at-all")
    assert denied.json() == wrong.json()
    assert (await auth_client.get("/api/v1/auth/me", headers=held_access)).status_code == 401
    refreshed = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": held_refresh})
    assert refreshed.status_code == 401

    await auth_client.patch(path, headers=admin_headers, json={"is_active": True})

    again = await login(auth_client, "new@example.com", INITIAL_PASSWORD)
    assert again.status_code == 200
    me = await auth_client.get("/api/v1/auth/me",
                               headers={"Authorization": f"Bearer {again.json()['access_token']}"})
    assert me.json()["role"] == "MEMBER" and me.json()["is_active"] is True
