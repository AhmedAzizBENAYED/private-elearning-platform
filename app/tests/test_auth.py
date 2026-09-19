"""Authentication through real async SQLAlchemy queries on an isolated test DB."""

from collections.abc import AsyncIterator
from datetime import datetime, timezone
from uuid import uuid4

import jwt
import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.dependencies import require_role
from app.core.security import hash_password, verify_password
from app.database.base import Base
from app.database.session import get_db_session
from app.models.user import User, UserRole
from app.models import load_models

PASSWORD = "test-password-with-enough-entropy"
EMAIL = "member@example.com"


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
async def auth_session(password_hash: str) -> AsyncIterator[AsyncSession]:
    load_models()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            session.add(User(email=EMAIL, hashed_password=password_hash,
                             first_name="Test", last_name="Member"))
            await session.commit()
            yield session
    finally:
        await engine.dispose()


@pytest.fixture
async def auth_client(application: FastAPI, auth_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def override_session() -> AsyncIterator[AsyncSession]:
        yield auth_session

    application.dependency_overrides[get_db_session] = override_session

    @application.get("/test/admin", dependencies=[Depends(require_role(UserRole.ADMIN))])
    async def admin_only() -> dict[str, bool]:
        return {"allowed": True}

    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=ASGITransport(app=application), base_url="http://test") as client:
            yield client
    application.dependency_overrides.clear()


async def login(client: AsyncClient) -> dict[str, str]:
    response = await client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert response.status_code == 200
    return response.json()


def test_password_hashing(password_hash: str) -> None:
    assert password_hash.startswith("$argon2id$")
    assert PASSWORD not in password_hash
    assert hash_password(PASSWORD) != password_hash
    assert verify_password(PASSWORD, password_hash)
    assert not verify_password("incorrect", password_hash)
    assert not verify_password(PASSWORD, "broken-hash")


@pytest.mark.anyio
async def test_login_success_and_me(auth_client: AsyncClient, settings: Settings) -> None:
    response = await auth_client.post("/api/v1/auth/login", json={
        "email": "  MEMBER@EXAMPLE.COM  ", "password": PASSWORD,
    })
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    tokens = response.json()
    assert set(tokens) == {"access_token", "refresh_token", "token_type"}
    assert tokens["token_type"] == "bearer"
    claims = [jwt.decode(tokens[key], settings.jwt_secret_key.get_secret_value(),
                         algorithms=[settings.jwt_algorithm])
              for key in ("access_token", "refresh_token")]
    access, refresh = claims
    assert access["token_type"] == "access"
    assert refresh["token_type"] == "refresh"
    assert access["role"] == "MEMBER"
    assert access["sub"] == refresh["sub"]
    assert access["jti"] != refresh["jti"]
    assert access["exp"] - access["iat"] == settings.access_token_expire_minutes * 60
    assert refresh["exp"] - refresh["iat"] == settings.refresh_token_expire_days * 86400
    me = await auth_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL
    assert set(me.json()) == {"id", "email", "first_name", "last_name", "is_active", "role", "created_at", "updated_at"}


@pytest.mark.anyio
@pytest.mark.parametrize("email,password", [(EMAIL, "incorrect"), ("missing@example.com", PASSWORD)])
async def test_login_failure(auth_client: AsyncClient, email: str, password: str) -> None:
    response = await auth_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.anyio
@pytest.mark.parametrize("authorization", [None, "Basic abc", "Bearer not-a-jwt"])
async def test_invalid_token(auth_client: AsyncClient, authorization: str | None) -> None:
    headers = {"Authorization": authorization} if authorization else {}
    response = await auth_client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.anyio
@pytest.mark.parametrize("case", ["expired", "future", "missing_exp", "bad_uuid", "unknown_user",
                                  "bad_role", "bad_type", "wrong_key", "wrong_algorithm", "refresh"])
async def test_rejects_invalid_claims(auth_client: AsyncClient, settings: Settings, case: str) -> None:
    tokens = await login(auth_client)
    key = settings.jwt_secret_key.get_secret_value()
    claims = jwt.decode(tokens["access_token"], key, algorithms=[settings.jwt_algorithm])
    now = int(datetime.now(timezone.utc).timestamp())
    algorithm = settings.jwt_algorithm
    if case == "expired":
        claims["exp"] = now - 1
    elif case == "future":
        claims["nbf"] = now + 3600
    elif case == "missing_exp":
        del claims["exp"]
    elif case == "bad_uuid":
        claims["sub"] = "invalid-uuid"
    elif case == "unknown_user":
        claims["sub"] = str(uuid4())
    elif case == "bad_role":
        claims["role"] = "ROOT"
    elif case == "bad_type":
        claims["token_type"] = "other"
    elif case == "wrong_key":
        key = "different-test-signing-key-" * 4
    elif case == "wrong_algorithm":
        algorithm = "HS512"
    token = tokens["refresh_token"] if case == "refresh" else jwt.encode(claims, key, algorithm=algorithm)
    response = await auth_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


@pytest.mark.anyio
async def test_inactive_user_cannot_login_or_use_existing_token(auth_client: AsyncClient, auth_session: AsyncSession) -> None:
    tokens = await login(auth_client)
    await auth_session.execute(update(User).values(is_active=False))
    await auth_session.commit()
    response = await auth_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}
    me = await auth_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 401


@pytest.mark.anyio
async def test_roles_follow_database_not_stale_token(auth_client: AsyncClient, auth_session: AsyncSession) -> None:
    tokens = await login(auth_client)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert (await auth_client.get("/test/admin", headers=headers)).status_code == 403
    await auth_session.execute(update(User).values(role=UserRole.ADMIN))
    await auth_session.commit()
    assert (await auth_client.get("/test/admin", headers=headers)).status_code == 200
    admin_tokens = await login(auth_client)
    await auth_session.execute(update(User).values(role=UserRole.MEMBER))
    await auth_session.commit()
    admin_headers = {"Authorization": f"Bearer {admin_tokens['access_token']}"}
    assert (await auth_client.get("/test/admin", headers=admin_headers)).status_code == 403


@pytest.mark.anyio
async def test_login_validation_does_not_echo_password(auth_client: AsyncClient) -> None:
    response = await auth_client.post("/api/v1/auth/login", json={"email": "invalid", "password": PASSWORD})
    assert response.status_code == 422
    assert PASSWORD not in response.text


@pytest.mark.anyio
@pytest.mark.parametrize("email", [EMAIL, "UPPER@example.com"])
async def test_database_rejects_duplicate_and_noncanonical_email(auth_session: AsyncSession, password_hash: str, email: str) -> None:
    auth_session.add(User(email=email, hashed_password=password_hash, first_name="Other", last_name="User"))
    with pytest.raises(IntegrityError):
        await auth_session.flush()
    await auth_session.rollback()


@pytest.mark.anyio
async def test_openapi_documents_the_authentication_failures(auth_client: AsyncClient) -> None:
    """A generated client must model the most common failure of both endpoints."""
    schema = (await auth_client.get("/api/v1/openapi.json")).json()
    login_operation = schema["paths"]["/api/v1/auth/login"]["post"]
    me_operation = schema["paths"]["/api/v1/auth/me"]["get"]
    assert "401" in login_operation["responses"]
    assert "401" in me_operation["responses"]
    assert login_operation["responses"]["401"]["description"]
    assert me_operation["responses"]["401"]["description"]
    # Documenting the failure must not have changed who may call them.
    assert "security" not in login_operation
    assert me_operation["security"] == [{"HTTPBearer": []}]

    # ...and the documented status is the one actually returned.
    failed = await auth_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": "incorrect"})
    assert failed.status_code == 401
    assert (await auth_client.get("/api/v1/auth/me")).status_code == 401
