import { Link } from 'react-router-dom'

import { routes } from '../../../../app/routes'
import type { LearningCourseRef, LearningProgressRow } from '../api'
import { groupByMember } from '../grouping'
import { formatDate } from '../../../../shared/formatDate'
import { formatLessons } from '../model'

import { MemberCell, NotStartedCell, ProgressCell, StatusCell } from './Cells'
import styles from '../Learning.module.css'

/** One cell of the grid: the pair, or the board's "Not started" block. */
function MatrixCell({ row }: { row: LearningProgressRow | undefined }) {
  if (row === undefined) {
    // Only reachable with a filter narrower than the member's own rows: the
    // pair exists, this page just does not carry it.
    return <span className={styles.exact}>—</span>
  }
  if (row.status === 'NOT_STARTED') return <NotStartedCell row={row} />

  return (
    <div className={styles.progressCell}>
      <StatusCell status={row.status} />
      <ProgressCell
        row={row}
        caption={
          row.completed_at === null
            ? `${formatLessons(row.completed_video_lessons, row.total_video_lessons)} lessons`
            : `Completed ${formatDate(row.completed_at)}`
        }
      />
    </div>
  )
}

/**
 * The matrix (Admin-Progress): members down, published courses across.
 *
 * The columns are the published catalogue, so a course nobody has opened still
 * has its column - which is what makes the empty cells meaningful. The caption
 * under each member ("3 of 6 started · 1 completed") is counted from that
 * member's own rows on this page, not from the whole set.
 */
export function ProgressMatrix({
  rows,
  courses,
}: {
  rows: readonly LearningProgressRow[]
  courses: readonly LearningCourseRef[]
}) {
  const groups = groupByMember(rows)

  return (
    <div className={styles.scroll}>
      <table className={[styles.table, styles.matrixTable].join(' ')}>
        <thead>
          <tr>
            <th scope="col">Member</th>
            {courses.map((course) => (
              <th key={course.id} scope="col" className={styles.columnHead}>
                <Link className={styles.courseLink} to={routes.adminLearningCourse(course.id)}>
                  {course.title}
                </Link>
                {/* The lesson count is the one this member's row carries, so it
                    is the backend's figure for that course, not a guess. */}
                <span className={styles.columnCaption}>
                  {rows.find((row) => row.course.id === course.id)?.total_video_lessons ?? 0} lessons
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.member.id}>
              <th scope="row" className={styles.memberCell}>
                <MemberCell
                  member={group.member}
                  caption={`${group.started} of ${courses.length} started · ${group.completed} completed`}
                />
              </th>
              {courses.map((course) => (
                <td key={course.id}>
                  <MatrixCell row={group.byCourse.get(course.id)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
