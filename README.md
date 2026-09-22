# Private E-Learning Platform

A FastAPI backend foundation with a modular monolith layout. The application runs
as one deployable service, with explicit boundaries for HTTP, business use cases,
and persistence. PostgreSQL infrastructure uses SQLAlchemy 2.0 async sessions and
Alembic migrations. The IAM foundation provides user identities, Argon2id password
hashing, JWT login, current-user lookup, and reusable role checks. User administration
and learning features remain deferred. Application startup creates no tables.

See [IAM setup, security decisions, and testing](docs/iam.md). Existing environments
must add a generated `JWT_SECRET_KEY` before starting FastAPI or running Alembic.

## Layout and file responsibilities

```text
app/
    main.py
    core/
        config.py
        logging.py
        exceptions.py
    api/
        v1/
            router.py
    database/
        session.py
        base.py
    models/
    schemas/
        health.py
    services/
    repositories/
    tests/
        conftest.py
        test_api.py
        test_config.py
        test_database.py
        test_database_integration.py
        test_exceptions.py
        test_logging.py
        test_migrations.py
alembic/
    env.py
    script.py.mako
    versions/
alembic.ini
docker-compose.yml
```

Every package also contains an `__init__.py` with a short description of its role.

| File | Responsibility |
| --- | --- |
| `app/main.py` | Composition root and application lifespan: discovers models, creates one engine/session factory per application worker, and disposes the engine on shutdown. Also registers metadata, handlers, and versioned routes. |
| `app/core/config.py` | Validated, cached settings including required secret `DATABASE_URL`, asyncpg URL validation, and bounded pool/connection settings. Loads the project-root `.env`. |
| `app/core/logging.py` | Shared JSON logging. Application logs use stdout; Alembic uses stderr to keep offline SQL output clean. |
| `app/core/exceptions.py` | Registers HTTP, validation, and unexpected-error handlers. Preserves standard HTTP headers and returns generic JSON for unexpected failures. |
| `app/api/v1/router.py` | Liveness and database health routes under `/api/v1`; maps an unavailable database to HTTP 503. |
| `app/database/__init__.py` | Documents the database infrastructure package. |
| `app/database/session.py` | Async engine and session factory builders, request-scoped dependency injection, and a bounded read-only connectivity probe. |
| `app/database/base.py` | Shared SQLAlchemy declarative `Base` and metadata naming conventions for future migrations. Defines no tables. |
| `app/models/__init__.py` | Recursively imports future model modules through `load_models()` so their declarations enter `Base.metadata`. Contains no business models. |
| `app/schemas/health.py` | Typed liveness and database connectivity response contracts. |
| `app/services/__init__.py` | Reserves business use cases and documents their dependency boundary. |
| `app/repositories/__init__.py` | Reserves persistence adapters and documents their responsibility. |
| `app/tests/conftest.py` | Isolated settings/application/client fixtures and the asyncio test backend; unit tests use a dummy URL without requiring PostgreSQL. |
| `app/tests/test_api.py` | Health contract, API versioning, metadata, documentation control, and legacy import checks. |
| `app/tests/test_config.py` | Configuration precedence/caching, required database URL, driver validation, secret masking, interpolation, and pool limits. |
| `app/tests/test_database.py` | Independent sessions, transaction cleanup, engine disposal, safe health responses, probe timeout/cancellation, and absence of application tables. |
| `app/tests/test_database_integration.py` | Opt-in read-only health check against real PostgreSQL via `TEST_DATABASE_URL`. |
| `app/tests/test_exceptions.py` | Error status/header preservation, validation input omission, and safe 500 responses. |
| `app/tests/test_logging.py` | JSON formatting, timestamps, exception output, query omission, and duplicate/level checks. |
| `app/tests/test_migrations.py` | Nested model discovery and a temporary no-op migration rendered as offline SQL. Creates no database tables or repository revisions. |
| `alembic.ini` | Migration paths relative to the repository; contains no database URL or credentials. |
| `alembic/env.py` | Loads shared settings and discovered metadata; supports async online migrations and offline SQL rendering. |
| `alembic/script.py.mako` | Typed template for future revision files with `upgrade()` and `downgrade()`. |
| `alembic/versions/.gitkeep` | Keeps the empty revision directory in Git until actual schema changes are introduced. |
| `docker-compose.yml` | Development-only PostgreSQL 16 with environment-based credentials, loopback port binding, a named volume, and a readiness check. |
| `main.py` | Small compatibility import for existing `main:app` run configurations. The starter greeting endpoints have been removed. |
| `requirements.txt` | Runtime dependencies, including SQLAlchemy's asyncio extra, asyncpg, and Alembic. |
| `requirements-dev.txt` | Runtime dependencies plus the HTTP test client and test runner. |
| `pytest.ini` | Test discovery and the opt-in integration marker. |
| `.env.example` | Safe, tracked example configuration to copy locally. |
| `.env` | Local configuration, ignored by Git. Environment variables override it. |
| `.gitignore` | Excludes local environments, secrets, caches, build output, and new editor files. Previously tracked IDE files remain tracked. |
| `test_main.http` | Ready-to-run health and OpenAPI requests for PyCharm's HTTP client. |
| `README.md` | Architecture, configuration, development commands, and deployment notes. |

## Architectural decisions

- **One application with separate responsibilities.** Routes handle HTTP and use
  schemas as API contracts. Future business rules belong in services; database
  queries belong in repositories. `main.py` wires these parts together.
- **Dependencies point toward business needs.** As features arrive, services
  should define the small repository contracts they require and receive adapters
  through dependency injection. Keep FastAPI requests, HTTP exceptions, and
  concrete ORM imports outside service logic. There are no speculative base
  services, generic repositories, or dependency-injection containers.
- **Grow by feature inside the requested layers.** For example, a future course
  feature can have its own router, schemas, service, and repository. Avoid direct
  cross-feature table access; collaborate through service contracts. No business
  modules exist yet, so those boundaries are documented instead of invented.
- **An application factory supports isolated tests.** `create_app(settings)`
  accepts explicit configuration; normal startup uses cached settings. Lifespan
  owns the database engine and session factory. Creating the engine does not open
  connections; PostgreSQL can be temporarily unavailable without breaking liveness.
- **Configuration fails early.** Invalid log levels or environment names prevent
  startup. `.env` is resolved relative to the project, regardless of the working
  directory. Restart the process after configuration changes.
- **Simple, consistent errors.** HTTP failures keep FastAPI's `detail` response and
  headers. Validation failures return 422 with field locations, messages, and
  error types, excluding raw input and context. Unexpected failures are logged
  server-side and return `{"detail":"Internal server error"}`. Debug tracebacks
  are disabled in HTTP responses.
- **Small operational surface.** JSON logs use UTC timestamps and standard
  logging. Uvicorn access logs include method, path, and status, omitting query
  strings. Exception traces remain in server logs; avoid putting secrets in
  exception messages or URL paths. Logging configuration is process-wide, so an
  application factory call replaces the process's root/server logging handlers.
- **Database concerns stay in infrastructure.** ORM declarations share one `Base`;
  session/connection management belongs to `app.database`. No services or business
  repositories are added merely to wrap the infrastructure health query.
- **Transactions are explicit.** Each dependency call creates a fresh
  `AsyncSession`. Closing it rolls back any unfinished transaction, including on
  exceptions. The dependency never commits implicitly. Future use cases can use
  `async with session.begin():` for a unit of work. A session must not be shared
  across concurrent tasks. `expire_on_commit=False` avoids implicit attribute
  refreshes, and `autoflush=False` leaves flush timing explicit.
- **Migrations own schema changes.** Neither startup nor the health probe calls
  `create_all()`. Alembic shares the application's URL and metadata but uses its
  own short-lived async engine with `NullPool`. There are no initial revisions or
  business tables in this foundation.
- **Liveness and database connectivity are separate.** `GET /api/v1/health`
  returns `{"status":"ok"}` without contacting PostgreSQL. `GET /api/v1/health/db`
  executes `SELECT 1`, returning `{"database":"connected"}` or HTTP 503 with
  `{"detail":"Database unavailable"}`. Its query/pool wait is bounded to five
  seconds. This checks connectivity, not migration state or schema compatibility.

The router and handler wiring follow the official
[FastAPI multi-file application guidance](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
and [error handling guidance](https://fastapi.tiangolo.com/tutorial/handling-errors/).
Configuration uses [Pydantic Settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/),
and application lifecycle hooks use [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/).
Database lifecycle follows [SQLAlchemy's async guidance](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html),
and migrations use [Alembic's async recipe](https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic).

## Configuration

Configuration order is explicit constructor arguments, environment variables,
project-root `.env`, then defaults. General application keys use `APP_`; database
settings use the explicit `DATABASE_` names below. FastAPI and Alembic both read
the same `Settings` class. The URL is represented as a secret and omitted from
settings repr; validation error text does not print the submitted input.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `Private E-Learning Platform` | OpenAPI application title. |
| `APP_DESCRIPTION` | `Private e-learning platform backend API.` | OpenAPI description. |
| `APP_VERSION` | `0.1.0` | Application release version, independent of the API major version. |
| `APP_ENVIRONMENT` | `development` | One of `development`, `test`, `staging`, `production`; included in startup logs. |
| `APP_LOG_LEVEL` | `INFO` | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |
| `APP_DOCS_ENABLED` | `true` | Enables `/docs`, `/redoc`, and `/api/v1/openapi.json`. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins allowed to call the API. Development default; production must set its own. |
| `DATABASE_URL` | **Required** | Full `postgresql+asyncpg://` URL, including host and database name. No default credentials. Against the Docker database, write the host as `127.0.0.1` rather than `localhost`: the container publishes IPv4 only, and a resolver that prefers `::1` makes every new pool connection wait ~2 s for a refused IPv6 attempt first. |
| `DATABASE_POOL_SIZE` | `5` | Persistent connection pool size per worker, at least 1. |
| `DATABASE_MAX_OVERFLOW` | `10` | Additional temporary connections per worker, at least 0. |
| `DATABASE_POOL_TIMEOUT` | `30` | Positive seconds to wait for an available pooled connection. |
| `DATABASE_CONNECT_TIMEOUT` | `5` | Positive seconds allowed for a new asyncpg connection. |

The development Compose service additionally reads these variables from `.env`:

| Variable | Requirement | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` | Required | Initial development database role. |
| `POSTGRES_PASSWORD` | Required | Initial development role password; replace the example value. |
| `POSTGRES_DB` | Required | Database created on first initialization. |
| `POSTGRES_PORT` | Optional, defaults to `5432` in Compose | Host port bound only to `127.0.0.1`. |

For example, the URL format is
`postgresql+asyncpg://user:password@localhost:5432/elearning` (example values only).
`.env.example` interpolates the local `POSTGRES_*` values into `DATABASE_URL` using
`${NAME}` expansion. Use URL-safe development credentials with that template.
If a username/password contains characters such as `@`, `:`, `/`, `%`, or `$`,
provide a complete URL with the credentials percent-encoded instead. Production
should inject the full `DATABASE_URL` through the deployment's secret management;
the `POSTGRES_*` variables are only needed by the local Compose database.

`APP_ENVIRONMENT` mostly labels the deployment, but a few settings refuse unsafe
production values outright: `STORAGE_PROVIDER=memory` and a loopback
`CORS_ALLOWED_ORIGINS` both fail startup when `APP_ENVIRONMENT=production`.
Configure `APP_DOCS_ENABLED=false` explicitly if docs should be hidden.

### Cross-origin requests (CORS)

`CORS_ALLOWED_ORIGINS` lists the browser origins allowed to call this API,
comma separated. Entries must be an exact `scheme://host[:port]` — no path, no
trailing slash, and no wildcard. `*` is rejected at startup: this API is
private, and a wildcard would let any site read authenticated responses from a
logged-in member's browser.

```text
# Development (the default): the Vite dev server
CORS_ALLOWED_ORIGINS=http://localhost:5173

# Production: name the real frontend origin(s)
CORS_ALLOWED_ORIGINS=https://learn.example.org,https://admin.example.org
```

The development default is deliberately a loopback origin, and a production
deployment that forgets to override it **fails to start** rather than silently
inheriting it. An empty value registers no CORS middleware at all, which is the
right setting when the SPA is served from this same host.

Allowed request methods are `GET, POST, PATCH, PUT, DELETE, OPTIONS`; allowed
request headers are `Authorization`, `Content-Type` and `Range`; and
`Content-Range`, `Accept-Ranges` and `Content-Disposition` are exposed so a
cross-origin media player can seek. `Access-Control-Allow-Credentials` is
**not** sent, because tokens travel in the `Authorization` header and the
playback query parameter, never in cookies.

**CORS is not authentication.** It only tells a browser what it may read; it
stops nothing else. Every route keeps enforcing its own JWT validation, role
check and enrollment rules, and an allowed origin with no token still gets 401.
`DATABASE_URL` is required even if PostgreSQL is offline. Restart the application
after changing configuration. Never commit `.env` or print the resolved URL.

## Run locally (PowerShell)

Use Python 3.14 to match the existing project environment. From the project root:

```powershell
# Only if .venv does not already exist:
py -3.14 -m venv .venv

# Uses the project environment without requiring PowerShell activation:
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Creates .env only if one is not already present:
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Replace the example development password in `.env`. For an existing `.env`, merge
the new database keys from `.env.example` without replacing your other settings.
Install/start Docker Desktop with Linux containers, then initialize PostgreSQL:

```powershell
# Validate without printing the expanded credentials:
docker compose config --quiet
docker compose up -d --wait postgres
docker compose ps postgres

.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

The named `postgres_data` volume persists across container restarts and
`docker compose down`. The image uses `POSTGRES_*` initialization values only when
the volume is empty; changing `.env` does not change an existing role's password.
The Compose health check uses `pg_isready`; the API probe additionally performs a
real authenticated query. See the [official PostgreSQL image documentation](https://hub.docker.com/_/postgres).
No application tables or migrations are run by Compose.

Visit `http://127.0.0.1:8000/docs` for Swagger UI. From another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health/db
.\.venv\Scripts\python.exe -m pytest
```

The health response is HTTP 200 with `{"status":"ok"}`. There is no `/health`
alias outside `/api/v1`.

Stop the development database while retaining its data with `docker compose down`.
Do not add `--volumes` unless you intend to delete the local database data.

In PyCharm, select this project's `.venv\Scripts\python.exe` as the interpreter.
Use a Python run configuration with module `uvicorn`, parameters
`app.main:app --reload`, and the repository root as its working directory.
Existing `main:app` imports continue to work through the root compatibility file.

### Fix "Fatal error in launcher" after moving the project

If `uvicorn app.main:app --reload` mentions an old project directory, its Windows
launcher contains the interpreter path from before the move. Activation does not
rewrite that launcher. Start through the current interpreter instead:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

If the local interpreter works, regenerate the Uvicorn launcher using the pinned
version so the standalone `uvicorn` command works again:

```powershell
.\.venv\Scripts\python.exe -m pip install --force-reinstall --no-deps "uvicorn==0.53.0"
.\.venv\Scripts\uvicorn.exe --version
```

Also make sure PyCharm's project interpreter points to this repository's
`.venv\Scripts\python.exe`, rather than the previous project directory. If the
local interpreter itself fails, recreate `.venv` at its new location and reinstall
the requirements. In general, recreate virtual environments when moving projects:
[Python documents why virtual environments are not portable](https://docs.python.org/3/library/venv.html#how-venvs-work).

## Alembic workflow

Run from the project root after PostgreSQL is healthy and `DATABASE_URL` is set.
The module commands below use the project interpreter and avoid stale Windows
launchers. With an activated environment, `alembic ...` is equivalent.

```powershell
.\.venv\Scripts\python.exe -m alembic heads
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic upgrade head
```

The committed revision `c71a92e045bd` follows the initial baseline and creates the
users table, email index, constraints, and update timestamp trigger. Apply it with
`upgrade head`; do not generate a second migration for the same table.

When a future feature adds a model, inherit `Base` from `app.database.base` and
put its module anywhere under `app/models/` (use `__init__.py` in nested packages).
Both application startup and Alembic discover these modules automatically. Keep
them free of network calls, application startup imports, and other side effects.
Then generate, review, and apply a migration:

```powershell
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "Describe the schema change"
# Review the generated upgrade() and downgrade() before applying it.
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Autogeneration compares discovered metadata with the connected database. It needs
a running database and human review, particularly for renames and destructive
changes. Review custom trigger changes manually; autogeneration does not track them.

Offline SQL generation uses existing revisions and does not contact PostgreSQL:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head --sql
```

Logs go to stderr so stdout contains SQL only. `alembic.ini` contains no URL;
passing the URL directly from settings also preserves percent-encoded passwords
without ConfigParser interpolation issues.

## Database verification

`python -m pytest` runs isolated tests for settings, sessions, error responses,
timeouts, authentication, role checks, model discovery, and offline migration rendering.
Authentication tests create tables only in an ephemeral in-memory SQLite database.
One live connectivity test is skipped unless you explicitly set
`TEST_DATABASE_URL` in the test process environment to a PostgreSQL asyncpg URL.
After setting it, run `python -m pytest -m integration`. This live test only
executes the health probe. Run `docker compose config --quiet` and the migration
commands against your development database to verify the full Docker workflow.

## Production process

Inject the production `DATABASE_URL` securely, install runtime dependencies, apply
reviewed migrations as a separate deployment step, and start Uvicorn without reload:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:APP_ENVIRONMENT = "production"
$env:APP_DOCS_ENABLED = "false"
# Run once per deployment, not once per worker:
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

For an activated Linux environment, the equivalent server command is
`python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2`.
Choose the worker count for your host's CPU/memory limits; use one worker per
container when the deployment platform manages replication. Run under a process
manager or container platform that restarts failed processes and collects stdout.
Terminate HTTPS at your ingress/reverse proxy and configure trusted proxy addresses
for that deployment. Reload and worker supervisor messages may use Uvicorn's own
format; application-worker logs use JSON.

The application refuses an over-large request body before it reads it, and before
authentication runs: `RequestBodyLimitMiddleware` allows `STORAGE_MAX_UPLOAD_BYTES`
plus the multipart framing to a request that presents a credential, and 1 MiB to one
that presents none. That gate is active with no configuration. Set a matching body
limit at the ingress as well - `client_max_body_size` on nginx, `maxRequestBodyBytes`
on Traefik - so an over-large upload is dropped before it reaches a worker at all.

Use a managed PostgreSQL service or a separately operated database in production;
this Compose file is for local development. Use least-privilege runtime credentials
and a separate migration role when needed; the official image's initial local
role has elevated privileges. Configure database TLS/certificate verification for
your provider and driver, backups with restore checks, and monitoring for connection
usage, lock waits, and failed probes.

Budget connections across all workers and replicas. With the defaults, two workers
can open up to `2 * (5 + 10) = 30` application connections, plus migration/admin
connections. `pool_pre_ping=True` replaces stale pooled connections; it does not
retry failed transactions. Connection/pool timeouts do not impose a general SQL
statement timeout, so set appropriate PostgreSQL statement and lock timeouts for
future workloads. Assess asyncpg prepared-statement settings before introducing
an external pooler. Use liveness to detect a dead app and the DB endpoint to decide
whether it can currently reach PostgreSQL; a probe cannot guarantee future requests.

User administration, learning features, and production deployment infrastructure
remain future work.
