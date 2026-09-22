import type {
  CatalogCourse,
  CatalogCourseListItem,
  EnrollmentFilter,
  EnrollmentSummary,
  UUID,
} from '../../api'

/**
 * What one course card shows, whichever backend shape supplied it.
 *
 * `/courses` and `/me/enrollments` describe the same courses with different
 * fields, so both are normalised here and the card component never has to know
 * which it came from. Every property is a backend value or `null` where the
 * backend genuinely has none - nothing is defaulted into existence.
 *
 * Shared by the dashboard (FE-04) and the catalogue (FE-05).
 */
export interface CourseCardModel {
  courseId: UUID
  title: string
  /**
   * Only `/courses` carries a description. An enrolled course that has since
   * been archived is no longer in the published catalogue, so its description
   * is genuinely unavailable rather than empty.
   */
  description: string | null
  thumbnailUrl: string | null
  state: 'not-enrolled' | 'in-progress' | 'completed'
  /** 0-100 from the backend; `null` for a course this member has not started. */
  progressPercent: number | null
  /**
   * "N modules · M videos" (G05): the backend's own `module_count` and
   * `total_video_lessons`. `null` when the response did not carry them - then
   * the line is not drawn, rather than drawn as zero.
   */
  size: { modules: number; videos: number } | null
  /**
   * "X of Y videos completed" (G05), for an enrolled course only: the
   * enrollment's own `completed_video_lessons` and `total_video_lessons`,
   * never derived from the percentage.
   */
  videoProgress: { completed: number; total: number } | null
}

/**
 * A count the backend sent, or `null` when it sent none.
 *
 * The contract makes these fields required, but a card must not turn a missing
 * figure into a real-looking `0` - a response from a deployment that predates
 * BE-COURSE-CATALOG-01 simply has no size to show.
 */
function backendCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function sizeOf(modules: unknown, videos: unknown): CourseCardModel['size'] {
  const moduleCount = backendCount(modules)
  const videoCount = backendCount(videos)
  return moduleCount === null || videoCount === null ? null : { modules: moduleCount, videos: videoCount }
}

function videoProgressOf(enrollment: EnrollmentSummary): CourseCardModel['videoProgress'] {
  const completed = backendCount(enrollment.completed_video_lessons)
  const total = backendCount(enrollment.total_video_lessons)
  return completed === null || total === null ? null : { completed, total }
}

/** Course id -> description, for joining `/me/enrollments` to `/courses`. */
export function descriptionsByCourse(catalog: readonly CatalogCourse[]): Map<UUID, string> {
  return new Map(catalog.map((course) => [course.id, course.description]))
}

/** Course id -> this member's enrollment, for the reverse join. */
export function enrollmentsByCourse(
  enrollments: readonly EnrollmentSummary[],
): Map<UUID, EnrollmentSummary> {
  return new Map(enrollments.map((enrollment) => [enrollment.course_id, enrollment]))
}

/** A card built from an enrollment, borrowing the catalogue's description. */
export function enrollmentCard(
  enrollment: EnrollmentSummary,
  descriptions: ReadonlyMap<UUID, string>,
): CourseCardModel {
  return {
    courseId: enrollment.course_id,
    title: enrollment.title,
    description: descriptions.get(enrollment.course_id) ?? null,
    thumbnailUrl: enrollment.thumbnail_url,
    state: enrollment.completed ? 'completed' : 'in-progress',
    progressPercent: enrollment.progress_percent,
    size: sizeOf(enrollment.module_count, enrollment.total_video_lessons),
    videoProgress: videoProgressOf(enrollment),
  }
}

/** The card state the backend's `enrollment` filter guarantees for every row. */
const filterState: Record<EnrollmentFilter, CourseCardModel['state']> = {
  not_enrolled: 'not-enrolled',
  in_progress: 'in-progress',
  completed: 'completed',
}

/**
 * A card built from the catalogue, taking its state from the member's
 * enrollments when one exists.
 *
 * The state comes from the single `/me/enrollments` read rather than from a
 * request per course. On a filtered tab the backend has already decided every
 * row's state - that is what the filter is - so the tab's state is used, and a
 * failed or partial enrollment read cannot badge a "Completed" row "Not
 * enrolled". The progress figures still come only from the enrollment.
 */
export function catalogCard(
  course: CatalogCourse | CatalogCourseListItem,
  enrollments: ReadonlyMap<UUID, EnrollmentSummary> = new Map(),
  filter: EnrollmentFilter | null = null,
): CourseCardModel {
  // The "Not enrolled" tab is the backend saying there is no enrollment: a
  // stale one read earlier must not lend such a row any progress.
  const enrollment = filter === 'not_enrolled' ? undefined : enrollments.get(course.id)
  const counted = course as Partial<CatalogCourseListItem>

  return {
    courseId: course.id,
    title: course.title,
    description: course.description,
    thumbnailUrl: course.thumbnail_url,
    state:
      filter !== null
        ? filterState[filter]
        : enrollment === undefined
          ? 'not-enrolled'
          : enrollment.completed
            ? 'completed'
            : 'in-progress',
    progressPercent: enrollment?.progress_percent ?? null,
    size: sizeOf(counted.module_count, counted.total_video_lessons),
    videoProgress: enrollment === undefined ? null : videoProgressOf(enrollment),
  }
}
