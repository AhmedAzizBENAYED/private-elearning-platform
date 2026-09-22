/**
 * Shared backend contracts, transcribed from the live FastAPI schemas.
 *
 * Field names stay the backend's own `snake_case`, so these types are a literal
 * mirror of the JSON on the wire and drift shows up as a type error rather than
 * as a silently undefined property. Nothing here is invented: every field
 * exists on the corresponding Pydantic model.
 *
 * These live in `api/` rather than in a feature because more than one feature
 * reads them - the dashboard, the catalogue and the course pages all speak
 * about the same courses.
 */

export type UUID = string
export type ISODateTime = string

/** `app.schemas.pagination.Page` */
export interface Page<Item> {
  items: Item[]
  total: number
  page: number
  page_size: number
}

/** `app.models.course.CourseStatus` */
export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/** `app.models.lesson.ContentType` */
export type ContentType = 'VIDEO' | 'DOCUMENT' | 'TEXT' | 'LINK'

/**
 * `app.schemas.course.CatalogCourse` - the member projection of a course, as
 * `GET /courses/{id}` returns it.
 *
 * PUBLISHED only, so `status` is always `PUBLISHED`. This single-course shape
 * carries no count; the catalogue's list rows do (`CatalogCourseListItem`).
 */
export interface CatalogCourse {
  id: UUID
  title: string
  slug: string
  description: string
  thumbnail_url: string | null
  status: CourseStatus
  published_at: ISODateTime | null
}

/**
 * `app.schemas.course.CatalogCourseListItem` - one row of `GET /courses`
 * (BE-COURSE-CATALOG-01, G05): the course plus its size, counted by the
 * backend. `total_video_lessons` counts the VIDEO lessons, the ones that
 * decide completion. An empty course is `0` and `0`.
 */
export interface CatalogCourseListItem extends CatalogCourse {
  module_count: number
  total_video_lessons: number
}

/**
 * `app.schemas.course.EnrollmentFilter` - the catalogue tabs (G04), as the
 * `enrollment` query parameter of `GET /courses` spells them.
 */
export type EnrollmentFilter = 'not_enrolled' | 'in_progress' | 'completed'

/**
 * `app.schemas.course.CatalogEnrollmentCounts` - how many published courses
 * are in each tab for the caller, for the page's `search`, whatever its
 * `enrollment` filter and its page. `all` is the sum of the other three.
 */
export interface CatalogEnrollmentCounts {
  all: number
  not_enrolled: number
  in_progress: number
  completed: number
}

/** `app.schemas.course.CatalogPage` - `GET /courses`; `total` is the filtered total. */
export interface CatalogPage extends Page<CatalogCourseListItem> {
  enrollment_counts: CatalogEnrollmentCounts
}

/**
 * `app.schemas.enrollment.EnrollmentSummary` - one row of `GET /me/enrollments`.
 *
 * Carries no description. `module_count`, `total_video_lessons` and
 * `completed_video_lessons` (BE-COURSE-CATALOG-01, G05) are the figures behind
 * `progress_percent` and `completed`, with the names `CourseContent` uses.
 */
export interface EnrollmentSummary {
  enrollment_id: UUID
  course_id: UUID
  title: string
  slug: string
  thumbnail_url: string | null
  enrolled_at: ISODateTime
  completed_at: ISODateTime | null
  progress_percent: number
  completed: boolean
  module_count: number
  total_video_lessons: number
  completed_video_lessons: number
}

/** `app.schemas.lesson.CatalogLesson` */
export interface CatalogLesson {
  id: UUID
  title: string
  description: string | null
  content_type: ContentType
  duration_seconds: number | null
  position: number
  is_preview: boolean
}

/** `app.schemas.module.CatalogModule` */
export interface CatalogModule {
  id: UUID
  title: string
  description: string | null
  position: number
}

/**
 * `app.schemas.learning.CourseContentLesson`.
 *
 * The three progress fields are `null` for every kind except VIDEO, which is
 * how the backend says "this lesson does not count towards progress" rather
 * than reporting a misleading zero.
 */
export interface CourseContentLesson extends CatalogLesson {
  has_resource: boolean
  watched_seconds: number | null
  completed: boolean | null
  completed_at: ISODateTime | null
}

export interface CourseContentModule extends CatalogModule {
  lessons: CourseContentLesson[]
}

/**
 * `app.schemas.learning.CourseContent` - `GET /courses/{id}/content`.
 *
 * Requires enrollment, and returns the whole tree plus this member's progress
 * in one request. Modules and lessons arrive in `position` order.
 */
export interface CourseContent {
  course_id: UUID
  title: string
  slug: string
  description: string
  thumbnail_url: string | null
  status: CourseStatus
  published_at: ISODateTime | null
  total_video_lessons: number
  completed_video_lessons: number
  progress_percent: number
  completed: boolean
  modules: CourseContentModule[]
}

/** `app.schemas.progress.CourseProgressResponse` - `GET /courses/{id}/progress`. */
export interface CourseProgress {
  course_id: UUID
  total_video_lessons: number
  completed_video_lessons: number
  progress_percent: number
  completed: boolean
}
