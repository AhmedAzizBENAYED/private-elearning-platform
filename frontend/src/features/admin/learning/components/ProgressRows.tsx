import { Link } from 'react-router-dom'

import { routes } from '../../../../app/routes'
import type { LearningProgressRow } from '../api'
import { formatLessons, formatOptionalDate, formatPercent } from '../model'

import { ActivityCell, MemberCell, StatusCell } from './Cells'
import styles from '../Learning.module.css'
import { Progress } from '../../../../design-system'

/**
 * The list view (Admin-Progress-List): one row per member and course.
 *
 * A real table with a real header row, because this is tabular data: eight
 * columns of divs would leave a screen reader without the column a cell belongs
 * to. Rows with no activity show the board's em dash in the three date columns
 * rather than a date that was never recorded.
 */
export function ProgressRows({ rows, now }: { rows: readonly LearningProgressRow[]; now: number }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Course</th>
            <th scope="col">Progress</th>
            <th scope="col">Lessons</th>
            <th scope="col">Status</th>
            <th scope="col">Started</th>
            <th scope="col">Last activity</th>
            <th scope="col">Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.member.id}:${row.course.id}`}>
              <th scope="row" className={styles.memberCell}>
                <MemberCell member={row.member} />
              </th>
              <td>
                <Link className={styles.courseLink} to={routes.adminLearningCourse(row.course.id)}>
                  {row.course.title}
                </Link>
              </td>
              <td>
                <div className={styles.progressCell}>
                  <span className={styles.percent}>{formatPercent(row.progress_percent)}</span>
                  <Progress
                    value={row.progress_percent}
                    size={6}
                    className={styles.bar}
                    label={`Progress of ${row.member.first_name} ${row.member.last_name} in ${row.course.title}`}
                  />
                </div>
              </td>
              <td>{formatLessons(row.completed_video_lessons, row.total_video_lessons)}</td>
              <td>
                <StatusCell status={row.status} />
              </td>
              <td>{formatOptionalDate(row.started_at)}</td>
              <td>
                <ActivityCell at={row.last_activity_at} now={now} />
              </td>
              <td>{formatOptionalDate(row.completed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
