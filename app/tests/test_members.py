"""Member lifecycle through the existing async database/client test architecture."""

import hashlib
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models.user import User, UserRole
# Reuse the authentication suite's real SQLAlchemy and application fixtures.
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash

pytestmark = pytest.mark.anyio
ROOT = "/api/v1/admin/members"
SAFE_FIELDS = {"id", "email", "first_name", "last_name", "role", "is_active", "created_at", "updated_at"}
NEW_PASSWORD = "a-new-member-password-for-tests"


@pytest.fixture
async def admin_headers(auth_client: AsyncClient, auth_session: AsyncSession, password_hash: str) -> dict[str, str]:
    auth_session.add(User(email="admin@example.com", first_name="Admin", last_name="User",
                          role=UserRole.ADMIN, hashed_password=password_hash))
    await auth_session.commit()
    response = await auth_client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def create(client: AsyncClient, headers: dict[str, str], email: str = "new@example.com") -> dict:
    response = await client.post(ROOT, headers=headers, json={
        "email": email, "first_name": "  Alice  ", "last_name": "Dupont",
    })
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


async def setup(client: AsyncClient, token: str):
    return await client.post("/api/v1/auth/setup-password", json={"token": token, "password": NEW_PASSWORD})


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "", None), ("POST", "", {}), ("GET", "/{id}", None),
    ("PATCH", "/{id}", {}), ("PATCH", "/{id}/status", {"is_active": False}),
    ("POST", "/{id}/activation", None),
])
async def test_every_admin_route_is_protected(auth_client, method, path, payload):
    path = ROOT + path.replace("{id}", str(uuid4()))
    assert (await auth_client.request(method, path, json=payload)).status_code == 401
    tokens = await auth_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {tokens.json()['access_token']}"}
    assert (await auth_client.request(method, path, json=payload, headers=headers)).status_code == 403


async def test_creation_and_complete_first_access(auth_client, auth_session, admin_headers, caplog):
    result = await create(auth_client, admin_headers, "  NEW@EXAMPLE.COM  ")
    member, token = result["member"], result["activation_token"]
    assert set(member) == SAFE_FIELDS
    assert member["role"] == "MEMBER" and member["is_active"] is True
    assert member["email"] == "new@example.com" and member["first_name"] == "Alice"
    user = await auth_session.get(User, UUID(member["id"]))
    assert user.activation_token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert not verify_password(NEW_PASSWORD, user.hashed_password)
    expires = user.activation_expires_at.replace(tzinfo=timezone.utc)
    assert 0 < (expires - datetime.now(timezone.utc)).total_seconds() <= 1800
    assert (await auth_client.post("/api/v1/auth/login", json={"email": user.email, "password": NEW_PASSWORD})).status_code == 401
    assert (await setup(auth_client, token)).status_code == 204
    await auth_session.refresh(user)
    assert user.activation_token_hash is None and user.activation_expires_at is None
    assert verify_password(NEW_PASSWORD, user.hashed_password)
    assert (await setup(auth_client, token)).status_code == 400
    await auth_session.refresh(user)
    login = await auth_client.post("/api/v1/auth/login", json={"email": user.email, "password": NEW_PASSWORD})
    assert login.status_code == 200
    response = await auth_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login.json()['access_token']}"})
    assert set(response.json()) == SAFE_FIELDS
    assert token not in caplog.text and NEW_PASSWORD not in caplog.text
    assert user.hashed_password not in caplog.text


@pytest.mark.parametrize("extra", [{"role": "ADMIN"}, {"is_active": False}, {"hashed_password": "secret"},
                                   {"activation_token_hash": "secret"}, {"created_at": "2020-01-01"}])
async def test_creation_forbids_security_fields(auth_client, admin_headers, extra):
    response = await auth_client.post(ROOT, headers=admin_headers, json={
        "email": "new@example.com", "first_name": "A", "last_name": "B", **extra,
    })
    assert response.status_code == 422


@pytest.mark.parametrize("changes", [{"email": "invalid"}, {"first_name": "  "}, {"last_name": "x" * 101}])
async def test_creation_validation(auth_client, admin_headers, changes):
    response = await auth_client.post(ROOT, headers=admin_headers, json={
        "email": "new@example.com", "first_name": "A", "last_name": "B", **changes,
    })
    assert response.status_code == 422


async def test_duplicate_email_including_admin(auth_client, admin_headers):
    for email in (EMAIL.upper(), "ADMIN@EXAMPLE.COM"):
        response = await auth_client.post(ROOT, headers=admin_headers, json={
            "email": email, "first_name": "A", "last_name": "B",
        })
        assert response.status_code == 409


async def test_listing_pagination_search_and_status(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    first = (await auth_client.get(ROOT, headers=admin_headers, params={"page_size": 1})).json()
    second = (await auth_client.get(ROOT, headers=admin_headers, params={"page_size": 1, "page": 2})).json()
    assert first["total"] == second["total"] == 2  # Administrators are excluded.
    assert first["page"] == 1 and second["page"] == 2 and first["page_size"] == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert set(first["items"][0]) == SAFE_FIELDS
    for search in ("NEW@", "aliCE", "duPONT"):
        result = (await auth_client.get(ROOT, headers=admin_headers, params={"search": search})).json()
        assert result["total"] == 1 and result["items"][0]["id"] == created["member"]["id"]
    for search in ("%", "_", "absent"):
        assert (await auth_client.get(ROOT, headers=admin_headers, params={"search": search})).json()["total"] == 0
    await auth_client.patch(f"{ROOT}/{created['member']['id']}/status", headers=admin_headers, json={"is_active": False})
    for active in (True, False):
        result = (await auth_client.get(ROOT, headers=admin_headers, params={"is_active": str(active).lower()})).json()
        assert result["total"] == 1 and result["items"][0]["is_active"] is active
    assert (await auth_client.get(ROOT, headers=admin_headers, params={"page": 50})).json()["items"] == []


@pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"search": "x" * 321}])
async def test_pagination_bounds(auth_client, admin_headers, params):
    assert (await auth_client.get(ROOT, headers=admin_headers, params=params)).status_code == 422


async def test_retrieval_and_profile_update(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    path = f"{ROOT}/{created['member']['id']}"
    assert (await auth_client.get(path, headers=admin_headers)).json() == created["member"]
    updated = await auth_client.patch(path, headers=admin_headers, json={
        "first_name": "Bob", "last_name": "Jones", "email": "NEWER@EXAMPLE.COM",
    })
    assert updated.status_code == 200
    assert set(updated.json()) == SAFE_FIELDS
    assert updated.json()["email"] == "newer@example.com"
    assert updated.json()["first_name"] == "Bob" and updated.json()["last_name"] == "Jones"
    assert (await setup(auth_client, created["activation_token"])).status_code == 400
    replacement = await auth_client.post(path + "/activation", headers=admin_headers)
    assert replacement.status_code == 200
    assert (await setup(auth_client, replacement.json()["activation_token"])).status_code == 204
    response = await auth_client.patch(path, headers=admin_headers, json={"email": EMAIL})
    assert response.status_code == 409


@pytest.mark.parametrize("payload", [{}, {"email": None}, {"first_name": None}, {"role": "ADMIN"},
                                     {"hashed_password": "secret"}, {"is_active": False},
                                     {"updated_at": "2020-01-01"}, {"security_tokens": "secret"}])
async def test_profile_rejects_forbidden_or_empty_updates(auth_client, admin_headers, payload):
    created = await create(auth_client, admin_headers)
    assert (await auth_client.patch(f"{ROOT}/{created['member']['id']}", headers=admin_headers, json=payload)).status_code == 422


@pytest.mark.parametrize("identifier,expected", [(str(uuid4()), 404), ("invalid", 422)])
async def test_invalid_or_missing_member(auth_client, admin_headers, identifier, expected):
    path = f"{ROOT}/{identifier}"
    assert (await auth_client.get(path, headers=admin_headers)).status_code == expected
    assert (await auth_client.patch(path, headers=admin_headers, json={"first_name": "New"})).status_code == expected
    assert (await auth_client.patch(path + "/status", headers=admin_headers, json={"is_active": False})).status_code == expected


async def test_status_is_idempotent_and_blocks_existing_access(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    await setup(auth_client, created["activation_token"])
    login = await auth_client.post("/api/v1/auth/login", json={"email": "new@example.com", "password": NEW_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    path = f"{ROOT}/{created['member']['id']}/status"
    for active in (False, True):
        one = await auth_client.patch(path, headers=admin_headers, json={"is_active": active})
        two = await auth_client.patch(path, headers=admin_headers, json={"is_active": active})
        assert one.status_code == two.status_code == 200 and one.json() == two.json()
        expected = 200 if active else 401
        assert (await auth_client.get("/api/v1/auth/me", headers=headers)).status_code == expected
        assert (await auth_client.post("/api/v1/auth/login", json={"email": "new@example.com", "password": NEW_PASSWORD})).status_code == expected


async def test_last_admin_and_inactive_admin(auth_client, auth_session, admin_headers, password_hash):
    admin = await auth_session.scalar(select(User).where(User.role == UserRole.ADMIN))
    path = f"{ROOT}/{admin.id}/status"
    blocked = await auth_client.patch(path, headers=admin_headers, json={"is_active": False})
    assert blocked.status_code == 409 and "last active administrator" in blocked.text
    admin = await auth_session.scalar(select(User).where(User.role == UserRole.ADMIN))
    assert admin.is_active
    auth_session.add(User(email="second-admin@example.com", first_name="Second", last_name="Admin",
                          role=UserRole.ADMIN, hashed_password=password_hash))
    await auth_session.commit()
    assert (await auth_client.patch(path, headers=admin_headers, json={"is_active": False})).status_code == 200
    assert (await auth_client.get(ROOT, headers=admin_headers)).status_code == 401
    assert (await auth_client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": PASSWORD})).status_code == 401


@pytest.mark.parametrize("state", ["expired", "inactive", "invalid"])
async def test_invalid_activation_states(auth_client, auth_session, admin_headers, state):
    created = await create(auth_client, admin_headers)
    user = await auth_session.get(User, UUID(created["member"]["id"]))
    token = created["activation_token"]
    if state == "expired":
        user.activation_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif state == "inactive":
        user.is_active = False
    else:
        token = "z" * 43
    await auth_session.commit()
    response = await setup(auth_client, token)
    assert response.status_code == 400 and token not in response.text


async def test_reissue_and_no_password_reset(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    path = f"{ROOT}/{created['member']['id']}/activation"
    reissued = await auth_client.post(path, headers=admin_headers)
    assert reissued.status_code == 200
    assert (await setup(auth_client, created["activation_token"])).status_code == 400
    assert (await setup(auth_client, reissued.json()["activation_token"])).status_code == 204
    assert (await auth_client.post(path, headers=admin_headers)).status_code == 409


@pytest.mark.parametrize("environment", ["production", "staging"])
async def test_development_token_exposure_is_disabled(auth_client, application, admin_headers, environment):
    application.state.settings = application.state.settings.model_copy(update={"environment": environment})
    payload = {"email": "new@example.com", "first_name": "A", "last_name": "B"}
    response = await auth_client.post(ROOT, headers=admin_headers, json=payload)
    assert response.status_code == 503 and "activation_token" not in response.text
    delivered = []

    class Delivery:
        async def send(self, email, token, expires_at):
            delivered.append((email, token, expires_at))

    application.state.activation_delivery = Delivery()
    response = await auth_client.post(ROOT, headers=admin_headers, json=payload)
    assert response.status_code == 201 and set(response.json()) == {"member"}
    assert len(delivered) == 1 and delivered[0][0] == payload["email"]
    assert (await setup(auth_client, delivered[0][1].get_secret_value())).status_code == 204


async def test_validation_never_echoes_credentials(auth_client, caplog):
    token, password = "secret-token", "short-secret"
    response = await auth_client.post("/api/v1/auth/setup-password", json={"token": token, "password": password})
    assert response.status_code == 422
    assert all(secret not in response.text and secret not in caplog.text for secret in (token, password))


async def test_no_public_registration_or_deletion(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    assert (await auth_client.delete(f"{ROOT}/{created['member']['id']}", headers=admin_headers)).status_code == 405
    assert (await auth_client.post("/api/v1/auth/register", json={})).status_code == 404


async def test_database_duplicate_race_rolls_back(auth_client, admin_headers, monkeypatch):
    from app.repositories.member_repository import MemberRepository

    async def miss_precheck(self, email):
        return None

    # Simulate a concurrent insert between the precheck and the unique constraint.
    monkeypatch.setattr(MemberRepository, "get_by_email", miss_precheck)
    response = await auth_client.post(ROOT, headers=admin_headers, json={
        "email": EMAIL, "first_name": "New", "last_name": "Member",
    })
    assert response.status_code == 409
    assert "INSERT" not in response.text and "IntegrityError" not in response.text
    assert (await auth_client.get(ROOT, headers=admin_headers)).status_code == 200


async def test_storage_error_is_safe(auth_client, admin_headers, monkeypatch, caplog):
    from sqlalchemy.exc import OperationalError
    from app.repositories.member_repository import MemberRepository

    async def unavailable(self, email):
        raise OperationalError("private-sql", {"token": "private-token"}, Exception("private-password"))

    monkeypatch.setattr(MemberRepository, "get_by_email", unavailable)
    response = await auth_client.post(ROOT, headers=admin_headers, json={
        "email": "new@example.com", "first_name": "New", "last_name": "Member",
    })
    assert response.status_code == 503
    for secret in ("private-sql", "private-token", "private-password"):
        assert secret not in response.text and secret not in caplog.text


async def test_delivery_failure_does_not_leak_and_can_be_retried(auth_client, application, admin_headers, caplog):
    delivered = []

    class FailingDelivery:
        async def send(self, email, token, expires_at):
            delivered.append(token.get_secret_value())
            raise RuntimeError(token.get_secret_value())

    application.state.activation_delivery = FailingDelivery()
    response = await auth_client.post(ROOT, headers=admin_headers, json={
        "email": "new@example.com", "first_name": "New", "last_name": "Member",
    })
    assert response.status_code == 503
    assert delivered[0] not in response.text and delivered[0] not in caplog.text
    member = (await auth_client.get(ROOT, headers=admin_headers, params={"search": "new@"})).json()["items"][0]
    application.state.activation_delivery = None
    retried = await auth_client.post(f"{ROOT}/{member['id']}/activation", headers=admin_headers)
    assert retried.status_code == 200
    assert (await setup(auth_client, delivered[0])).status_code == 400
    assert (await setup(auth_client, retried.json()["activation_token"])).status_code == 204


async def test_admin_profile_is_outside_member_management(auth_client, auth_session, admin_headers):
    admin = await auth_session.scalar(select(User).where(User.role == UserRole.ADMIN))
    path = f"{ROOT}/{admin.id}"
    assert (await auth_client.get(path, headers=admin_headers)).status_code == 404
    assert (await auth_client.patch(path, headers=admin_headers, json={"email": "changed@example.com"})).status_code == 404
    assert (await auth_client.post(path + "/activation", headers=admin_headers)).status_code == 404


async def test_openapi_documents_member_contracts(auth_client):
    schema = (await auth_client.get("/api/v1/openapi.json")).json()
    for path, methods in schema["paths"].items():
        if path.startswith(ROOT):
            for operation in methods.values():
                assert operation["security"] == [{"HTTPBearer": []}]
                assert {"401", "403", "409", "422"} <= operation["responses"].keys()
    assert set(schema["components"]["schemas"]["MemberResponse"]["properties"]) == SAFE_FIELDS
    assert schema["components"]["schemas"]["MemberCreate"]["additionalProperties"] is False
    assert "security" not in schema["paths"]["/api/v1/auth/setup-password"]["post"]
