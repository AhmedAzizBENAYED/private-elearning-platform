import type { ApiClient, CatalogCourse, CourseContent, EnrollmentSummary, Page, UUID } from '../../api'

/**
 * The three member reads the dashboard needs.
 *
 * Every call goes through the FE-02 API client, so the bearer token and the
 * single-flight refresh-and-retry apply here without this module knowing
 * anything about either. No component calls `fetch`.
 */
export interface DashboardApi {
  listEnrollments: (signal?: AbortSignal) => Promise<Page<EnrollmentSummary>>
  listPublishedCourses: (signal?: AbortSignal) => Promise<Page<CatalogCourse>>
  getCourseContent: (courseId: UUID, signal?: AbortSignal) => Promise<CourseContent>
}

/**
 * The backend caps `page_size` at 100. One page is the whole picture for an
 * association's catalogue, and asking for it once is what keeps the dashboard
 * at a constant number of requests instead of one per course.
 */
const PAGE_SIZE = 100

function listQuery(): string {
  return new URLSearchParams({ page: '1', page_size: String(PAGE_SIZE) }).toString()
}

export function createDashboardApi(client: ApiClient): DashboardApi {
  return {
    /** `GET /me/enrollments` - this member's courses, archived history included. */
    listEnrollments: (signal) =>
      client.request<Page<EnrollmentSummary>>(`/me/enrollments?${listQuery()}`, { signal }),

    /** `GET /courses` - the published catalogue. */
    listPublishedCourses: (signal) =>
      client.request<Page<CatalogCourse>>(`/courses?${listQuery()}`, { signal }),

    /** `GET /courses/{id}/content` - one course's tree and this member's progress. */
    getCourseContent: (courseId, signal) =>
      client.request<CourseContent>(
        `/courses/${encodeURIComponent(courseId)}/content`,
        { signal },
      ),
  }
}
