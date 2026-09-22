"""Member lifecycle through the existing async database/client test architecture.

Since MEMBERS-01 an administrator creates a member *with an initial password*:
the account is active and can sign in at once, with no invitation. The former
invitation flow (activation token -> /auth/setup-password, reissue) is kept for
accounts opened before that change, and is still exercised here through the
``pending_member`` fixture, which inserts such an account directly.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.models.user import User, UserRole
from app.services.member_service import PENDING_PASSWORD
# Reuse the authentication suite's real SQLAlchemy and application fixtures.
from app.tests.test_auth import EMAIL, PASSWORD, auth_client, auth_session, password_hash

pytestmark = pytest.mark.anyio
ROOT = "/api/v1/admin/members"
SAFE_FIELDS = {"id", "email", "first_name", "last_name", "role", "is_active", "created_at", "updated_at"}
NEW_PASSWORD = "a-new-member-password-for-tests"
INITIAL_PASSWORD = "initial-password-set-by-admin"


@pytest.fixture
async def admin_headers(auth_client: AsyncClient, auth_session: AsyncSession, password_hash: str) -> dict[str, str]:
    auth_session.add(User(email="admin@example.com", first_name="Admin", last_name="User",
                          role=UserRole.ADMIN, hashed_password=password_hash))
    await auth_session.commit()
    response = await auth_client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def body(**changes) -> dict:
    """A valid creation request; each test overrides only what it is about."""
    return {"email": "new@example.com", "first_name": "A", "last_name": "B",
            "password": INITIAL_PASSWORD, **changes}


async def create(client: AsyncClient, headers: dict[str, str], email: str = "new@example.com") -> dict:
    response = await client.post(ROOT, headers=headers, json={
        "email": email, "first_name": "  Alice  ", "last_name": "Dupont", "password": INITIAL_PASSWORD,
    })
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


async def login(client: AsyncClient, email: str, password: str):
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def setup(client: AsyncClient, token: str):
    return await client.post("/api/v1/auth/setup-password", json={"token": token, "password": NEW_PASSWORD})


@pytest.fixture
async def pending_member(auth_session: AsyncSession) -> tuple[dict, str]:
    """An account opened under the former invitation flow, awaiting its password.

    New accounts can no longer be created in this state; this is how one looks
    if it was created before MEMBERS-01, so the legacy path stays covered.
    """
    token = secrets.token_urlsafe(32)
    user = User(email="pending@example.com", first_name="Pending", last_name="Member",
                role=UserRole.MEMBER, is_active=True, hashed_password=PENDING_PASSWORD,
                activation_token_hash=hashlib.sha256(token.encode()).hexdigest(),
                activation_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30))
    auth_session.add(user)
    await auth_session.commit()
    await auth_session.refresh(user)
    return {"id": str(user.id), "email": user.email}, token


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


async def test_a_member_cannot_create_an_account(auth_client, auth_session):
    """The creation endpoint refuses a MEMBER even with a complete, valid body."""
    tokens = await login(auth_client, EMAIL, PASSWORD)
    headers = {"Authorization": f"Bearer {tokens.json()['access_token']}"}
    assert (await auth_client.post(ROOT, headers=headers, json=body())).status_code == 403
    assert await auth_session.scalar(select(User).where(User.email == "new@example.com")) is None


# ------------------------------------------------------------------ creation

async def test_creation_opens_an_account_that_can_sign_in_at_once(
    auth_client, auth_session, admin_headers, caplog,
):
    """The acceptance test: create, then log in with exactly those credentials."""
    member = await create(auth_client, admin_headers, "  NEW@EXAMPLE.COM  ")

    # The response is the member itself - no token, no password, nothing internal.
    assert set(member) == SAFE_FIELDS
    assert member["role"] == "MEMBER" and member["is_active"] is True
    assert member["email"] == "new@example.com" and member["first_name"] == "Alice"
    assert member["last_name"] == "Dupont"

    user = await auth_session.get(User, UUID(member["id"]))
    # Stored hashed with the platform's own Argon2id, never in clear.
    assert user.hashed_password.startswith("$argon2id$")
    assert user.hashed_password != INITIAL_PASSWORD
    assert verify_password(INITIAL_PASSWORD, user.hashed_password)
    # Nothing to activate: no invitation was issued.
    assert user.activation_token_hash is None and user.activation_expires_at is None

    signed_in = await login(auth_client, "new@example.com", INITIAL_PASSWORD)
    assert signed_in.status_code == 200
    me = await auth_client.get("/api/v1/auth/me",
                               headers={"Authorization": f"Bearer {signed_in.json()['access_token']}"})
    assert me.status_code == 200
    assert me.json()["role"] == "MEMBER" and me.json()["id"] == member["id"]
    assert set(me.json()) == SAFE_FIELDS

    assert (await login(auth_client, "new@example.com", "a-wrong-password-entirely")).status_code == 401
    assert INITIAL_PASSWORD not in caplog.text and user.hashed_password not in caplog.text


async def test_the_initial_password_never_leaves_the_server(auth_client, admin_headers):
    response = await auth_client.post(ROOT, headers=admin_headers, json=body())

    assert response.status_code == 201
    assert INITIAL_PASSWORD not in response.text
    assert "password" not in response.text
    assert "activation" not in response.text


@pytest.mark.parametrize("extra", [{"role": "ADMIN"}, {"role": "MEMBER"}, {"is_active": False},
                                   {"is_active": True}, {"hashed_password": "secret"},
                                   {"activation_token_hash": "secret"}, {"activation_token": "secret"},
                                   {"is_admin": True}, {"created_at": "2020-01-01"}])
async def test_creation_forbids_security_fields(auth_client, admin_headers, auth_session, extra):
    """Role, status and activation are the server's: a client cannot send them.

    Even `role: MEMBER` is refused - the field does not exist on the request,
    so there is no value a client could supply to steer it.
    """
    response = await auth_client.post(ROOT, headers=admin_headers, json=body(**extra))
    assert response.status_code == 422
    assert await auth_session.scalar(select(User).where(User.email == "new@example.com")) is None


async def test_no_request_can_create_an_administrator(auth_client, admin_headers, auth_session):
    """Every account this endpoint opens is a MEMBER, whatever is attempted."""
    for attempt in ({"role": "ADMIN"}, {"role": "admin"}, {"roles": ["ADMIN"]}):
        response = await auth_client.post(ROOT, headers=admin_headers, json=body(**attempt))
        assert response.status_code == 422, attempt
    created = await auth_client.post(ROOT, headers=admin_headers, json=body())
    assert created.json()["role"] == "MEMBER"
    admins = (await auth_session.scalars(select(User).where(User.role == UserRole.ADMIN))).all()
    assert [admin.email for admin in admins] == ["admin@example.com"]


@pytest.mark.parametrize("changes", [
    {"email": "invalid"}, {"email": ""}, {"first_name": "  "}, {"first_name": ""},
    {"last_name": "x" * 101}, {"last_name": "   "},
    {"password": ""}, {"password": "x" * 11}, {"password": "x" * 1025},
])
async def test_creation_validation(auth_client, admin_headers, changes):
    response = await auth_client.post(ROOT, headers=admin_headers, json=body(**changes))
    assert response.status_code == 422


@pytest.mark.parametrize("missing", ["email", "first_name", "last_name", "password"])
async def test_every_creation_field_is_required(auth_client, admin_headers, missing):
    payload = body()
    del payload[missing]
    assert (await auth_client.post(ROOT, headers=admin_headers, json=payload)).status_code == 422


async def test_the_password_policy_is_the_platforms_own(auth_client, admin_headers):
    """Twelve characters, the same minimum /auth/setup-password has always used."""
    assert (await auth_client.post(ROOT, headers=admin_headers,
                                   json=body(password="x" * 11))).status_code == 422
    accepted = await auth_client.post(ROOT, headers=admin_headers, json=body(password="x" * 12))
    assert accepted.status_code == 201
    assert (await login(auth_client, "new@example.com", "x" * 12)).status_code == 200


async def test_a_rejected_password_is_never_echoed(auth_client, admin_headers, caplog):
    short = "tooShort-11"
    response = await auth_client.post(ROOT, headers=admin_headers, json=body(password=short))
    assert response.status_code == 422
    assert short not in response.text and short not in caplog.text


async def test_duplicate_email_including_admin(auth_client, admin_headers):
    for email in (EMAIL.upper(), "ADMIN@EXAMPLE.COM"):
        response = await auth_client.post(ROOT, headers=admin_headers, json=body(email=email))
        assert response.status_code == 409
        assert INITIAL_PASSWORD not in response.text


async def test_creation_needs_no_delivery_outside_development(auth_client, application, admin_headers):
    """Before MEMBERS-01 creation failed with 503 here, for want of an email
    provider. It now needs none: the account is complete when it is created."""
    for environment in ("production", "staging"):
        application.state.settings = application.state.settings.model_copy(update={"environment": environment})
        email = f"{environment}@example.com"
        response = await auth_client.post(ROOT, headers=admin_headers, json=body(email=email))
        assert response.status_code == 201
        assert "activation_token" not in response.text
        assert (await login(auth_client, email, INITIAL_PASSWORD)).status_code == 200


async def test_creation_never_calls_a_delivery_provider(auth_client, application, admin_headers):
    """No invitation is sent, even when a provider is configured."""
    called = []

    class Delivery:
        async def send(self, email, token, expires_at):
            called.append(email)

    application.state.activation_delivery = Delivery()
    assert (await auth_client.post(ROOT, headers=admin_headers, json=body())).status_code == 201
    assert called == []


# --------------------------------------------------------- listing & update

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
        assert result["total"] == 1 and result["items"][0]["id"] == created["id"]
    for search in ("%", "_", "absent"):
        assert (await auth_client.get(ROOT, headers=admin_headers, params={"search": search})).json()["total"] == 0
    await auth_client.patch(f"{ROOT}/{created['id']}/status", headers=admin_headers, json={"is_active": False})
    for active in (True, False):
        result = (await auth_client.get(ROOT, headers=admin_headers, params={"is_active": str(active).lower()})).json()
        assert result["total"] == 1 and result["items"][0]["is_active"] is active
    assert (await auth_client.get(ROOT, headers=admin_headers, params={"page": 50})).json()["items"] == []


@pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 0}, {"page_size": 101}, {"search": "x" * 321}])
async def test_pagination_bounds(auth_client, admin_headers, params):
    assert (await auth_client.get(ROOT, headers=admin_headers, params=params)).status_code == 422


async def test_retrieval_and_profile_update(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    path = f"{ROOT}/{created['id']}"
    assert (await auth_client.get(path, headers=admin_headers)).json() == created
    updated = await auth_client.patch(path, headers=admin_headers, json={
        "first_name": "Bob", "last_name": "Jones", "email": "NEWER@EXAMPLE.COM",
    })
    assert updated.status_code == 200
    assert set(updated.json()) == SAFE_FIELDS
    assert updated.json()["email"] == "newer@example.com"
    assert updated.json()["first_name"] == "Bob" and updated.json()["last_name"] == "Jones"
    # The initial password still signs in under the new address.
    assert (await login(auth_client, "newer@example.com", INITIAL_PASSWORD)).status_code == 200
    response = await auth_client.patch(path, headers=admin_headers, json={"email": EMAIL})
    assert response.status_code == 409


@pytest.mark.parametrize("payload", [{}, {"email": None}, {"first_name": None}, {"role": "ADMIN"},
                                     {"hashed_password": "secret"}, {"is_active": False},
                                     {"updated_at": "2020-01-01"}, {"security_tokens": "secret"},
                                     {"password": "a-new-password-attempt"}])
async def test_profile_rejects_forbidden_or_empty_updates(auth_client, admin_headers, payload):
    created = await create(auth_client, admin_headers)
    assert (await auth_client.patch(f"{ROOT}/{created['id']}", headers=admin_headers, json=payload)).status_code == 422


@pytest.mark.parametrize("identifier,expected", [(str(uuid4()), 404), ("invalid", 422)])
async def test_invalid_or_missing_member(auth_client, admin_headers, identifier, expected):
    path = f"{ROOT}/{identifier}"
    assert (await auth_client.get(path, headers=admin_headers)).status_code == expected
    assert (await auth_client.patch(path, headers=admin_headers, json={"first_name": "New"})).status_code == expected
    assert (await auth_client.patch(path + "/status", headers=admin_headers, json={"is_active": False})).status_code == expected


async def test_status_is_idempotent_and_blocks_existing_access(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    signed_in = await login(auth_client, "new@example.com", INITIAL_PASSWORD)
    headers = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
    path = f"{ROOT}/{created['id']}/status"
    for active in (False, True):
        one = await auth_client.patch(path, headers=admin_headers, json={"is_active": active})
        two = await auth_client.patch(path, headers=admin_headers, json={"is_active": active})
        assert one.status_code == two.status_code == 200 and one.json() == two.json()
        expected = 200 if active else 401
        assert (await auth_client.get("/api/v1/auth/me", headers=headers)).status_code == expected
        assert (await login(auth_client, "new@example.com", INITIAL_PASSWORD)).status_code == expected


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


# --------------------------------------------- legacy invitation accounts

async def test_legacy_invitation_still_completes_first_access(
    auth_client, auth_session, pending_member, caplog,
):
    """The former flow, preserved for accounts opened before MEMBERS-01."""
    member, token = pending_member
    email = member["email"]
    user = await auth_session.get(User, UUID(member["id"]))
    assert not verify_password(NEW_PASSWORD, user.hashed_password)
    assert (await login(auth_client, email, NEW_PASSWORD)).status_code == 401
    assert (await setup(auth_client, token)).status_code == 204
    await auth_session.refresh(user)
    assert user.activation_token_hash is None and user.activation_expires_at is None
    assert verify_password(NEW_PASSWORD, user.hashed_password)
    stored_hash = user.hashed_password
    assert (await setup(auth_client, token)).status_code == 400
    signed_in = await login(auth_client, email, NEW_PASSWORD)
    assert signed_in.status_code == 200
    response = await auth_client.get("/api/v1/auth/me",
                                     headers={"Authorization": f"Bearer {signed_in.json()['access_token']}"})
    assert set(response.json()) == SAFE_FIELDS
    assert token not in caplog.text and NEW_PASSWORD not in caplog.text
    assert stored_hash not in caplog.text


async def test_legacy_email_change_voids_the_old_invitation(auth_client, admin_headers, pending_member):
    member, token = pending_member
    path = f"{ROOT}/{member['id']}"
    assert (await auth_client.patch(path, headers=admin_headers,
                                    json={"email": "moved@example.com"})).status_code == 200
    assert (await setup(auth_client, token)).status_code == 400
    replacement = await auth_client.post(path + "/activation", headers=admin_headers)
    assert replacement.status_code == 200
    assert (await setup(auth_client, replacement.json()["activation_token"])).status_code == 204


@pytest.mark.parametrize("state", ["expired", "inactive", "invalid"])
async def test_invalid_activation_states(auth_client, auth_session, pending_member, state):
    member, token = pending_member
    user = await auth_session.get(User, UUID(member["id"]))
    if state == "expired":
        user.activation_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif state == "inactive":
        user.is_active = False
    else:
        token = "z" * 43
    await auth_session.commit()
    response = await setup(auth_client, token)
    assert response.status_code == 400 and token not in response.text


async def test_reissue_and_no_password_reset(auth_client, auth_session, admin_headers, pending_member):
    member, token = pending_member
    path = f"{ROOT}/{member['id']}/activation"
    reissued = await auth_client.post(path, headers=admin_headers)
    assert reissued.status_code == 200
    user = await auth_session.get(User, UUID(member["id"]))
    await auth_session.refresh(user)
    expires = user.activation_expires_at.replace(tzinfo=timezone.utc)
    assert 0 < (expires - datetime.now(timezone.utc)).total_seconds() <= 1800
    assert (await setup(auth_client, token)).status_code == 400
    assert (await setup(auth_client, reissued.json()["activation_token"])).status_code == 204
    assert (await auth_client.post(path, headers=admin_headers)).status_code == 409


async def test_reissue_cannot_replace_an_initial_password(auth_client, admin_headers):
    """An account created with a password never waits for one: nothing to reissue."""
    created = await create(auth_client, admin_headers)
    response = await auth_client.post(f"{ROOT}/{created['id']}/activation", headers=admin_headers)
    assert response.status_code == 409
    assert "activation_token" not in response.text
    assert (await login(auth_client, "new@example.com", INITIAL_PASSWORD)).status_code == 200


@pytest.mark.parametrize("environment", ["production", "staging"])
async def test_legacy_token_exposure_is_disabled(auth_client, application, admin_headers,
                                                 pending_member, environment):
    member, _token = pending_member
    application.state.settings = application.state.settings.model_copy(update={"environment": environment})
    path = f"{ROOT}/{member['id']}/activation"
    response = await auth_client.post(path, headers=admin_headers)
    assert response.status_code == 503 and "activation_token" not in response.text
    delivered = []

    class Delivery:
        async def send(self, email, token, expires_at):
            delivered.append((email, token, expires_at))

    application.state.activation_delivery = Delivery()
    response = await auth_client.post(path, headers=admin_headers)
    assert response.status_code == 200 and set(response.json()) == {"member"}
    assert len(delivered) == 1 and delivered[0][0] == member["email"]
    assert (await setup(auth_client, delivered[0][1].get_secret_value())).status_code == 204


async def test_delivery_failure_does_not_leak_and_can_be_retried(
    auth_client, application, admin_headers, pending_member, caplog,
):
    member, _token = pending_member
    delivered = []

    class FailingDelivery:
        async def send(self, email, token, expires_at):
            delivered.append(token.get_secret_value())
            raise RuntimeError(token.get_secret_value())

    application.state.activation_delivery = FailingDelivery()
    path = f"{ROOT}/{member['id']}/activation"
    response = await auth_client.post(path, headers=admin_headers)
    assert response.status_code == 503
    assert delivered[0] not in response.text and delivered[0] not in caplog.text
    application.state.activation_delivery = None
    retried = await auth_client.post(path, headers=admin_headers)
    assert retried.status_code == 200
    assert (await setup(auth_client, delivered[0])).status_code == 400
    assert (await setup(auth_client, retried.json()["activation_token"])).status_code == 204


# ------------------------------------------------------------ robustness

async def test_validation_never_echoes_credentials(auth_client, caplog):
    token, password = "secret-token", "short-secret"
    response = await auth_client.post("/api/v1/auth/setup-password", json={"token": token, "password": password})
    assert response.status_code == 422
    assert all(secret not in response.text and secret not in caplog.text for secret in (token, password))


async def test_no_public_registration_or_deletion(auth_client, admin_headers):
    created = await create(auth_client, admin_headers)
    assert (await auth_client.delete(f"{ROOT}/{created['id']}", headers=admin_headers)).status_code == 405
    assert (await auth_client.post("/api/v1/auth/register", json={})).status_code == 404


async def test_database_duplicate_race_rolls_back(auth_client, admin_headers, monkeypatch):
    from app.repositories.member_repository import MemberRepository

    async def miss_precheck(self, email):
        return None

    # Simulate a concurrent insert between the precheck and the unique constraint.
    monkeypatch.setattr(MemberRepository, "get_by_email", miss_precheck)
    response = await auth_client.post(ROOT, headers=admin_headers, json=body(email=EMAIL))
    assert response.status_code == 409
    assert "INSERT" not in response.text and "IntegrityError" not in response.text
    assert INITIAL_PASSWORD not in response.text
    assert (await auth_client.get(ROOT, headers=admin_headers)).status_code == 200


async def test_storage_error_is_safe(auth_client, admin_headers, monkeypatch, caplog):
    from sqlalchemy.exc import OperationalError
    from app.repositories.member_repository import MemberRepository

    async def unavailable(self, email):
        raise OperationalError("private-sql", {"token": "private-token"}, Exception("private-password"))

    monkeypatch.setattr(MemberRepository, "get_by_email", unavailable)
    response = await auth_client.post(ROOT, headers=admin_headers, json=body())
    assert response.status_code == 503
    for secret in ("private-sql", "private-token", "private-password", INITIAL_PASSWORD):
        assert secret not in response.text and secret not in caplog.text


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
    create_schema = schema["components"]["schemas"]["MemberCreate"]
    assert create_schema["additionalProperties"] is False
    assert set(create_schema["properties"]) == {"email", "first_name", "last_name", "password"}
    assert create_schema["properties"]["password"]["minLength"] == 12
    created = schema["paths"][ROOT]["post"]["responses"]["201"]["content"]["application/json"]["schema"]
    assert created["$ref"].endswith("/MemberResponse")
    assert "security" not in schema["paths"]["/api/v1/auth/setup-password"]["post"]
