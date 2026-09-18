# Member management

All `/api/v1/admin/members` operations require a bearer access token belonging
to an active ADMIN. Authentication reloads the account and role on every request.
There is no public registration or deletion API.

## Endpoints

| Method | Path (under `/api/v1`) | Purpose |
| --- | --- | --- |
| POST | `/admin/members` | Create an active MEMBER awaiting password setup (201) |
| GET | `/admin/members` | Paginated MEMBER profiles (200) |
| GET | `/admin/members/{member_id}` | Retrieve a MEMBER profile (200) |
| PATCH | `/admin/members/{member_id}` | Update email, first name, last name (200) |
| PATCH | `/admin/members/{member_id}/status` | Activate/deactivate a MEMBER or ADMIN (200) |
| POST | `/admin/members/{member_id}/activation` | Reissue initial invitation for a pending active MEMBER (200) |
| POST | `/auth/setup-password` | Consume invitation and set initial password (204) |

Create accepts `email`, `first_name`, `last_name`. Profile updates accept a
nonempty subset of those fields, without nulls. Extra fields are rejected.
Email is normalized and database uniqueness handles concurrent requests.
Status accepts only a strict boolean `is_active`.

List query parameters: `page` (default 1), `page_size` (default 20, maximum 100),
`search` (case-insensitive literal substring across email/first/last name), and
optional `is_active`. SQL performs counting, filtering, ordering and pagination.
The response is `{items, total, page, page_size}`. Under concurrent writes the
count and rows may reflect different READ COMMITTED snapshots.

Profile responses contain only id, email, first_name, last_name, role, is_active,
created_at and updated_at. ADMIN profiles are excluded from profile operations;
the status endpoint deliberately supports ADMIN targets for account safety.
Errors use the existing `{detail: ...}` convention: 401 invalid/inactive identity,
403 insufficient role, 404 unknown member, 409 business conflict, 422 invalid
input and 503 unavailable storage or delivery. Setup returns a generic 400 for
expired, consumed, unknown tokens and inactive accounts.

## First access

1. An administrator creates the member. Role and active status are server-owned.
2. The account has an unusable password marker, never a generated plaintext password.
3. A cryptographically random 256-bit opaque token expires after
   `APP_ACTIVATION_TOKEN_EXPIRE_MINUTES` (default 30, allowed 1–60).
   Only its SHA-256 digest and expiry are persisted on the existing users table.
4. The member posts `{"token": "...", "password": "..."}` to
   `/api/v1/auth/setup-password`. Password length must be 12–1024 characters.
   Argon2id hashing runs off the event loop under the existing capacity limiter.
5. One conditional SQL UPDATE checks token, expiry, role and active status,
   stores the password hash and clears the invitation fields atomically.
   Concurrent reuse cannot consume the same invitation twice.
6. The member can then use the existing login endpoint.

In development/test, creation and reissue respond with
`{"member": { ...safe profile... }, "activation_token": "..."}`. Treat the token
as a credential and send it only in a request body; never log it or put it in a URL.
These responses use `Cache-Control: no-store`.

In staging/production, tokens are never included in responses. Creation/reissue
fails before writing when no delivery adapter is installed. A future adapter
implements `ActivationDelivery.send(email, SecretStr(token), expires_at)` and is
injected through `application.state.activation_delivery`. No provider is included.
Delivery happens after commit: failures return a safe 503, retain the pending
account, and can be recovered by reissuing an invitation. Durable delivery/retry
is future work; adapters must not log or persist plaintext tokens.

Reissuing replaces the previous token and is permitted only before initial setup.
Changing a pending account's email revokes its invitation; reissue after the update.
This is not a password-reset feature. Established accounts cannot use reissue.
Deactivation blocks setup and all subsequent authenticated requests, including
existing access tokens. Reactivation permits access again; still-unexpired JWTs
and invitations are not permanently revoked by a temporary deactivation.

## Administrator safety

Status changes lock all administrator rows in stable UUID order before checking
the active count and updating the target. The actor is rechecked under the locks.
This serializes concurrent administrator deactivations under PostgreSQL's default
READ COMMITTED isolation and prevents disabling the last active administrator.
Repeated requests for an existing status do not write or change `updated_at`.
There are no deletion or role-change operations. Direct SQL writers must maintain
the same invariant themselves; no database trigger enforces the administrator count.

## Migration and validation

New migration `e82b14c069af` adds nullable `activation_token_hash` (unique) and
`activation_expires_at` to `users`. Existing users remain unchanged. Existing
migrations are untouched. No second database or duplicate user table is created.

Run from the repository root, against the existing configured local database:

```powershell
docker compose up -d --wait postgres
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m pytest -q
```

Automated API tests reuse the authentication suite's in-memory SQLite fixtures;
Alembic tests verify PostgreSQL upgrade and downgrade SQL. SQLite does not exercise
PostgreSQL row locks or concurrent transaction behavior. The existing optional
`TEST_DATABASE_URL` test remains a read-only connectivity check, not a migration
or lifecycle test. This implementation does not automatically migrate local data.

Deployment must provide HTTPS and request rate limits, especially for login and
password setup. The existing Argon2 limiter bounds simultaneous hashes but is
not a per-client rate limiter. No frontend, email provider, role management,
password reset or refresh-token rotation is introduced.

## Implementation record

Created:

- `app/api/v1/admin/__init__.py` and `app/api/v1/admin/members.py`
- `app/services/member_service.py`
- `app/repositories/member_repository.py`
- `app/schemas/member.py` and `app/schemas/pagination.py`
- `alembic/versions/e82b14c069af_member_activation.py`
- `app/tests/test_members.py`
- `docs/members.md`

Modified:

- `app/models/user.py`: activation digest and expiry columns
- `app/core/config.py` and `.env.example`: bounded activation lifetime
- `app/core/dependencies.py`: member service injection
- `app/core/exceptions.py`: safe business exception handling
- `app/api/v1/router.py`: admin router registration
- `app/api/v1/auth.py`: invitation password setup route
- `app/tests/test_api.py`: exact updated route inventory
- `app/tests/test_config.py`: activation lifetime limits
- `app/tests/test_migrations.py`: activation upgrade/downgrade SQL assertions

Validation on 2026-09-18:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --tb=short -p no:cacheprovider
```

Result: 126 passed, one existing opt-in live check skipped. The live check was
then enabled separately against the already-running development PostgreSQL
container and passed (one passed). All 127 tests were therefore exercised across
the two runs. Two existing Starlette/httpx/AnyIO deprecation warnings remain.
No local migration was applied, no database was created, and `.env` was untouched.

Exact live-check command (loads local credentials without hardcoding or printing):

```powershell
@'
import os
import pytest
from dotenv import load_dotenv
load_dotenv('.env', override=False)
os.environ['TEST_DATABASE_URL'] = os.environ['DATABASE_URL']
raise SystemExit(pytest.main(['-q', '-p', 'no:cacheprovider', '--tb=short', 'app/tests/test_database_integration.py']))
'@ | & .\.venv\Scripts\python.exe -
```
