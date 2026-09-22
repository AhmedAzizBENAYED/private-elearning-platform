import { Link } from 'react-router-dom'

import { routes } from '../../../../app/routes'
import { Progress } from '../../../../design-system'
import type { LearningActivityRow } from '../api'
import { formatLessons, formatPercent, isActiveNow } from '../model'

import { ActivityCell, MemberCell, StatusCell } from './Cells'
import styles from '../Learning.module.css'

/** "Viewing now" while the 5-minute window holds, "Last viewed" otherwise. */
function courseCaption(row: LearningActivityRow, now: number): string {
  return isActiveNow(row.last_activity_at, now) ? 'Viewing now' : 'Last viewed'
}

/**
 * The activity table (Admin-Activity).
 *
 * Member · current or last course · progress · current or last lesson · status
 * · last active. A member with no recorded activity keeps their row and says
 * so - "No course opened yet" - rather than being dropped or shown at 0%.
 */
export function ActivityRows({ rows, now }: { rows: readonly LearningActivityRow[]; now: number }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Current / last course</th>
            <th scope="col">Progress</th>
            <th scope="col">Current / last lesson</th>
            <th scope="col">Status</th>
            <th scope="col">Last active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.member.id}>
              <th scope="row" className={styles.memberCell}>
                <MemberCell member={row.member} />
              </th>
              <td>
                {row.course === null ? (
                  <span className={styles.exact}>No course opened yet</span>
                ) : (
                  <span className={styles.memberText}>
                    <Link
                      className={styles.courseLink}
                      to={routes.adminLearningCourse(row.course.id)}
                    >
                      {row.course.title}
                    </Link>
                    <span className={styles.memberCaption}>{courseCaption(row, now)}</span>
                  </span>
                )}
              </td>
              <td>
                {row.progress_percent === null ? (
                  <span className={styles.exact}>—</span>
                ) : (
                  <div className={styles.progressCell}>
                    <span className={styles.percent}>{formatPercent(row.progress_percent)}</span>
                    <Progress
                      value={row.progress_percent}
                      size={6}
                      className={styles.bar}
                      label={`Progress of ${row.member.first_name} ${row.member.last_name} in ${row.course?.title ?? 'their last course'}`}
                    />
                    <span className={styles.cellCaption}>
                      {formatLessons(
                        row.completed_video_lessons ?? 0,
                        row.total_video_lessons ?? 0,
                      )}
                    </span>
                  </div>
                )}
              </td>
              <td>
                {row.lesson === null ? (
                  <span className={styles.exact}>—</span>
                ) : (
                  <span className={styles.memberText}>
                    <span className={styles.percent}>{row.lesson.title}</span>
                    <span className={styles.memberCaption}>
                      {`Module ${row.lesson.module_position} · ${row.lesson.module_title}`}
                    </span>
                  </span>
                )}
              </td>
              <td>
                {row.status === null ? (
                  <span className={styles.exact}>—</span>
                ) : (
                  <StatusCell status={row.status} />
                )}
              </td>
              <td>
                <ActivityCell at={row.last_activity_at} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The same rows as cards, for a phone (Admin-Activity-Mobile). */
export function ActivityCards({ rows, now }: { rows: readonly LearningActivityRow[]; now: number }) {
  return (
    <ul className={styles.cards}>
      {rows.map((row) => (
        <li key={row.member.id} className={styles.card}>
          <div className={styles.cardHead}>
            <MemberCell member={row.member} />
            {row.status === null ? null : <StatusCell status={row.status} />}
          </div>
          <ActivityCell at={row.last_activity_at} now={now} />

          {row.course === null ? (
            <p className={styles.cellCaption}>No course opened yet</p>
          ) : (
            <div className={styles.cardRow}>
              <span className={styles.memberCaption}>{courseCaption(row, now)}</span>
              <Link className={styles.courseLink} to={routes.adminLearningCourse(row.course.id)}>
                {row.course.title}
              </Link>
              {row.lesson === null ? null : (
                <span className={styles.cellCaption}>
                  {`${row.lesson.title} · Module ${row.lesson.module_position}`}
                </span>
              )}
              {row.progress_percent === null ? null : (
                <>
                  <span className={styles.percent}>{formatPercent(row.progress_percent)}</span>
                  <Progress
                    value={row.progress_percent}
                    size={6}
                    label={`Progress of ${row.member.first_name} ${row.member.last_name} in ${row.course.title}`}
                  />
                </>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
