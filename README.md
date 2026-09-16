# Private E-Learning Platform

A FastAPI backend foundation with a modular monolith layout. The application runs
as one deployable service, with explicit boundaries for HTTP, business use cases,
and persistence. Authentication, business features, and database integration are
intentionally deferred.

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
        test_exceptions.py
        test_logging.py
```

Every package also contains an `__init__.py` with a short description of its role.

| File | Responsibility |
| --- | --- |
| `app/main.py` | Composition root: `create_app()`, application metadata, lifespan events, handler registration, and the `/api/v1` prefix. Exposes `app` for Uvicorn. |
| `app/core/config.py` | Immutable, validated `pydantic-settings` configuration; project-root `.env` discovery; cached settings accessor. |
| `app/core/logging.py` | Standard-library JSON formatter and shared application/Uvicorn logging configuration. Writes to stdout for a process manager or log collector. |
| `app/core/exceptions.py` | Registers HTTP, validation, and unexpected-error handlers. Preserves standard HTTP headers and returns generic JSON for unexpected failures. |
| `app/api/v1/router.py` | Version 1 routing entry point and the health endpoint. Include future feature routers here. |
| `app/database/session.py` | Documented location for a future engine and session dependency; currently creates no connections. |
| `app/database/base.py` | Documented location for future shared ORM metadata; currently defines no ORM base or tables. |
| `app/models/__init__.py` | Reserves the persistence-model package; no database models yet. |
| `app/schemas/health.py` | Typed response contract for health checks. |
| `app/services/__init__.py` | Reserves business use cases and documents their dependency boundary. |
| `app/repositories/__init__.py` | Reserves persistence adapters and documents their responsibility. |
| `app/tests/conftest.py` | Shared settings, application, and client fixtures; clears application environment variables between tests. |
| `app/tests/test_api.py` | Health contract, API versioning, metadata, documentation control, and legacy import checks. |
| `app/tests/test_config.py` | `.env` loading, environment precedence, validation, and settings caching. |
| `app/tests/test_exceptions.py` | Error status/header preservation, validation input omission, and safe 500 responses. |
| `app/tests/test_logging.py` | JSON formatting, timestamps, exception output, query omission, and duplicate/level checks. |
| `main.py` | Small compatibility import for existing `main:app` run configurations. The starter greeting endpoints have been removed. |
| `requirements.txt` | Runtime dependencies. |
| `requirements-dev.txt` | Runtime dependencies plus the HTTP test client and test runner. |
| `pytest.ini` | Discovers tests under `app/tests`. |
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
  provides the place to acquire and release future shared resources.
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
- **Database setup is deferred.** The health endpoint checks application liveness
  only. It does not claim that a future database or external dependency is ready.

The router and handler wiring follow the official
[FastAPI multi-file application guidance](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
and [error handling guidance](https://fastapi.tiangolo.com/tutorial/handling-errors/).
Configuration uses [Pydantic Settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/),
and application lifecycle hooks use [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/).

## Configuration

Configuration order is explicit constructor arguments, environment variables,
project-root `.env`, then defaults. All application environment keys use `APP_`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `Private E-Learning Platform` | OpenAPI application title. |
| `APP_DESCRIPTION` | `Private e-learning platform backend API.` | OpenAPI description. |
| `APP_VERSION` | `0.1.0` | Application release version, independent of the API major version. |
| `APP_ENVIRONMENT` | `development` | One of `development`, `test`, `staging`, `production`; included in startup logs. |
| `APP_LOG_LEVEL` | `INFO` | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |
| `APP_DOCS_ENABLED` | `true` | Enables `/docs`, `/redoc`, and `/api/v1/openapi.json`. |

`APP_ENVIRONMENT` labels the deployment; it does not automatically change other
settings. Configure `APP_DOCS_ENABLED=false` explicitly if docs should be hidden.
No secrets or database URL are needed at this stage.

## Run locally (PowerShell)

Use Python 3.14 to match the existing project environment. From the project root:

```powershell
# Only if .venv does not already exist:
py -3.14 -m venv .venv

# Uses the project environment without requiring PowerShell activation:
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Creates .env only if one is not already present:
if (!(Test-Path .env)) { Copy-Item .env.example .env }

.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Visit `http://127.0.0.1:8000/docs` for Swagger UI. From another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
.\.venv\Scripts\python.exe -m pytest
```

The health response is HTTP 200 with `{"status":"ok"}`. There is no `/health`
alias outside `/api/v1`.

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

## Production process

Install runtime dependencies and start Uvicorn without reload:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:APP_ENVIRONMENT = "production"
$env:APP_DOCS_ENABLED = "false"
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

This repository supplies the backend foundation. Database integration,
authentication, and deployment infrastructure remain separate future work.
