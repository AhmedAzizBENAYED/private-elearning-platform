# Storage architecture and the Google Drive adapter

This domain adds file storage for lesson content. It reuses JWT/RBAC,
`BusinessError`, Ticket 5's DRAFT-only editing rule and Ticket 6's enrollment
rule. It adds no transcoding, streaming server, CDN, DRM or thumbnail generation.

The central constraint: **Google Drive is infrastructure, not domain**. Course,
Module, Lesson, Enrollment and Progress contain no provider concept, and no
module outside `app/storage/google_drive.py` imports anything Google.

## Architecture

```
Router  →  LessonResourceService  →  LessonResourceRepository  →  PostgreSQL
                    ↓
              StoragePort (abstract)
                    ↓
   GoogleDriveStorage | InMemoryStorage | (future S3/B2/R2)
```

| Module | Responsibility |
| --- | --- |
| `app/storage/models.py` | Provider-neutral value objects: `StorageProvider`, `ObjectRef`, `StoredObject`, `ObjectMetadata`, `AccessGrant`, `ByteRange`, `ObjectStream` |
| `app/storage/base.py` | `StoragePort`: the only storage contract the domain imports |
| `app/storage/exceptions.py` | The only failures an adapter may raise |
| `app/storage/keys.py` | Application-generated keys, traversal validation, extension allowlist |
| `app/storage/memory.py` | In-memory adapter for development and tests |
| `app/storage/google_drive.py` | The Drive adapter; the only Drive-aware module |
| `app/storage/factory.py` | Builds the configured adapter; reads the Google settings |
| `app/services/resource_rules.py` | Filename, media type and signature validation |
| `app/services/resource_service.py` | Use cases, authorization and failure ordering |

The adapter is built once per worker in `lifespan` and closed on shutdown, so one
HTTP client and one token are shared across requests.

## Storage interface

```python
class StoragePort(ABC):
    provider: StorageProvider

    async def upload(self, storage_key, chunks, *, filename, mime_type) -> StoredObject
    async def metadata(self, ref: ObjectRef) -> ObjectMetadata
    async def exists(self, ref: ObjectRef) -> bool
    async def access(self, ref: ObjectRef) -> AccessGrant
    async def open(self, ref: ObjectRef, byte_range=None) -> ObjectStream
    async def delete(self, ref: ObjectRef) -> None
    async def aclose(self) -> None
```

`ObjectRef` pairs the application's stable `storage_key` with an opaque
`provider_reference` the adapter assigned at upload time. Drive stores a file ID
there; a key-addressable provider may repeat the key. Nothing above the port
interprets it. No Drive concept — file IDs, Drive permissions, `webViewLink` —
crosses this boundary, and neither do Google exception types.

`AccessGrant.kind` is the one place providers legitimately differ:

- `REDIRECT` — the provider mints a short-lived URL, and the API returns 307 so
  bytes never traverse this process. S3, R2 and B2 will use this.
- `STREAM` — no shareable URL exists, so the application relays the bytes in
  chunks. Google Drive uses this, which is what keeps the folder private.

## LessonResource model

One lesson has at most one resource (`UNIQUE(lesson_id)`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `lesson_id` | UUID | FK → `lessons.id`, `ON DELETE RESTRICT`, unique |
| `storage_provider` | VARCHAR(32) | `memory` or `google_drive`, CHECK-constrained |
| `storage_key` | VARCHAR(512) | Application-generated path, indexed |
| `provider_reference` | VARCHAR(512) | Opaque provider handle, never a URL |
| `original_filename` | VARCHAR(255) | Display name only |
| `mime_type` | VARCHAR(255) | Validated against configuration and content |
| `file_size_bytes` | BIGINT | CHECK > 0 |
| `checksum` | VARCHAR(128) | Provider-reported where available |
| `duration_seconds` | INTEGER | Mirror of the lesson's value; CHECK > 0 or NULL |
| `created_at`, `updated_at` | TIMESTAMPTZ | `updated_at` maintained by a trigger |

There is deliberately no `google_file_id`, no Drive URL and no cached download
link. Temporary URLs expire, so persisting one would both go stale and tie the
schema to one vendor.

`ON DELETE RESTRICT` is a choice, not an oversight: `CASCADE` would let a lesson
deletion silently orphan bytes at the provider. Deleting a lesson that still has
a resource returns 409 (`Lesson is still referenced`); remove the resource first.

**Only VIDEO and DOCUMENT lessons have resources.** LINK stays an external URL
and TEXT stays in `lessons.content`, exactly as Ticket 5 defined them. Uploading
to a LINK or TEXT lesson returns 409.

Progress is untouched: `ProgressService` still reads `Lesson.duration_seconds`
and has no knowledge of storage. The resource mirrors the duration only so a
provider migration keeps the value alongside the object.

## Google Drive adapter

### Authentication

**OAuth 2.0 installed-application refresh token — not a service account.**

A service account has no My Drive storage quota of its own. It can be granted
access to a personal Drive folder, but files it creates there are owned by an
account with no quota, which fails or leaves unusable files; owning files in a
Shared Drive requires Google Workspace, which a personal account does not have.
So the platform acts as the Drive account owner via a long-lived refresh token.

The scope is `drive.file`, which restricts the application to files it created
itself — it cannot read the rest of the account's Drive.

**This is why the platform creates its own root folder.** `drive.file` is a
per-file grant covering only files the app created, files the user opened with
the app, and files handed over through the Google Picker. A folder created by
hand in the Drive web UI is none of those: the app cannot see it, cannot list its
children, and `files.create` against it returns `404 File not found`. Setup
therefore creates the root folder *through the API*, which makes it app-created
and fully usable, along with every folder and file nested inside it. Broadening
to the full `drive` scope would also solve this and is deliberately rejected: it
would grant read/write over the account's entire personal Drive.

The refresh token is obtained once, interactively, by a developer running
`scripts/google_drive_authorize.py`. That script performs consent, then calls
`ensure_root_folder` to create the platform folder or reuse one an earlier run
created, and prints both the refresh token and the folder ID. The server never
performs consent and never creates the root. At runtime the adapter exchanges the
refresh token for a short-lived access token, caches it until a minute before
expiry behind an `asyncio.Lock`, and discards it on a 401/403 so the next call
re-authenticates.

Credentials live only in environment variables and only in the adapter. They are
never logged (the token endpoint's error body is dropped and only the status code
is recorded), never returned in an API response, and `SecretStr` keeps them out
of `repr(settings)`.

### Folder structure

```
<GOOGLE_DRIVE_ROOT_FOLDER_ID>/     ← "Private E-Learning Platform", created by the setup script
└── courses/
    └── <course-uuid>/
        ├── videos/
        │   └── <resource-uuid>.mp4
        └── documents/
            └── <resource-uuid>.pdf
```

Folder names are stable UUIDs and fixed words. Course *titles* are never used:
titles change, and storage identity must not. The tree mirrors the storage key
exactly (`courses/<course-id>/videos/<uuid>.mp4`), so a future S3 adapter maps
the same key to the same object path.

The root itself is created once by `scripts/google_drive_authorize.py`, never by
hand and never by the running server. Re-running setup reuses it: the lookup
matches by folder name and is not restricted to *My Drive*'s root, so the folder
can be moved or nested afterwards without a duplicate appearing. Under
`drive.file` a listing only ever returns app-created files, so that name lookup
cannot collide with an unrelated folder of the user's own.

Folders beneath the root are resolved lazily and cached per worker, so a repeated
upload to the same course performs no lookup at all. Two workers creating the same folder
concurrently could create a duplicate; the per-path lock prevents it within a
worker, and the consequence at this scale is a stray empty folder, not data loss.

### Upload transport

Resumable upload. The adapter opens a session, then regroups the caller's chunks
into blocks that are a multiple of 256 KiB (Drive's requirement) and `PUT`s them
with `Content-Range`. At most one block is buffered, so **peak memory is the
configured chunk size regardless of file size** — a 4 GB video never enters RAM.
Starlette spools the inbound multipart body to a temporary file, and the router
reads it back in the same chunk size.

## API

Paths are relative to `/api/v1`. All routes require an active authenticated user.

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| PUT | `/admin/lessons/{lesson_id}/resource` | ADMIN | Upload or replace a draft lesson's file (multipart `file`) |
| GET | `/admin/lessons/{lesson_id}/resource` | ADMIN | Read stored metadata; the provider is not contacted |
| DELETE | `/admin/lessons/{lesson_id}/resource` | ADMIN | Remove the resource and its object |
| GET | `/lessons/{lesson_id}/resource` | MEMBER/ADMIN | Describe an enrolled member's file; VIDEO URLs carry a playback token |
| GET | `/lessons/{lesson_id}/resource/content` | MEMBER/ADMIN | Stream the bytes (supports `Range`); bearer **or** playback token |

Administrator response fields: `resource_id`, `lesson_id`, `storage_provider`,
`storage_key`, `filename`, `mime_type`, `size_bytes`, `checksum`,
`duration_seconds`, `created_at`, `updated_at`. `provider_reference` is never
published — it has no meaning to a client.

Member response fields: `lesson_id`, `resource_id`, `content_type`, `filename`,
`mime_type`, `size_bytes`, `duration_seconds`, `download_url`. `download_url`
always points back at this API, so switching providers cannot change the client
contract. All responses use `Cache-Control: no-store`.

Errors: 401 unauthenticated, 403 wrong role, 404 unknown lesson/resource or
missing enrollment, 409 non-DRAFT course or a lesson kind that holds no file,
413 oversized upload, 415 unconfigured media type, 422 invalid filename,
extension or content, 503 provider unavailable.

## Workflows

### Upload

1. ADMIN sends the file to a lesson in a DRAFT course.
2. The service locks the course, confirms DRAFT and the lesson kind, and
   validates the filename, media type and extension.
3. The lock is released — a multi-gigabyte transfer must not hold a row lock.
4. A key is generated as `courses/<course-id>/<videos|documents>/<uuid><ext>`.
5. The stream is relayed to the provider while the size cap is enforced on bytes
   actually received and the leading bytes are checked against the declared type.
6. The course is locked again and re-confirmed DRAFT (it may have been published
   during the transfer), then the metadata row is written and committed.
7. Any replaced object is deleted after that commit.

### Download / access

1. MEMBER requests the lesson's file.
2. Authentication, then enrollment in the lesson's course, then the lesson kind.
3. The service asks the port for an `AccessGrant`.
4. `REDIRECT` → 307 to the provider's short-lived URL. `STREAM` → the bytes are
   relayed with `Range` support and a `206` when partial.

Members never receive provider credentials, file IDs or Drive URLs. Enrolled
members keep access after a course is archived, matching Ticket 6.

### Replacement

Replacement is the same PUT. The new object is uploaded under a **new** key, the
row is updated to point at it, and only then is the old object deleted. A failed
replacement therefore leaves the original resource intact and still readable.

### Deletion

1. Authorize ADMIN, confirm the course is DRAFT.
2. Delete the metadata row and commit.
3. Delete the object, best effort.

## Browser video playback

An HTML `<video src="...">` request carries no `Authorization` header, so a
bearer-only streaming endpoint cannot be played by a browser at all. Rather than
weaken the endpoint, VIDEO lessons hand the client a **playback token**.

### What it is

A JWT signed with the same `JWT_SECRET_KEY`, algorithm and validation rules as
access and refresh tokens — no second authentication system — but a distinct
kind of credential:

| Claim | Meaning |
| --- | --- |
| `token_type` | `playback` — rejected anywhere an `access` token is expected |
| `sub` | The member it was issued to |
| `lesson_id` | The single lesson it may stream |
| `exp` / `iat` / `nbf` | Validity window |
| `jti` | Unique per issue, so two URLs are never identical |
| `role` | Carried for symmetry; the database role remains authoritative |

It is **not** a session credential. `GET /auth/me`, `/me/enrollments` and every
other bearer route reject it, because they require `token_type == "access"`.
Equally, an access or refresh token in `?playback_token=` is rejected: decoding
explicitly requires the `playback` type, and `lesson_id` is a required claim for
that type. Access tokens are never placed in a URL, and refresh tokens never
leave the login response.

Lifetime is `PLAYBACK_TOKEN_EXPIRE_MINUTES` (default **30**, bounded 1–240), and
zero or negative values are rejected at startup.

### How a browser plays a lesson

1. The client calls `GET /api/v1/lessons/{id}/resource` with its normal bearer
   token. Authentication, role and **enrollment** are checked exactly as before.
2. For a VIDEO lesson the response's `download_url` already contains a freshly
   minted token:
   `/api/v1/lessons/{id}/resource/content?playback_token=…`
3. The client assigns that straight to `<video src>`. No header is needed.
4. Each media request — including every `Range` request the player issues while
   seeking — is authenticated from the token and **re-authorized** in full.

DOCUMENT lessons deliberately get no token: their URL stays bare and bearer-only.
A playback token presented for a non-video resource is refused.

### What the token does *not* do

It establishes identity, nothing more. Every request still verifies that the
member is active, is enrolled in the lesson's course, and that the resource
exists and is a VIDEO. A token therefore stops working the moment the member is
deactivated, loses the enrollment, or the resource is removed — it cannot
outlive the authorization it was issued under. It also cannot be used for a
different lesson or by a different member.

Google Drive stays entirely behind the storage abstraction: the token authorizes
access to *this API*, and the bytes are still fetched through `StoragePort`.
No Drive URL, file ID or credential ever reaches the client.

### Streaming is unchanged

The playback token only changes how the request is authenticated. `Range`,
`206 Partial Content`, `Content-Range`, `Accept-Ranges`, `Content-Length` and
chunked relaying all behave exactly as before, so seeking works and no video is
ever buffered whole.

## Failure handling

There is no distributed transaction across PostgreSQL and the provider, and the
code does not pretend otherwise. **The database is the source of truth**, and the
ordering above is chosen so every failure is recoverable:

| Failure | Result |
| --- | --- |
| Upload to the provider fails | 503; no row written; any existing resource untouched |
| Metadata commit fails after upload | The new object is deleted; the previous resource stays current |
| Both fail | An unreferenced object remains, logged with its storage key |
| Old-object delete fails after replacement | New resource is live; the old object is a logged orphan |
| Object delete fails during deletion | Row is gone (204); the object is a logged orphan |
| Course published mid-upload | 409; the uploaded object is discarded |

An orphaned object is inert and reclaimable by key. The reverse — a row pointing
at bytes that do not exist — would present members with a broken lesson, so it is
the case the ordering avoids. Orphans are logged at ERROR with `storage_key` and
no provider detail; reconciliation is manual and listed as known debt below.

## Security

- No credential is in source code, logs, API responses or documentation.
- The Drive folder is never made public; `drive.file` scope also prevents the
  application from reading anything it did not create.
- Storage keys are generated by the application from the course UUID and a fresh
  UUID. A client-supplied filename never reaches the key, and clients cannot
  supply a key or a provider reference at all.
- Keys are validated against traversal, absolute paths, backslashes, whitespace
  and control characters, at generation and again inside each adapter.
- Uploaded content must match its declared media type by leading bytes, not only
  by the client's claim.
- The size limit is applied to received bytes, not to `Content-Length`.
- ADMIN is required for upload, inspection and deletion; enrollment is required
  for member access; mutations are DRAFT-only.
- `StorageAuthError` subclasses `StorageUnavailable`, so a rejected *platform*
  credential surfaces as 503, never as a client authorization error.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORAGE_PROVIDER` | `memory` | `memory` or `google_drive` |
| `STORAGE_MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | Upload ceiling, 1 MiB–64 GiB |
| `STORAGE_UPLOAD_CHUNK_BYTES` | `8388608` (8 MiB) | Streaming block size, 256 KiB–64 MiB |
| `STORAGE_VIDEO_MIME_TYPES` | `video/mp4` | Comma-separated allowlist |
| `STORAGE_DOCUMENT_MIME_TYPES` | `application/pdf` | Comma-separated allowlist |
| `GOOGLE_DRIVE_CLIENT_ID` | — | Required when provider is `google_drive` |
| `GOOGLE_DRIVE_CLIENT_SECRET` | — | Required; `SecretStr` |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | — | Required; `SecretStr` |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | — | Required; the platform's Drive folder |
| `GOOGLE_DRIVE_TIMEOUT_SECONDS` | `30` | Provider HTTP timeout |
| `PLAYBACK_TOKEN_EXPIRE_MINUTES` | `30` | Media playback token lifetime, 1–240 |

Settings fail fast at startup: selecting `google_drive` without all four Google
values is a startup error, and `memory` is refused when
`APP_ENVIRONMENT=production` so a deployment cannot silently lose uploads.

| Environment | Provider | Notes |
| --- | --- | --- |
| Local development | `memory` by default | No Google account needed; files vanish on restart. Set `google_drive` to exercise the real adapter. |
| Tests | `memory`, injected | The suite never contacts Google. The live check needs `TEST_GOOGLE_DRIVE=1`. |
| Production | `google_drive` | Credentials from the deployment secret manager, never `.env`. |

## Configuring Google Drive locally

You never create a folder by hand — step 6 does it for you. See the
Authentication section above for why that is a requirement.

1. In the [Google Cloud console](https://console.cloud.google.com/), create or
   select a project.
2. Enable the **Google Drive API** for that project.
3. Configure the OAuth consent screen: **External**, publishing status *Testing*
   is fine.
4. Under *Audience*, add the Google account that owns the Drive as a **test user**.
5. Create credentials → **OAuth client ID** → application type **Desktop app**.
   Note the client ID and client secret.
6. Run the one-time setup, sign in as that Drive account and grant access:

   ```
   .venv\Scripts\python.exe scripts\google_drive_authorize.py ^
       --client-id <client-id> --client-secret <client-secret>
   ```

   It opens your browser, waits for consent, then creates the folder
   *Private E-Learning Platform* in that account's Drive (or reuses the one a
   previous run created) and prints:

   ```
   # Drive folder created: Private E-Learning Platform
   GOOGLE_DRIVE_REFRESH_TOKEN=...
   GOOGLE_DRIVE_ROOT_FOLDER_ID=...
   ```

   Nothing is written to disk. Use `--folder-name` for a different name,
   `--port` if 8765 is taken, and `--timeout` to wait longer than 300s.
7. Put those two values, plus the client ID and secret, in `.env` (local) or your
   secret manager (deployed), and set `STORAGE_PROVIDER=google_drive`. `.env` is
   git-ignored; never commit credentials, and never paste them into documentation
   or an issue.
8. Optionally verify against the real account:

   ```
   set TEST_GOOGLE_DRIVE=1
   .venv\Scripts\python.exe -m pytest -q app/tests/test_google_drive.py
   ```

   It uploads, reads and deletes one small PDF.

Re-running step 6 is safe and idempotent for the folder: it reuses the existing
one and reports `reused` rather than `created`.

If the script reports that Google returned no refresh token, revoke the app at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions) and
run it again — Google only issues one on first consent.

A refresh token stays valid until revoked, the password changes, or — while the
consent screen is in *Testing* — roughly seven days. Publish the consent screen
for a stable deployment, or re-run step 6.

## Switching providers later

1. Add an adapter implementing `StoragePort` (for example `app/storage/s3.py`).
2. Add its member to `StorageProvider` and a branch in `create_storage`, and
   extend the `storage_provider` CHECK constraint in a new migration.
3. Return `AccessKind.REDIRECT` from `access()` if the provider signs URLs; the
   member endpoint then redirects and stops relaying bytes, with no API change.
4. Copy objects, keeping the same storage keys, then update `storage_provider`
   and `provider_reference` per row.

No Course, Module, Lesson, Enrollment or Progress code changes, and no client
contract changes: members always fetch `/api/v1/lessons/{id}/resource/content`.

## Known limitations

- Orphan reconciliation is manual. Orphans are logged with their storage key;
  there is no sweeper endpoint or job.
- Concurrent workers can create a duplicate Drive folder for the same path. The
  consequence is a stray empty folder, not misplaced or lost files.
- The Drive adapter does not resume an interrupted upload session; a failed
  upload is retried from the beginning by the client.
- Drive streams pass through the application, so a large video consumes one
  worker connection for the duration of the download. An S3-compatible provider
  removes this by redirecting instead.
- Content sniffing covers the configured types (`video/mp4`, `video/quicktime`,
  `video/webm`, `application/pdf`). A type added to the allowlist without a
  registered signature is accepted on configuration alone.
- Because of `drive.file`, the platform can only ever use a root folder it
  created itself. Pointing `GOOGLE_DRIVE_ROOT_FOLDER_ID` at a hand-made folder
  fails every upload with 503. Adopting an existing folder would require the
  Google Picker API (and therefore a frontend), which Ticket 7 excludes.
- A playback token travels in the URL, so it can appear in web-server access
  logs and browser history. The exposure is bounded by design: one member, one
  lesson, minutes, and video reads only. The application's own logging records
  paths without query strings.
- Playback longer than `PLAYBACK_TOKEN_EXPIRE_MINUTES` needs a fresh URL: the
  client re-requests `GET /lessons/{id}/resource`. Raise the setting for very
  long lessons rather than reusing a stale token.
- The Drive round trip has not yet been exercised against a real Google account;
  the adapter and setup script are covered by mocked-API tests only. Run the
  opt-in check in step 8 above once credentials exist.
