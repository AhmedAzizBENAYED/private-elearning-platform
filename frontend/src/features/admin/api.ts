import type {
  ApiClient,
  ContentType,
  CourseStatus,
  ISODateTime,
  Page,
  UploadProgress,
  UUID,
} from '../../api'

/**
 * `app.schemas.member.MemberResponse` = `app.schemas.auth.UserResponse`.
 *
 * The backend's allowlist, field for field. `hashed_password`,
 * `activation_token_hash` and `activation_expires_at` are columns on the user
 * row and appear on no response: the schema names what may leave the boundary,
 * so there is nothing here to filter out on this side.
 */
export interface Member {
  id: UUID
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  role: 'ADMIN' | 'MEMBER'
  created_at: string
  updated_at: string
}

/**
 * `app.schemas.member.MemberCreate` - what an administrator sends to open an
 * account.
 *
 * The initial password is chosen here and the account is usable at once.
 * There is no `role` and no `is_active`: the backend sets both and its schema
 * forbids extra fields, so neither could be sent even by mistake.
 */
/**
 * `app.schemas.member.MemberUpdate`, as this application uses it.
 *
 * The schema also accepts `email`, but the Admin-Member-Edit board keeps the
 * address read-only ("Not editable from this page"), so the type has no way
 * to carry one. Role and status are not in the schema at all - `extra="forbid"`
 * - and status has its own endpoint. At least one field must be present.
 */
export interface MemberUpdateInput {
  first_name?: string
  last_name?: string
}

export interface MemberCreateInput {
  email: string
  first_name: string
  last_name: string
  password: string
}

/**
 * `app.schemas.course.CourseResponse` - the administrator projection.
 *
 * `CatalogCourse` plus the four fields the member view drops. There is
 * deliberately **no module or lesson count**: `CourseResponse` carries none,
 * and counting them would mean a request per course.
 */
export interface AdminCourse {
  id: UUID
  title: string
  slug: string
  description: string
  thumbnail_url: string | null
  status: CourseStatus
  published_at: ISODateTime | null
  created_by: UUID
  created_at: ISODateTime
  updated_at: ISODateTime
  archived_at: ISODateTime | null
}

/**
 * `app.schemas.course.CourseListItem` - a row of `GET /admin/courses`.
 *
 * `CourseResponse` plus the size of the course. Both counts are aggregates the
 * backend computes on the one statement that reads the page (correlated
 * subqueries over `modules` and, through them, `lessons`), so a listing costs a
 * single request however many courses it returns.
 *
 * They appear on the listing only: `GET /admin/courses/{id}` still answers a
 * plain `CourseResponse`, which is why this is a separate type rather than two
 * optional fields on `AdminCourse`.
 */
export interface AdminCourseSummary extends AdminCourse {
  /** Modules the course owns. A real count, `0` included. */
  module_count: number
  /** Lessons across every module of the course. */
  lesson_count: number
}

/**
 * `app.schemas.course.CourseSort` - the values the listing accepts.
 *
 * Omitting it keeps the order this endpoint has always returned, oldest first.
 */
export type CourseSort = 'created_at' | '-created_at'

/** `app.schemas.course.CourseCreate`. `slug` is generated when omitted. */
export interface CourseCreateInput {
  title: string
  description: string
  slug?: string
  thumbnail_url?: string | null
}

/**
 * `app.schemas.course.CourseUpdate` - a patch, not a replacement.
 *
 * `ContentPatch` rejects an empty body and rejects a null for any field except
 * `thumbnail_url`, which is the only one that may be cleared.
 */
export type CourseUpdateInput = Partial<CourseCreateInput>

/** `app.schemas.module.ModuleResponse`. */
export interface AdminModule {
  id: UUID
  title: string
  description: string | null
  position: number
  course_id: UUID
  created_at: ISODateTime
  updated_at: ISODateTime
}

/** `app.schemas.module.ModuleCreate`. `position` is required and unique per course. */
export interface ModuleCreateInput {
  title: string
  description?: string | null
  position: number
}

export type ModuleUpdateInput = Partial<ModuleCreateInput>

/**
 * `app.schemas.lesson.LessonResponse` - the administrator projection.
 *
 * `content` is always present here, unlike the member `CatalogLessonContent`,
 * which blanks it for VIDEO and DOCUMENT. For those two it is the stored
 * reference, which is what this screen edits.
 */
export interface AdminLesson {
  id: UUID
  title: string
  description: string | null
  content_type: ContentType
  content: string
  duration_seconds: number | null
  position: number
  is_preview: boolean
  module_id: UUID
  created_at: ISODateTime
  updated_at: ISODateTime
}

/** `app.schemas.lesson.LessonCreate`. */
export interface LessonCreateInput {
  title: string
  description?: string | null
  content_type: ContentType
  content: string
  duration_seconds?: number | null
  position: number
  is_preview?: boolean
}

export type LessonUpdateInput = Partial<LessonCreateInput>

/**
 * `app.schemas.structure.CourseStructureUpdate` - the body of
 * `PUT /admin/courses/{id}/structure`: every module of the course, in order,
 * each with every lesson it is to hold, in order. No positions: list order is
 * the order, and the server numbers each list 1..n.
 */
export interface CourseStructureInput {
  modules: { id: UUID; lesson_ids: UUID[] }[]
}

/** `app.schemas.structure.CourseStructureResponse` - the structure as stored, in order. */
export interface CourseStructure {
  course_id: UUID
  modules: (AdminModule & { lessons: AdminLesson[] })[]
}

/**
 * `app.schemas.resource.ResourceResponse` - the administrator projection.
 *
 * Field for field what the endpoint returns. `provider_reference`, the opaque
 * handle the storage provider identifies the object by, is **deliberately
 * absent from the schema itself**, so there is nothing to strip here: the
 * backend never sends it. No provider name, credential, folder id or external
 * URL appears anywhere in this type.
 *
 * `storage_key` is the platform's own key (`courses/<id>/videos/<uuid>.mp4`),
 * generated from the course id and never from the uploaded filename. It is
 * read here only to be *not* displayed - see `resourceModel`.
 */
export interface LessonResource {
  resource_id: UUID
  lesson_id: UUID
  storage_provider: string
  storage_key: string
  filename: string
  mime_type: string
  size_bytes: number
  checksum: string | null
  /** Probed from the media by the backend for VIDEO; `null` for DOCUMENT. */
  duration_seconds: number | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface CoursesQuery {
  /** 1-based, as the backend counts. */
  page: number
  pageSize: number
  /** Literal substring of the course TITLE only. */
  search?: string
  status?: CourseStatus
  /** Server-side ordering; omitted means the backend default (oldest first). */
  sort?: CourseSort
  signal?: AbortSignal
}

export interface MembersQuery {
  /** 1-based, as the backend counts. */
  page: number
  pageSize: number
  /** Literal substring of email, first name or last name; empty means no filter. */
  search?: string
  /** `true` = active only, `false` = inactive only, `undefined` = both. */
  isActive?: boolean
  signal?: AbortSignal
}

export interface AdminApi {
  listMembers: (query: MembersQuery) => Promise<Page<Member>>
  getMember: (memberId: UUID, signal?: AbortSignal) => Promise<Member>
  setMemberStatus: (memberId: UUID, isActive: boolean, signal?: AbortSignal) => Promise<Member>
  updateMember: (memberId: UUID, input: MemberUpdateInput, signal?: AbortSignal) => Promise<Member>
  createMember: (input: MemberCreateInput, signal?: AbortSignal) => Promise<Member>
  /** How many rows a listing has, without reading any of them. */
  countMembers: (signal?: AbortSignal) => Promise<number>
  countCourses: (status?: CourseStatus, signal?: AbortSignal) => Promise<number>

  listCourses: (query: CoursesQuery) => Promise<Page<AdminCourseSummary>>
  getCourse: (courseId: UUID, signal?: AbortSignal) => Promise<AdminCourse>
  createCourse: (input: CourseCreateInput, signal?: AbortSignal) => Promise<AdminCourse>
  updateCourse: (courseId: UUID, patch: CourseUpdateInput, signal?: AbortSignal) => Promise<AdminCourse>
  uploadThumbnail: (courseId: UUID, file: File, signal?: AbortSignal) => Promise<AdminCourse>
  publishCourse: (courseId: UUID, signal?: AbortSignal) => Promise<AdminCourse>
  archiveCourse: (courseId: UUID, signal?: AbortSignal) => Promise<AdminCourse>

  listModules: (courseId: UUID, signal?: AbortSignal) => Promise<Page<AdminModule>>
  getModule: (moduleId: UUID, signal?: AbortSignal) => Promise<AdminModule>
  createModule: (courseId: UUID, input: ModuleCreateInput, signal?: AbortSignal) => Promise<AdminModule>
  updateModule: (moduleId: UUID, patch: ModuleUpdateInput, signal?: AbortSignal) => Promise<AdminModule>
  deleteModule: (moduleId: UUID, signal?: AbortSignal) => Promise<void>

  listLessons: (moduleId: UUID, signal?: AbortSignal) => Promise<Page<AdminLesson>>
  getLesson: (lessonId: UUID, signal?: AbortSignal) => Promise<AdminLesson>
  createLesson: (moduleId: UUID, input: LessonCreateInput, signal?: AbortSignal) => Promise<AdminLesson>
  updateLesson: (lessonId: UUID, patch: LessonUpdateInput, signal?: AbortSignal) => Promise<AdminLesson>
  deleteLesson: (lessonId: UUID, signal?: AbortSignal) => Promise<void>

  listCourseResources: (courseId: UUID, signal?: AbortSignal) => Promise<LessonResource[]>
  getResource: (lessonId: UUID, signal?: AbortSignal) => Promise<LessonResource>
  uploadResource: (
    lessonId: UUID,
    file: File,
    options?: { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void },
  ) => Promise<LessonResource>
  deleteResource: (lessonId: UUID, signal?: AbortSignal) => Promise<void>
  replaceStructure: (
    courseId: UUID,
    structure: CourseStructureInput,
    signal?: AbortSignal,
  ) => Promise<CourseStructure>
}

/** The backend's default page size (`Pagination.page_size`), reused not invented. */
export const MEMBERS_PAGE_SIZE = 20

/** The same default, for the course listing. */
export const COURSES_PAGE_SIZE = 20

/**
 * The backend maximum (`Pagination.page_size` is capped at 100).
 *
 * A course has a bounded set of modules and a module a bounded set of lessons,
 * and the structure screen shows both whole, so one page at the maximum is the
 * read. There is no admin endpoint returning the tree in one request - the
 * member `/courses/{id}/content` requires enrollment and a PUBLISHED course -
 * so the structure costs one call per module. Reported as a gap.
 */
const FULL_PAGE = 'page=1&page_size=100'

/**
 * The smallest page the backend will serve (`page_size` is bounded 1..100).
 *
 * Used for the counts on the admin landing page: `Page.total` is the count
 * across every page, so one row is enough to read it, and no listing is
 * transferred just to produce a number.
 */
const COUNT_ONLY = 'page=1&page_size=1'

/**
 * The administration API.
 *
 * Every call goes through the same authenticated client the member features
 * use - one session, one refresh strategy, one place where the Authorization
 * header is set. Authorization itself is the backend's: the whole
 * `/admin/members` router carries `Depends(require_role(UserRole.ADMIN))`, so a
 * member who reached these URLs would be refused by the server regardless of
 * what this frontend chose to render.
 */
export function createAdminApi(client: ApiClient): AdminApi {
  function membersPath({ page, pageSize, search, isActive }: MembersQuery): string {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    // `MemberQuery.search` is an optional literal substring; a blank string is
    // treated as no filter by the repository, so it is omitted rather than sent.
    const term = search?.trim() ?? ''
    if (term !== '') params.set('search', term)
    if (isActive !== undefined) params.set('is_active', String(isActive))
    return `/admin/members?${params.toString()}`
  }

  function coursesPath({ page, pageSize, search, status, sort }: CoursesQuery): string {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    const term = search?.trim() ?? ''
    if (term !== '') params.set('search', term)
    if (status !== undefined) params.set('status', status)
    if (sort !== undefined) params.set('sort', sort)
    return `/admin/courses?${params.toString()}`
  }

  return {
    /**
     * `GET /admin/members` -> `Page[MemberResponse]`.
     *
     * Paged, searched and filtered by the database, not here:
     * `MemberRepository.list_members` applies `is_active`, an autoescaped
     * `icontains` over email/first/last name, and `OFFSET`/`LIMIT`. Rows are
     * MEMBER accounts only - the repository pins `User.role == MEMBER`.
     */
    listMembers: (query) => client.request<Page<Member>>(membersPath(query), { signal: query.signal }),

    /**
     * `GET /admin/members/{member_id}` -> `MemberResponse`.
     *
     * 404 both when no such user exists and when the id belongs to an ADMIN:
     * `MemberService._member` refuses a non-MEMBER row, so this endpoint cannot
     * be used to read an administrator's record.
     */
    getMember: (memberId, signal) =>
      client.request<Member>(`/admin/members/${memberId}`, { signal }),

    /**
     * `PATCH /admin/members/{member_id}/status` -> `MemberResponse`.
     *
     * The body is exactly `{ is_active }`; `MemberStatus` sets `extra="forbid"`
     * and `strict=True`, so nothing else may be sent and a non-boolean is a 422.
     * The write is idempotent - setting the status it already has changes
     * nothing and still answers 200 with the row.
     *
     * 409 guards the last active administrator, and 403 is returned when the
     * acting administrator has themselves been deactivated meanwhile.
     */
    setMemberStatus: (memberId, isActive, signal) =>
      client.request<Member>(`/admin/members/${memberId}/status`, {
        method: 'PATCH',
        json: { is_active: isActive },
        signal,
      }),

    /**
     * `PATCH /admin/members/{member_id}` -> `MemberResponse`.
     *
     * The body holds only the names that changed. 404 when the id is not a
     * MEMBER (`MemberService._member`), 422 for an empty or overlong name or an
     * empty body. The 409 of this endpoint is a duplicate email, which this
     * application never sends.
     */
    updateMember: (memberId, input, signal) =>
      client.request<Member>(`/admin/members/${memberId}`, { method: 'PATCH', json: input, signal }),

    /**
     * `POST /admin/members` -> 201 `MemberResponse`.
     *
     * The body carries the initial password, which is why it goes only in the
     * JSON body of this one request: it is never put in a URL, never kept in
     * any store, and `ApiError` never reads a request body, so it cannot
     * reach an error message either. The response is the new member and
     * carries no credential of any kind.
     *
     * 409 when the address is already used - by a member or an administrator.
     * 422 for a field the backend refuses, keyed by field name.
     */
    createMember: (input, signal) =>
      client.request<Member>('/admin/members', { method: 'POST', json: input, signal }),

    countMembers: (signal) =>
      client
        .request<Page<Member>>(`/admin/members?${COUNT_ONLY}`, { signal })
        .then((result) => result.total),

    /**
     * `GET /admin/courses` -> `Page[CourseResponse]`.
     *
     * `CourseQuery` is `Pagination` + `search` + `status`. The search is a
     * literal, autoescaped substring of the **title only** - not the
     * description - and paging is `OFFSET`/`LIMIT` in the database. Rows come
     * back ordered by `created_at, id` unless `sort` asks otherwise, which is
     * the backend's order, not one imposed here.
     *
     * Each row carries `module_count` and `lesson_count`, so the size of a
     * course never costs a second request.
     */
    listCourses: (query) =>
      client.request<Page<AdminCourseSummary>>(coursesPath(query), { signal: query.signal }),

    /** `GET /admin/courses/{id}` -> `CourseResponse`. 404 when unknown. */
    getCourse: (courseId, signal) =>
      client.request<AdminCourse>(`/admin/courses/${courseId}`, { signal }),

    /**
     * `POST /admin/courses` -> 201 `CourseResponse`.
     *
     * The new course is always a DRAFT owned by the acting administrator:
     * `CourseService.create` sets `status` and `created_by` itself, and neither
     * is accepted from a client. 409 when the slug is taken.
     */
    createCourse: (input, signal) =>
      client.request<AdminCourse>('/admin/courses', { method: 'POST', json: input, signal }),

    /**
     * `PATCH /admin/courses/{id}` -> `CourseResponse`.
     *
     * Draft-only: `require_draft` answers **409 "Only DRAFT courses can be
     * edited"** for a PUBLISHED or ARCHIVED course. Status, ownership and
     * timestamps are never client-editable; `extra="forbid"` rejects them.
     */
    updateCourse: (courseId, patch, signal) =>
      client.request<AdminCourse>(`/admin/courses/${courseId}`, {
        method: 'PATCH',
        json: patch,
        signal,
      }),

    /**
     * `PUT /admin/courses/{id}/thumbnail` -> **200** `CourseResponse`
     * (BE-THUMBNAIL-UPLOAD-01).
     *
     * Stores the image and makes it the draft course's thumbnail; the answer
     * is the whole course, whose `thumbnail_url` is now an absolute URL to the
     * stored file. Every other field is unchanged. The previous uploaded image
     * is deleted by the server after the course points at the new one.
     *
     * The body is `multipart/form-data` with a single `file` part, as for a
     * lesson resource; no `Content-Type` is set so the browser writes the
     * multipart boundary itself.
     *
     * Refusals, all of them the backend's:
     *   409  the course is not a DRAFT
     *   413  larger than 5 MiB
     *   415  declared type other than image/png or image/jpeg
     *   422  empty, not a valid image of its type, or too many pixels
     *   503  the storage provider is unavailable
     */
    uploadThumbnail: (courseId, file, signal) => {
      const body = new FormData()
      body.append('file', file)
      return client.request<AdminCourse>(`/admin/courses/${courseId}/thumbnail`, {
        method: 'PUT',
        body,
        signal,
      })
    },

    /**
     * `POST /admin/courses/{id}/publish` -> `CourseResponse`.
     *
     * DRAFT -> PUBLISHED, and idempotent: publishing a PUBLISHED course changes
     * nothing and preserves `published_at`. Any other source status is 409.
     */
    publishCourse: (courseId, signal) =>
      client.request<AdminCourse>(`/admin/courses/${courseId}/publish`, {
        method: 'POST',
        signal,
      }),

    /**
     * `POST /admin/courses/{id}/archive` -> `CourseResponse`.
     *
     * PUBLISHED -> ARCHIVED, idempotent in the same way, and terminal: the
     * service defines no transition out of ARCHIVED, so a 409 is the answer to
     * every attempt to move one again.
     */
    archiveCourse: (courseId, signal) =>
      client.request<AdminCourse>(`/admin/courses/${courseId}/archive`, {
        method: 'POST',
        signal,
      }),

    /**
     * The same listing, read for `total` alone.
     *
     * `CourseQuery` accepts a `status`, so "how many are published" is a real
     * server-side count rather than a number computed over one page here.
     */
    // ------------------------------------------------------------- modules

    /** `GET /admin/courses/{id}/modules` -> `Page[ModuleResponse]`, by position. */
    listModules: (courseId, signal) =>
      client.request<Page<AdminModule>>(`/admin/courses/${courseId}/modules?${FULL_PAGE}`, { signal }),

    /** `GET /admin/modules/{id}`. 404 when unknown. */
    getModule: (moduleId, signal) =>
      client.request<AdminModule>(`/admin/modules/${moduleId}`, { signal }),

    /**
     * `POST /admin/courses/{id}/modules` -> 201 `ModuleResponse`.
     *
     * `position` is required and unique per course: a taken one answers 409
     * "Module position already in use in this course". The parent course must
     * be a DRAFT, or the answer is 409 "Only DRAFT courses can be edited".
     */
    createModule: (courseId, input, signal) =>
      client.request<AdminModule>(`/admin/courses/${courseId}/modules`, {
        method: 'POST',
        json: input,
        signal,
      }),

    /** `PATCH /admin/modules/{id}`. Draft-only, same 409s as create. */
    updateModule: (moduleId, patch, signal) =>
      client.request<AdminModule>(`/admin/modules/${moduleId}`, {
        method: 'PATCH',
        json: patch,
        signal,
      }),

    /**
     * `DELETE /admin/modules/{id}` -> 204.
     *
     * Deletes the module and its lessons in one transaction. A lesson holding a
     * stored file blocks it: `lesson_resources.lesson_id` is `ON DELETE
     * RESTRICT`, so the answer is 409 "Module is still referenced".
     */
    deleteModule: (moduleId, signal) =>
      client.request<void>(`/admin/modules/${moduleId}`, { method: 'DELETE', signal }),

    // ------------------------------------------------------------- lessons

    /** `GET /admin/modules/{id}/lessons` -> `Page[LessonResponse]`, by position. */
    listLessons: (moduleId, signal) =>
      client.request<Page<AdminLesson>>(`/admin/modules/${moduleId}/lessons?${FULL_PAGE}`, { signal }),

    getLesson: (lessonId, signal) =>
      client.request<AdminLesson>(`/admin/lessons/${lessonId}`, { signal }),

    /**
     * `POST /admin/modules/{id}/lessons` -> 201 `LessonResponse`.
     *
     * Creates the lesson record only. No file is uploaded and no resource row
     * is created: that is `PUT /admin/lessons/{id}/resource`, which FE-12 never
     * calls. A VIDEO or DOCUMENT lesson starts with a placeholder reference and
     * no file until then.
     */
    createLesson: (moduleId, input, signal) =>
      client.request<AdminLesson>(`/admin/modules/${moduleId}/lessons`, {
        method: 'POST',
        json: input,
        signal,
      }),

    /**
     * `PATCH /admin/lessons/{id}`.
     *
     * Metadata only. Measured against the real backend: a metadata patch leaves
     * the stored file untouched - same `storage_key`, same `resource_id` - so
     * renaming a lesson cannot disturb a video that was already uploaded.
     */
    updateLesson: (lessonId, patch, signal) =>
      client.request<AdminLesson>(`/admin/lessons/${lessonId}`, {
        method: 'PATCH',
        json: patch,
        signal,
      }),

    /**
     * `DELETE /admin/lessons/{id}` -> 204, or 409 "Lesson is still referenced"
     * when a stored file still points at it.
     */
    deleteLesson: (lessonId, signal) =>
      client.request<void>(`/admin/lessons/${lessonId}`, { method: 'DELETE', signal }),

    // ----------------------------------------------------------- resources

    /**
     * `GET /admin/courses/{id}/resources` -> `list[ResourceResponse]`.
     *
     * Every stored file in the course in **one** request. The backend reads
     * them with a single aggregate query - `test_course_resources_are_listed
     * _without_n_plus_one` pins it at three statements for a whole course - so
     * the structure screen learns which lessons hold a file without asking
     * once per lesson.
     *
     * Not paged: the endpoint returns a bare list, not a `Page`.
     */
    listCourseResources: (courseId, signal) =>
      client.request<LessonResource[]>(`/admin/courses/${courseId}/resources`, { signal }),

    /**
     * `GET /admin/lessons/{id}/resource` -> `ResourceResponse`.
     *
     * Stored metadata only - the service never contacts the provider - so this
     * costs one database read and transfers no file bytes. **404** when the
     * lesson holds no file, which is the ordinary state of a new lesson, and
     * also when the lesson is TEXT or LINK.
     */
    getResource: (lessonId, signal) =>
      client.request<LessonResource>(`/admin/lessons/${lessonId}/resource`, { signal }),

    /**
     * `PUT /admin/lessons/{id}/resource` -> **200** `ResourceResponse`.
     *
     * Upload *and* replacement are this one call: a lesson holds at most one
     * resource (`uq_lesson_resources_lesson_id`), and the service commits the
     * new object's metadata before discarding the old object, so a failed
     * replacement leaves the existing file in place.
     *
     * The body is `multipart/form-data` with a single `file` part, which is
     * what the endpoint's `file: UploadFile = File(...)` parameter is named.
     * No `Content-Type` is set here on purpose: the transport only sets one for
     * `json`, so the browser writes the header itself along with the multipart
     * boundary, which it alone can generate.
     *
     * The `File` is handed to `FormData` by reference and streamed by the
     * browser. It is never read into memory, never base64-encoded and never
     * copied into a Blob, so a 2 GB video costs nothing here.
     *
     * `onProgress` receives the bytes sent so far (G33). It changes nothing
     * about the request - same endpoint, same body, same single call - only
     * the transport that carries it (see `RequestOptions.onUploadProgress`).
     *
     * Refusals, all of them the backend's:
     *   409  the course is not a DRAFT, or the lesson is TEXT or LINK
     *   413  larger than `STORAGE_MAX_UPLOAD_BYTES`
     *   415  media type not in the configured allowlist for this lesson kind
     *   422  filename, extension, or leading bytes that contradict the type
     *   503  the storage provider is unavailable
     */
    uploadResource: (lessonId, file, { signal, onProgress } = {}) => {
      const body = new FormData()
      body.append('file', file)
      return client.request<LessonResource>(`/admin/lessons/${lessonId}/resource`, {
        method: 'PUT',
        body,
        signal,
        onUploadProgress: onProgress,
      })
    },

    /**
     * `DELETE /admin/lessons/{id}/resource` -> 204.
     *
     * Draft-only, like the upload: 409 on a PUBLISHED or ARCHIVED course, 404
     * when there was no file to begin with.
     */
    deleteResource: (lessonId, signal) =>
      client.request<void>(`/admin/lessons/${lessonId}/resource`, { method: 'DELETE', signal }),

    /**
     * `PUT /admin/courses/{id}/structure` -> **200** `CourseStructureResponse`
     * (BE-COURSE-REORDER-01).
     *
     * Reorders the modules, reorders their lessons and moves lessons between
     * modules of the course, in one transaction: all of it applies or none of
     * it does. The answer is the structure read back from the database.
     *
     * Refusals: 409 when the course is not a DRAFT ("Only DRAFT courses can be
     * edited") or when the body is not exactly the course's current structure
     * (a module or lesson missing, unknown or from another course); 422 for a
     * malformed body.
     */
    replaceStructure: (courseId, structure, signal) =>
      client.request<CourseStructure>(`/admin/courses/${courseId}/structure`, {
        method: 'PUT',
        json: structure,
        signal,
      }),

    countCourses: (status, signal) =>
      client
        .request<Page<unknown>>(
          `/admin/courses?${COUNT_ONLY}${status === undefined ? '' : `&status=${status}`}`,
          { signal },
        )
        .then((result) => result.total),
  }
}

/** `first_name last_name`, the only name the backend stores. */
export function fullName(member: Member): string {
  return `${member.first_name} ${member.last_name}`.trim()
}
