import type { ApiClient, ISODateTime, Page, UUID } from '../../../api'

/**
 * The administrator learning reads (BE-LEARNING-TRACKING-02).
 *
 * Four endpoints, one per screen of the tracking boards:
 *
 *   GET /admin/learning/progress          the matrix and the list
 *   GET /admin/learning/activity          who is using what, now or last
 *   GET /admin/learning/members/{id}      one member's whole picture
 *   GET /admin/courses/{id}/learning      one published course's figures
 *
 * Every type below mirrors `app.schemas.tracking` field for field. Nothing is
 * derived here: the percentage, the status and the counts are the backend's,
 * computed by the same functions a member's own pages use.
 */

/** `app.services.tracking_service.CourseLearningStatus`. */
export type LearningStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'

/** `app.models.learning_event.LearningEventType`. */
export type LearningEventType =
  | 'course_opened'
  | 'module_opened'
  | 'lesson_opened'
  | 'lesson_completed'

/** `app.schemas.tracking.MemberRef`. */
export interface LearningMemberRef {
  id: UUID
  first_name: string
  last_name: string
  email: string
  is_active: boolean
}

/** `app.schemas.tracking.CourseRef`. */
export interface LearningCourseRef {
  id: UUID
  title: string
  slug: string
}

/** `app.schemas.tracking.LessonRef` - the lesson a member last opened. */
export interface LearningLessonRef {
  id: UUID
  title: string
  module_id: UUID
  module_title: string
  module_position: number
}

/**
 * `app.schemas.tracking.MemberCourseProgress` - one matrix cell, one list row.
 *
 * The three dates are `null` for a pair with no activity, which is what "Not
 * started" is: the screens show the board's dash, never a made-up date.
 */
export interface LearningProgressRow {
  member: LearningMemberRef
  course: LearningCourseRef
  status: LearningStatus
  progress_percent: number
  completed_video_lessons: number
  total_video_lessons: number
  completed_modules: number
  total_modules: number
  started_at: ISODateTime | null
  last_activity_at: ISODateTime | null
  completed_at: ISODateTime | null
}

/**
 * `app.schemas.tracking.LearningStatusCounts`.
 *
 * Sized over the whole filtered set *ignoring* the status filter, so every tab
 * can show its own figure at once - the counts never follow the selected tab.
 */
export interface LearningCounts {
  all: number
  not_started: number
  in_progress: number
  completed: number
  started: number
}

/** `app.schemas.tracking.LearningProgressSort`. */
export type LearningProgressSort =
  | '-last_activity'
  | '-started'
  | '-completed'
  | '-progress'
  | 'progress'
  | 'member'

/** `app.schemas.tracking.LearningProgressPage`. */
export interface LearningProgressPage extends Page<LearningProgressRow> {
  counts: LearningCounts
}

/**
 * `app.schemas.tracking.MemberActivity`.
 *
 * `course`, `lesson` and the figures are all `null` together, for a member with
 * no recorded activity - the board's "No course opened yet".
 */
export interface LearningActivityRow {
  member: LearningMemberRef
  last_activity_at: ISODateTime | null
  course: LearningCourseRef | null
  lesson: LearningLessonRef | null
  status: LearningStatus | null
  progress_percent: number | null
  completed_video_lessons: number | null
  total_video_lessons: number | null
}

/** `app.schemas.tracking.LearningActivityPage`. */
export interface LearningActivityPage extends Page<LearningActivityRow> {
  members_with_activity: number
  /** Members active since `active_since`; `null` when no window was asked for. */
  active_members: number | null
}

/** `app.schemas.tracking.LearningEventEntry`. */
export interface LearningEventEntry {
  id: UUID
  type: LearningEventType
  occurred_at: ISODateTime
  course_id: UUID
  course_title: string
  module_id: UUID | null
  module_title: string | null
  lesson_id: UUID | null
  lesson_title: string | null
}

/** `app.schemas.tracking.MemberLearningResponse`. */
export interface MemberLearningDetail {
  member: LearningMemberRef
  counts: LearningCounts
  last_activity_at: ISODateTime | null
  latest: LearningActivityRow | null
  /** Every published course, the untouched ones included. Not paginated. */
  courses: LearningProgressRow[]
  recent_events: LearningEventEntry[]
}

/** `app.schemas.tracking.CourseLearningSummary`. */
export interface CourseLearningSummary {
  course: LearningCourseRef
  total_modules: number
  total_video_lessons: number
  counts: LearningCounts
  /** Averaged over the members who started, as the board states. */
  average_progress_percent: number
  /** completed ÷ started. */
  completion_rate_percent: number
}

export interface LearningProgressQuery {
  /** 1-based, as the backend counts. */
  page: number
  pageSize: number
  /** Literal substring of a member's name or email, or a course title. */
  search?: string
  courseId?: UUID
  memberId?: UUID
  status?: LearningStatus
  /** ISO instant; keeps the pairs whose last activity is at or after it. */
  activeSince?: ISODateTime
  sort?: LearningProgressSort
  signal?: AbortSignal
}

export interface LearningActivityQuery {
  page: number
  pageSize: number
  search?: string
  activeSince?: ISODateTime
  onlyActive?: boolean
  signal?: AbortSignal
}

export interface LearningApi {
  listProgress: (query: LearningProgressQuery) => Promise<LearningProgressPage>
  listActivity: (query: LearningActivityQuery) => Promise<LearningActivityPage>
  getMemberLearning: (memberId: UUID, signal?: AbortSignal) => Promise<MemberLearningDetail>
  getCourseLearning: (courseId: UUID, signal?: AbortSignal) => Promise<CourseLearningSummary>
}

/**
 * The tracking API.
 *
 * The same authenticated client every other feature uses. Authorization is the
 * backend's: the whole router carries `Depends(admin_access)`, so these URLs
 * answer 403 to a member whatever this frontend renders.
 */
export function createLearningApi(client: ApiClient): LearningApi {
  function progressPath(query: LearningProgressQuery): string {
    const params = new URLSearchParams({
      page: String(query.page),
      page_size: String(query.pageSize),
    })
    // Filtering is the database's work: an empty term is no filter at all, so
    // it is omitted rather than sent as a blank string.
    const term = query.search?.trim() ?? ''
    if (term !== '') params.set('search', term)
    if (query.courseId !== undefined) params.set('course_id', query.courseId)
    if (query.memberId !== undefined) params.set('member_id', query.memberId)
    if (query.status !== undefined) params.set('status', query.status)
    if (query.activeSince !== undefined) params.set('active_since', query.activeSince)
    if (query.sort !== undefined) params.set('sort', query.sort)
    return `/admin/learning/progress?${params.toString()}`
  }

  function activityPath(query: LearningActivityQuery): string {
    const params = new URLSearchParams({
      page: String(query.page),
      page_size: String(query.pageSize),
    })
    const term = query.search?.trim() ?? ''
    if (term !== '') params.set('search', term)
    if (query.activeSince !== undefined) params.set('active_since', query.activeSince)
    // `only_active` is meaningless without a window, and the backend ignores it
    // then; it is sent only with one, so the URL says what it does.
    if (query.onlyActive === true && query.activeSince !== undefined) {
      params.set('only_active', 'true')
    }
    return `/admin/learning/activity?${params.toString()}`
  }

  return {
    /**
     * `GET /admin/learning/progress` -> `LearningProgressPage`.
     *
     * One row per member and published course, pairs with no activity included.
     * Search, course, member, status, activity window, sort and paging are all
     * parameters of this one request: no page is ever filtered here.
     */
    listProgress: (query) =>
      client.request<LearningProgressPage>(progressPath(query), { signal: query.signal }),

    /**
     * `GET /admin/learning/activity` -> `LearningActivityPage`.
     *
     * Each member's latest learning event and the last lesson they opened,
     * newest first, members with no activity last.
     */
    listActivity: (query) =>
      client.request<LearningActivityPage>(activityPath(query), { signal: query.signal }),

    /**
     * `GET /admin/learning/members/{id}` -> `MemberLearningResponse`.
     *
     * 404 when the id is unknown or belongs to an administrator.
     */
    getMemberLearning: (memberId, signal) =>
      client.request<MemberLearningDetail>(`/admin/learning/members/${memberId}`, { signal }),

    /**
     * `GET /admin/courses/{id}/learning` -> `CourseLearningSummary`.
     *
     * 404 for a DRAFT or ARCHIVED course: the screens report on the catalogue
     * members can actually reach.
     */
    getCourseLearning: (courseId, signal) =>
      client.request<CourseLearningSummary>(`/admin/courses/${courseId}/learning`, { signal }),
  }
}
