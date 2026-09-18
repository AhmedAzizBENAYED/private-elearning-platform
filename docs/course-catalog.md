# Course catalog and content management

This domain contains Course → Module → Lesson only. It reuses JWT/RBAC,
`BusinessError`, and the existing `Page`/`Pagination` contracts. It adds no
enrollment, progress, upload/storage service, frontend, or email integration.

## API

Paths below are relative to `/api/v1`. All routes require an active authenticated
user. Admin routes require ADMIN; catalog routes accept MEMBER and ADMIN.
Preview flags do not permit anonymous access.

| Methods | Path | Purpose |
| --- | --- | --- |
| POST, GET | `/admin/courses` | Create draft; paginated admin list |
| GET, PATCH | `/admin/courses/{course_id}` | Read admin metadata; edit draft |
| POST | `/admin/courses/{course_id}/publish` | Publish once, idempotently |
| POST | `/admin/courses/{course_id}/archive` | Archive once, idempotently |
| POST, GET | `/admin/courses/{course_id}/modules` | Create draft module; list ordered modules |
| GET, PATCH, DELETE | `/admin/modules/{module_id}` | Read/edit/delete module |
| POST, GET | `/admin/modules/{module_id}/lessons` | Create draft lesson; list ordered lessons |
| GET, PATCH, DELETE | `/admin/lessons/{lesson_id}` | Read/edit/delete lesson |
| GET | `/courses` | Published catalog |
| GET | `/courses/{course_id}` | Published course metadata |
| GET | `/courses/{course_id}/modules` | Published course's module metadata |
| GET | `/modules/{module_id}/lessons` | Published course's lesson metadata, without content |
| GET | `/lessons/{lesson_id}` | Published lesson metadata plus content/reference |

Creation returns 201, reads/updates/transitions 200, and deletion 204. Standard
errors: 401 unauthenticated/inactive, 403 wrong role, 404 unknown/hidden resource,
409 duplicate slug/position or lifecycle conflict, 422 invalid input, 503 storage
write failure. Swagger separates admin course/module/lesson management from the
member catalog and documents bearer authentication and response projections.

All lists use database pagination (`page=1`, `page_size=20`, maximum size 100),
returning `{items, total, page, page_size}`. Admin course lists also accept `search`
(case-insensitive literal title substring) and `status`. Catalog search is the
same but always filters PUBLISHED. Modules and lessons sort by position; courses
sort by creation timestamp then UUID. `%` and `_` in searches are treated literally.

Member course fields: id, title, slug, description, thumbnail_url, status,
published_at. Member module fields: id, title, description, position. Member
lesson fields: id, title, description, content_type, duration_seconds, position,
is_preview. Only the authenticated lesson detail adds `content`. Ownership,
parent foreign keys, creation/update/archive timestamps and user security fields
are excluded from member responses. Responses use `Cache-Control: no-store`.

## Lifecycle and editing

- New courses start DRAFT. The creator comes from the authenticated ADMIN's UUID;
  the service rechecks the administrator's existence, role and active status.
- DRAFT → PUBLISHED sets `published_at` once. Repeating publish on a published
  course is a no-op, including `updated_at`.
- PUBLISHED → ARCHIVED sets `archived_at` once. Repeating archive is a no-op.
- Draft archiving, published → draft, and all attempts to restore an archived
  course are rejected. Status is never accepted in a generic patch.
- All course, module and lesson edits are restricted to DRAFT. This deliberately
  includes published course metadata and module titles, not only structural edits.
- Empty courses may be published; this ticket specifies no minimum content count.
- Archived content remains readable to administrators and is hidden from every
  member endpoint, including direct UUID-based module/lesson access.

Course title and description are required. Slug and thumbnail URL are optional.
Automatic slugs use deterministic ASCII normalization and hyphens; titles without
ASCII characters use a deterministic hash suffix. Slug collisions return 409;
clients can supply another explicit slug. Updating a title does not change its
slug. Explicit slugs use lowercase ASCII letters/digits separated by hyphens.
Draft patches reject empty payloads, unknown fields and null required fields.
Optional thumbnail/module description/lesson description/duration fields can be
cleared with null. Parent IDs, ownership, status and timestamps are never editable.

Positions must be positive integers and unique within the parent. Gaps are allowed;
deletion does not renumber siblings. Moving to an occupied position returns 409.
There is no bulk reorder operation; draft clients can use an unused position to
stage a swap. Content cannot be moved between parents.

## Content validation

| Type | `content` | `duration_seconds` |
| --- | --- | --- |
| VIDEO | Absolute HTTP(S) URL or opaque `storage://bucket/path` reference | Optional positive integer |
| DOCUMENT | Absolute HTTP(S) URL or opaque `storage://bucket/path` reference | Must be null |
| LINK | Absolute HTTP(S) URL | Must be null |
| TEXT | Nonblank text | Must be null |

URL/reference strings are bounded at 2048 characters and reject whitespace,
control characters, URL credentials and backslashes. Storage references have
nonempty path segments without `.` or `..`. These are syntax checks only: no
remote requests, MIME checks, file existence validation, upload or signing occurs.
TEXT is limited to 100,000 characters, title to 200, descriptions to 20,000.
Partial lesson updates validate the merged persisted/new values. To change VIDEO
with a duration to another type, explicitly clear the duration in the same patch.
Clients must render TEXT safely; this API does not interpret or sanitize HTML.

## Database and transaction design

Migration: `f93c25d170ba_course_catalog.py`, revision **f93c25d170ba**, parent
**e82b14c069af**. Earlier migrations remain unchanged.

| Table | Main constraints/indexes |
| --- | --- |
| `courses` | UUID PK; unique indexed slug; indexed status and created_by; creator FK → users RESTRICT; enum check; lifecycle timestamp consistency |
| `modules` | UUID PK; course FK → courses RESTRICT; unique (course_id, position); positive position |
| `lessons` | UUID PK; module FK → modules CASCADE; unique (module_id, position); positive position; content enum; positive VIDEO-only duration |

Every entity has timezone-aware creation/update timestamps. Courses additionally
have nullable publication/archive timestamps. Database triggers maintain updated_at
for SQL writers. Composite unique indexes also support parent lookups/ordering.
Enums use named CHECK constraints instead of PostgreSQL-specific enum types.

There is no course DELETE API. Deleting a draft module cascades only to its lessons
through the database FK; course and creator FKs use RESTRICT. Direct lesson deletion
is draft-only. No unrelated records are cascaded. The migration downgrade removes
lesson/module/course tables and their timestamp triggers/function, leaving users
untouched; downgrading necessarily loses catalog data.

Every content write locks the course row first. Editing, publication, archiving
and deletion serialize on that row. Child records are reread after acquiring the
course lock to handle a competing deletion. Unique constraints resolve conflicts
at the database boundary. Services commit/rollback; repositories never commit.
Creator-role and allowed-transition rules are enforced by the service, so direct
SQL writers must honor those rules themselves.

## Tests and operation

The existing SQLite authentication fixtures are reused, with model discovery before
fixture schema creation and foreign-key enforcement in the catalog tests. No new
application schema bootstrap or `create_all()` call was introduced. Alembic remains
the only application migration mechanism. Tests cover every admin route's access
controls, creation, safe projections, lifecycle idempotency, published/archived edit
rejection, database constraints, cascade deletion, parent-scoped uniqueness,
pagination/search, merged PATCH validation, content types and error redaction.
Offline Alembic tests check generated PostgreSQL upgrade/downgrade SQL.

Run the standard suite from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --tb=short -p no:cacheprovider
```

Validation on 2026-09-18: **207 passed, 2 skipped, 2 warnings in 18.20s**.
The skips were the two opt-in PostgreSQL tests. The existing read-only PostgreSQL
check was then enabled separately and passed (**1 passed, 2 warnings in 2.31s**).
The new migrated-catalog test remains unrun, as explained below. The warnings are
the existing Starlette/httpx and AnyIO deprecations. No existing test was disabled
or weakened; exact route/model inventory assertions were extended for the new domain.

The existing PostgreSQL connectivity test remains read-only. Run against the local
Docker database without hardcoded credentials:

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

The new PostgreSQL lifecycle test is separately opted in with
`TEST_CATALOG_DATABASE_URL`. It **does not apply migrations**. The database must
already have the new migration, manually applied by the operator. The test creates
rows inside an outer transaction, uses savepoints for service commits, and rolls
back all its test data. It exercises API lifecycle operations and PostgreSQL cascade
behavior without creating another database or touching existing records.

After manually migrating, run it against the existing development database:

```powershell
@'
import os
import pytest
from dotenv import load_dotenv
load_dotenv('.env', override=False)
os.environ['TEST_CATALOG_DATABASE_URL'] = os.environ['DATABASE_URL']
raise SystemExit(pytest.main(['-q', '-p', 'no:cacheprovider', '--tb=short', 'app/tests/test_catalog_postgresql.py']))
'@ | & .\.venv\Scripts\python.exe -
```

No migration was applied and no changes were committed during this implementation.
The local PostgreSQL connection was verified; the new catalog tables were absent,
so the new live lifecycle test could not be run without applying the migration.
SQLite tests do not validate PostgreSQL concurrent row-lock behavior. Additional
multi-connection race tests remain desirable once a migrated test target is available.
Counts and paginated rows can reflect different READ COMMITTED snapshots during
concurrent writes. No enrollment access restriction or storage authorization is
implemented; all active members can read all published lessons.

## File inventory

Created:

- `app/models/course.py`, `module.py`, `lesson.py`
- `app/repositories/course_repository.py`, `module_repository.py`, `lesson_repository.py`
- `app/services/course_service.py`, `module_service.py`, `lesson_service.py`, `content_rules.py`
- `app/schemas/course.py`, `module.py`, `lesson.py`, `content.py`
- `app/api/v1/admin/courses.py`, `modules.py`, `lessons.py`
- `app/api/v1/courses.py`, `content_dependencies.py`
- `alembic/versions/f93c25d170ba_course_catalog.py`
- `app/tests/test_courses.py`, `test_catalog_postgresql.py`
- `docs/course-catalog.md`

Modified:

- `app/api/v1/router.py`: registers the new routers
- `app/tests/test_api.py`: exact updated route inventory
- `app/tests/test_auth.py`: loads all models before building the existing test fixture
- `app/tests/test_database.py`: exact updated model registry expectation
- `app/tests/test_migrations.py`: upgrade/downgrade assertions and exact model inventory

Authentication/member implementation, `.env`, Docker configuration and previous
migrations are unchanged.
