import { routes } from '../../../app/routes'
import { Badge } from '../../../design-system'
import { safeExternalUrl } from '../../../shared/safeExternalUrl'
import type { AdminCourseSummary } from '../api'
import { formatDate } from '../model'

import { LinkButton } from '../../../app/LinkButton'
import styles from './RecentCoursesTable.module.css'

export interface RecentCoursesTableProps {
  courses: readonly AdminCourseSummary[]
}

/**
 * The thumbnail the board puts beside a course title.
 *
 * A course may have none, and the field is an arbitrary URL the administrator
 * typed, so it goes through the same http/https allowlist the rest of the
 * application uses before it reaches `src`. A course without a usable one
 * keeps the tonal block, which is the design's placeholder - the row never
 * collapses and the titles stay aligned.
 */
function Thumbnail({ course }: { course: AdminCourseSummary }) {
  const safe = course.thumbnail_url === null ? null : safeExternalUrl(course.thumbnail_url)

  return (
    <span className={styles.thumb}>
      {safe === null ? null : <img src={safe} alt="" loading="lazy" />}
    </span>
  )
}

/**
 * "Recently created courses" (Admin-Dashboard).
 *
 * A real `<table>`: six labelled columns of one fact each, which is what a
 * screen reader needs to say "Modules, 3" instead of reading a bare number out
 * of a flex row. The board's own markup uses `role="table"` because it is a
 * static export; the roles exist to imitate this element, so the element is
 * used directly.
 *
 * `module_count` and `lesson_count` are the server's counts, carried on the
 * listing row. Nothing here derives, estimates or defaults them: a course with
 * no modules shows 0 because the backend counted zero.
 *
 * Only the Open link is interactive, so a row holds exactly one target and
 * there is nothing nested inside it.
 */
export function RecentCoursesTable({ courses }: RecentCoursesTableProps) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Status</th>
            <th scope="col" className={styles.number}>
              Modules
            </th>
            <th scope="col" className={styles.number}>
              Lessons
            </th>
            <th scope="col">Created</th>
            <th scope="col">
              <span className="dsVisuallyHidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <tr key={course.id}>
              <th scope="row" className={styles.courseCell}>
                <span className={styles.course}>
                  <Thumbnail course={course} />
                  <span className={styles.title}>{course.title}</span>
                </span>
              </th>
              <td>
                <Badge kind="course-status" value={course.status} />
              </td>
              <td className={styles.number}>{course.module_count}</td>
              <td className={styles.number}>{course.lesson_count}</td>
              <td className={styles.date}>
                <time dateTime={course.created_at}>{formatDate(course.created_at)}</time>
              </td>
              <td className={styles.open}>
                <LinkButton
                  variant="tertiary"
                  size="sm"
                  iconRight="chevron-right"
                  to={routes.adminCourse(course.id)}
                  // The visible word is "Open" on every row; the name says which.
                  aria-label={`Open ${course.title}`}
                >
                  Open
                </LinkButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
