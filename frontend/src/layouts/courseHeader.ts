import { createContext, useContext, useLayoutEffect } from 'react'

/**
 * What a course page tells the member shell about itself, so the shell's
 * contextual header can name the course (G27, Learning-Mobile and
 * Learning-Tablet).
 *
 * Only the page holds these figures - they come from its single
 * `GET /courses/{id}/content` - so the shell never reads the course itself.
 */
export interface CourseHeaderInfo {
  courseTitle: string
  /** "Module 2 · Functions and structure", or `null` when no lesson is placed. */
  moduleLabel: string | null
  /** The backend's `progress_percent`, as the page already shows it. */
  progressPercent: number
}

export const CourseHeaderContext = createContext<((info: CourseHeaderInfo | null) => void) | null>(
  null,
)

/**
 * Publishes the course to the shell's header while the page is mounted.
 *
 * A layout effect, so the header is filled before the first paint rather than
 * flashing empty. Outside the member shell there is no header to fill and this
 * does nothing. The dependencies are the three values, never an object, so a
 * re-render of the page cannot start a publish loop with the shell.
 */
export function usePublishCourseHeader(info: CourseHeaderInfo | null): void {
  const publish = useContext(CourseHeaderContext)
  const courseTitle = info?.courseTitle ?? null
  const moduleLabel = info?.moduleLabel ?? null
  const progressPercent = info?.progressPercent ?? null

  useLayoutEffect(() => {
    if (publish === null) return
    publish(
      courseTitle === null || progressPercent === null
        ? null
        : { courseTitle, moduleLabel, progressPercent },
    )
    return () => publish(null)
  }, [publish, courseTitle, moduleLabel, progressPercent])
}
