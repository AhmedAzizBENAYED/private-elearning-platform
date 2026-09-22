import { Progress } from '../../../../design-system'
import type { LearningProgressRow } from '../api'
import { groupByMember } from '../grouping'
import { formatLessons, formatOptionalDate, formatPercent } from '../model'

import { MemberCell, StatusCell } from './Cells'
import styles from '../Learning.module.css'

/**
 * The phone layout of the progress screens (Admin-Progress-Mobile).
 *
 * A card per member, the courses they have opened inside it, and a line for the
 * ones they have not - the board's "3 courses not started". Not a narrowed
 * table: eight columns on a 390px screen would be unreadable, and the board
 * draws a different structure, not a smaller one.
 */
export function ProgressCards({
  rows,
  courseCount,
}: {
  rows: readonly LearningProgressRow[]
  /** Published courses, for the "x of y started" caption. */
  courseCount: number
}) {
  const groups = groupByMember(rows)

  return (
    <ul className={styles.cards}>
      {groups.map((group) => {
        const started = group.rows.filter((row) => row.status !== 'NOT_STARTED')
        const notStarted = group.rows.length - started.length

        return (
          <li key={group.member.id} className={styles.card}>
            <div className={styles.cardHead}>
              <MemberCell
                member={group.member}
                caption={`${group.started} of ${courseCount} started · ${group.completed} completed`}
              />
            </div>

            <ul className={styles.cardRows}>
              {started.map((row) => (
                <li key={row.course.id} className={styles.cardRow}>
                  <div className={styles.cardRowHead}>
                    <h3 className={styles.cardTitle}>{row.course.title}</h3>
                    <StatusCell status={row.status} />
                  </div>
                  <span className={styles.percent}>{formatPercent(row.progress_percent)}</span>
                  <Progress
                    value={row.progress_percent}
                    size={6}
                    label={`Progress of ${row.member.first_name} ${row.member.last_name} in ${row.course.title}`}
                  />
                  <span className={styles.cellCaption}>
                    {`${formatLessons(row.completed_video_lessons, row.total_video_lessons)} lessons · last activity ${formatOptionalDate(row.last_activity_at)}`}
                  </span>
                </li>
              ))}
            </ul>

            {notStarted === 0 ? null : (
              <p className={styles.cellCaption}>
                {notStarted === 1 ? '1 course not started' : `${notStarted} courses not started`}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
