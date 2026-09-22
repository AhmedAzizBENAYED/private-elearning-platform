import type {
  ApiClient,
  CatalogCourse,
  CatalogLesson,
  CatalogModule,
  CatalogPage,
  CourseContent,
  EnrollmentFilter,
  EnrollmentSummary,
  Page,
  UUID,
} from '../../api'

export interface CatalogQuery {
  /** 1-based, as the backend counts. */
  page: number
  pageSize: number
  /** Matched against the course TITLE only; the backend does not search text. */
  search?: string
  /** The catalogue tab (G04); omitted for "All". */
  enrollment?: EnrollmentFilter | null
  signal?: AbortSignal
}

/** `app.schemas.enrollment.EnrollmentResponse` - what `POST .../enroll` returns. */
export interface EnrollmentResponse {
  id: UUID
  course_id: UUID
  enrolled_at: string
  completed_at: string | null
}

/**
 * A body of `POST /me/learning-events` (BE-LEARNING-TRACKING-01).
 *
 * Exactly the backend's three accepted shapes: the event type and the
 * references it is about, nothing else. The member and the time are the
 * server's - `extra="forbid"` answers 422 to a `user_id` or an `occurred_at` -
 * and `lesson_completed` is written by the server from
 * `PUT /lessons/{id}/progress`, never sent from here.
 */
export type LearningEventInput =
  | { type: 'course_opened'; course_id: UUID }
  | { type: 'module_opened'; course_id: UUID; module_id: UUID }
  | { type: 'lesson_opened'; course_id: UUID; module_id: UUID; lesson_id: UUID }

export interface CoursesApi {
  listCourses: (query: CatalogQuery) => Promise<CatalogPage>
  listEnrollments: (signal?: AbortSignal) => Promise<Page<EnrollmentSummary>>
  getCourse: (courseId: UUID, signal?: AbortSignal) => Promise<CatalogCourse>
  getCourseContent: (courseId: UUID, signal?: AbortSignal) => Promise<CourseContent>
  listModules: (courseId: UUID, signal?: AbortSignal) => Promise<Page<CatalogModule>>
  listModuleLessons: (moduleId: UUID, signal?: AbortSignal) => Promise<Page<CatalogLesson>>
  enroll: (courseId: UUID, signal?: AbortSignal) => Promise<EnrollmentResponse>
  recordLearningEvent: (event: LearningEventInput) => Promise<unknown>
}

/**
 * The backend's own maximum (`Pagination.page_size` is capped at 100).
 *
 * The member's enrollments are their own small set, so one page covers them;
 * the catalogue is paged properly instead, because it is a browsing screen and
 * could grow without limit.
 */
export const MAX_PAGE_SIZE = 100

/** The backend's default page size, reused rather than inventing one. */
export const CATALOG_PAGE_SIZE = 20

/** One page at the backend's maximum, which is how the outline reads are sized. */
const FULL_PAGE = `page=1&page_size=${MAX_PAGE_SIZE}`

export function createCoursesApi(client: ApiClient): CoursesApi {
  return {
    /**
     * `GET /courses` - the published catalogue.
     *
     * Accepts `page`, `page_size`, `search` and, since BE-COURSE-CATALOG-01,
     * `enrollment` (`CatalogListQuery`). There is no status filter: the
     * service pins the query to PUBLISHED itself. The reply carries each
     * course's size and every tab's count (`CatalogPage`).
     */
    listCourses: ({ page, pageSize, search, enrollment, signal }) => {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      // An empty search must be omitted, not sent blank: the backend treats a
      // blank string as "no filter" but there is no reason to send it.
      const term = search?.trim() ?? ''
      if (term !== '') params.set('search', term)
      // "All" is the absence of the filter, never a value of it.
      if (enrollment) params.set('enrollment', enrollment)

      return client.request<CatalogPage>(`/courses?${params.toString()}`, { signal })
    },

    /**
     * `GET /me/enrollments` - the member's own courses.
     *
     * Read once per catalogue visit so each card can show its enrollment state
     * without a request per course.
     */
    listEnrollments: (signal) =>
      client.request<Page<EnrollmentSummary>>(`/me/enrollments?${FULL_PAGE}`, { signal }),

    /**
     * `GET /courses/{id}` - one published course.
     *
     * `CourseService.catalog_get` loads with `published=True`, so a DRAFT or
     * ARCHIVED course answers 404 exactly as a missing one does. The frontend
     * therefore never has to decide visibility - and cannot.
     */
    getCourse: (courseId, signal) =>
      client.request<CatalogCourse>(`/courses/${courseId}`, { signal }),

    /**
     * `GET /courses/{id}/content` - the whole outline plus this member's
     * progress, in one request.
     *
     * Requires enrollment: `LearningService.course_content` calls
     * `require_enrollment` first, which raises 404 for a member who is not
     * enrolled. Given a course that has already answered `getCourse`, a 404
     * here means "not enrolled" rather than "no such course".
     */
    getCourseContent: (courseId, signal) =>
      client.request<CourseContent>(`/courses/${courseId}/content`, { signal }),

    /**
     * `GET /courses/{id}/modules` - the outline a NON-enrolled member may read.
     *
     * Gated by `catalog_access` and a published course only, so it carries no
     * progress at all. It is the only way to show the outline before
     * enrollment, which the design does.
     */
    listModules: (courseId, signal) =>
      client.request<Page<CatalogModule>>(`/courses/${courseId}/modules?${FULL_PAGE}`, { signal }),

    /** `GET /modules/{id}/lessons` - lesson metadata; never lesson content. */
    listModuleLessons: (moduleId, signal) =>
      client.request<Page<CatalogLesson>>(`/modules/${moduleId}/lessons?${FULL_PAGE}`, { signal }),

    /**
     * `POST /courses/{id}/enroll` - self-enrollment.
     *
     * Idempotent by design: `EnrollmentService.enroll` returns the existing
     * enrollment with 200 rather than a conflict, so a repeat is harmless. It
     * takes no request body. 409 means the course is not PUBLISHED; 404 means
     * the course does not exist.
     */
    enroll: (courseId, signal) =>
      client.request<EnrollmentResponse>(`/courses/${courseId}/enroll`, {
        method: 'POST',
        signal,
      }),

    /**
     * `POST /me/learning-events` -> 201 (BE-LEARNING-TRACKING-01).
     *
     * Records that the member opened a course, a module or a lesson. Requires
     * an enrollment (404 otherwise). Never aborted: the page may already be
     * gone when it lands, which is fine for a record of the past.
     */
    recordLearningEvent: (event) =>
      client.request<unknown>('/me/learning-events', { method: 'POST', json: event }),
  }
}
