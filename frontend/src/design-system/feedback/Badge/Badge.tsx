import { asIconName, Icon, type IconName } from '../../icons'
import {
  type CourseState,
  type CourseStatus,
  type LessonType,
  lessonIcon,
  statusBadge,
} from '../../tokens'

import styles from './Badge.module.css'

export type MemberStatus = 'active' | 'inactive'

interface BadgeLook {
  label: string
  icon: IconName
  /** Shape class from DS 06: dashed outline, solid outline, tint or fill. */
  shape: string
}

// `statusBadge` and `lessonIcon` come from the design export's tokens.ts, so
// the labels and glyphs below are the designer's, not a second copy of them.
const courseStatusLook: Record<CourseStatus, BadgeLook> = {
  DRAFT: {
    label: statusBadge.DRAFT.label,
    icon: asIconName(statusBadge.DRAFT.icon),
    shape: styles.outlineDashed,
  },
  PUBLISHED: {
    label: statusBadge.PUBLISHED.label,
    icon: asIconName(statusBadge.PUBLISHED.icon),
    shape: styles.tinted,
  },
  ARCHIVED: {
    label: statusBadge.ARCHIVED.label,
    icon: asIconName(statusBadge.ARCHIVED.icon),
    shape: styles.muted,
  },
}

const memberStatusLook: Record<MemberStatus, BadgeLook> = {
  active: { label: 'Active', icon: 'dot', shape: styles.tinted },
  inactive: { label: 'Inactive', icon: 'circle', shape: styles.muted },
}

const learningStatusLook: Record<CourseState, BadgeLook> = {
  'not-enrolled': { label: 'Not enrolled', icon: 'circle', shape: styles.outlineSolid },
  'in-progress': { label: 'In progress', icon: 'play-filled', shape: styles.tinted },
  completed: { label: 'Completed', icon: 'check-circle', shape: styles.filled },
}

/**
 * A member's status in a course, as the backend names it
 * (`CourseLearningStatus`) and as DS 11 draws the learning status badge.
 *
 * Distinct from `CourseState` above, which is the member's own view of their
 * enrollment ("Not enrolled"). An administrator watching the tracking screens
 * sees every published course for every member, enrolled or not, so the third
 * word there is "Not started".
 */
export type LearningProgressState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'

// DS 11: circle + dashed grey, play + blue, check + navy. The same three
// colours the bars, the stacks and the charts use.
const learningProgressLook: Record<LearningProgressState, BadgeLook> = {
  NOT_STARTED: { label: 'Not started', icon: 'circle', shape: styles.outlineDashed },
  IN_PROGRESS: { label: 'In progress', icon: 'play-filled', shape: styles.tinted },
  COMPLETED: { label: 'Completed', icon: 'check-circle', shape: styles.filled },
}

export type BadgeProps = { className?: string } & (
  | { kind: 'course-status'; value: CourseStatus }
  | { kind: 'member-status'; value: MemberStatus }
  | { kind: 'learning-status'; value: CourseState }
  | { kind: 'learning-progress'; value: LearningProgressState }
  | { kind: 'lesson-type'; value: LessonType }
)

/**
 * A status chip (DS 06).
 *
 * The label is always real text and the glyph always accompanies it, so the
 * badge still reads in greyscale, in high contrast, and to a screen reader.
 * There is no free-text variant on purpose: every badge in the product belongs
 * to one of these four closed vocabularies.
 */
export function Badge({ kind, value, className }: BadgeProps) {
  if (kind === 'lesson-type') {
    return (
      <span className={[styles.badge, styles.lessonType, className].filter(Boolean).join(' ')}>
        <Icon name={asIconName(lessonIcon[value])} size={14} />
        <span>{value}</span>
      </span>
    )
  }

  const look =
    kind === 'course-status'
      ? courseStatusLook[value]
      : kind === 'member-status'
        ? memberStatusLook[value]
        : kind === 'learning-progress'
          ? learningProgressLook[value]
          : learningStatusLook[value]

  return (
    <span
      className={[
        styles.badge,
        look.shape,
        kind === 'course-status' ? styles.uppercase : styles.tight,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon name={look.icon} size={14} strokeWidth={2.2} />
      <span>{look.label}</span>
    </span>
  )
}
