import type { CatalogCourse, EnrollmentSummary, UUID } from '../../api'

/**
 * Splits enrollments the way the design's two lists do.
 *
 * `completed` is the backend's own flag, not a comparison against 100: the
 * server owns that rule (a course with no videos never completes), and
 * recomputing it here would be a second, divergent source of truth.
 */
export function splitEnrollments(enrollments: readonly EnrollmentSummary[]): {
  inProgress: EnrollmentSummary[]
  completed: EnrollmentSummary[]
} {
  const inProgress: EnrollmentSummary[] = []
  const completed: EnrollmentSummary[] = []

  for (const enrollment of enrollments) {
    if (enrollment.completed) completed.push(enrollment)
    else inProgress.push(enrollment)
  }

  return { inProgress, completed }
}

/** Published courses this member is not enrolled in. */
export function availableCourses(
  catalog: readonly CatalogCourse[],
  enrollments: readonly EnrollmentSummary[],
): CatalogCourse[] {
  const enrolled = new Set(enrollments.map((enrollment) => enrollment.course_id))
  return catalog.filter((course) => !enrolled.has(course.id))
}

/**
 * Chooses the course the "Continue learning" card is about.
 *
 * The backend records no "last watched" anything, so this cannot be - and is
 * not presented as - the course the member was last in. It is the unfinished
 * course they most recently enrolled in, which is a deterministic choice made
 * from a backend field (`enrolled_at`) rather than a guess.
 */
export function continueCourseId(inProgress: readonly EnrollmentSummary[]): UUID | null {
  let latest: EnrollmentSummary | null = null

  for (const enrollment of inProgress) {
    if (latest === null || enrollment.enrolled_at > latest.enrolled_at) latest = enrollment
  }

  return latest?.course_id ?? null
}
