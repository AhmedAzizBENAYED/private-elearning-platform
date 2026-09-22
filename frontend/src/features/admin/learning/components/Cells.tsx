import { Link } from 'react-router-dom'

import { routes } from '../../../../app/routes'
import { Avatar, Badge, Progress } from '../../../../design-system'
import { formatDate } from '../../../../shared/formatDate'
import type { LearningMemberRef, LearningProgressRow, LearningStatus } from '../api'
import {
  formatDateTime,
  formatLessons,
  formatPercent,
  isActiveNow,
  memberName,
  relativeTime,
} from '../model'

import styles from '../Learning.module.css'

/**
 * The cells the tracking tables are made of (DS 11).
 *
 * Each one renders what the backend sent and nothing else: a member with no
 * recorded activity gets the board's words for that, never a zero standing in
 * for a missing figure or a date that was never recorded.
 */

/** Avatar + name link + one caption line (DS 11 "Member cell"). */
export function MemberCell({
  member,
  caption,
}: {
  member: LearningMemberRef
  caption?: string
}) {
  const name = memberName(member)

  return (
    <div className={styles.member}>
      <Avatar name={name} size={32} tone={member.is_active ? 'brand' : 'inactive'} />
      <span className={styles.memberText}>
        <Link className={styles.memberName} to={routes.adminMemberLearning(member.id)}>
          {name}
        </Link>
        {/* The boards mark a deactivated account wherever a member is named. */}
        {member.is_active ? null : <span className={styles.memberCaption}>Account inactive</span>}
        {caption === undefined ? null : <span className={styles.memberCaption}>{caption}</span>}
      </span>
    </div>
  )
}

/**
 * Percent + bar + caption (DS 11 "Matrix cell").
 *
 * The bar is drawn from the backend's own value - two decimals and all - while
 * only the number beside it is rounded, as the boards write it.
 */
export function ProgressCell({
  row,
  caption,
}: {
  row: LearningProgressRow
  caption?: string
}) {
  return (
    <div className={styles.progressCell}>
      <span className={styles.percent}>{formatPercent(row.progress_percent)}</span>
      <Progress
        value={row.progress_percent}
        size={6}
        className={styles.bar}
        label={`${memberName(row.member)} in ${row.course.title}`}
      />
      <span className={styles.cellCaption}>
        {caption ??
          `${formatLessons(row.completed_video_lessons, row.total_video_lessons)} lessons`}
      </span>
    </div>
  )
}

/** A pair with no activity: the dashed track of DS 11, and no figure at all. */
export function NotStartedCell({ row }: { row: LearningProgressRow }) {
  return (
    <div className={styles.emptyCell}>
      <Badge kind="learning-progress" value="NOT_STARTED" />
      <span className={styles.dashed} aria-hidden="true" />
      <span>
        {row.total_video_lessons === 0
          ? 'No video lesson yet'
          : `No lesson opened yet · ${row.total_video_lessons} lessons`}
      </span>
    </div>
  )
}

/**
 * When a member was last seen (DS 11 "Activity indicator").
 *
 * "Active now" is the design's 5-minute window applied to the event that came
 * back, so the badge agrees with the filter that asked for it. The exact
 * instant is kept underneath and in the tooltip, because a phrase like
 * "Yesterday" is not a record.
 */
export function ActivityCell({ at, now }: { at: string | null; now: number }) {
  if (at === null) {
    return <span className={styles.exact}>No activity yet</span>
  }

  const live = isActiveNow(at, now)

  return (
    <span className={styles.activity} title={formatDateTime(at)}>
      {live ? (
        <span className={styles.activeNow}>
          <span className={styles.dot} aria-hidden="true" />
          Active now
        </span>
      ) : null}
      <time dateTime={at}>{relativeTime(at, now)}</time>
      {live ? null : <span className={styles.exact}>{formatDate(at)}</span>}
    </span>
  )
}

/** The learning status badge, from the backend's own three values. */
export function StatusCell({ status }: { status: LearningStatus }) {
  return <Badge kind="learning-progress" value={status} />
}
