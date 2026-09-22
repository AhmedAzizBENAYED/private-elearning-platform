import { Link } from 'react-router-dom'

import type { UUID } from '../../../api'
import { routes } from '../../../app/routes'
import { Icon } from '../../../design-system'
import { media, useMediaQuery } from '../../../design-system/responsive'
import type { LessonRef } from '../model'

import styles from './LessonNavigation.module.css'

export interface LessonNavigationProps {
  courseId: UUID
  previous: LessonRef | null
  next: LessonRef | null
}

function Step({
  courseId,
  lesson,
  direction,
}: {
  courseId: UUID
  lesson: LessonRef
  direction: 'previous' | 'next'
}) {
  const isNext = direction === 'next'

  return (
    <Link
      to={routes.lesson(courseId, lesson.id)}
      className={[styles.step, isNext ? styles.next : undefined].filter(Boolean).join(' ')}
      // Names the destination, so the link never announces as a bare "Next".
      aria-label={`${isNext ? 'Next lesson' : 'Previous lesson'}: ${lesson.title}`}
    >
      <Icon name={isNext ? 'arrow-right' : 'arrow-left'} size={18} />
      <span className={styles.stepBody}>
        <span className={styles.stepLabel}>{isNext ? 'Next lesson' : 'Previous'}</span>
        <span className={styles.stepTitle}>{lesson.title}</span>
      </span>
    </Link>
  )
}

/**
 * Previous / next lesson (Learning-Video, Learning-Laptop, Learning-Mobile).
 *
 * Previous on the left and the navy "Next lesson" on the right; on a phone the
 * two stack with "Next lesson" first, as Learning-Mobile draws it. The order is
 * the DOM's own at every width, not a CSS `order`, so what is read and tabbed
 * through is what is seen.
 *
 * Both walk the course's own order - `byPosition` across every module - so the
 * pager and the sidebar can never disagree. At either end the step is simply
 * absent rather than present and dead: the design draws no disabled pager, and
 * a link that goes nowhere is worse than no link.
 */
export function LessonNavigation({ courseId, previous, next }: LessonNavigationProps) {
  const phone = useMediaQuery(media.belowSm)
  if (previous === null && next === null) return null

  const back =
    previous === null ? (
      <span key="previous" className={styles.spacer} aria-hidden="true" />
    ) : (
      <Step key="previous" courseId={courseId} lesson={previous} direction="previous" />
    )
  const forward =
    next === null ? (
      <span key="next" className={styles.spacer} aria-hidden="true" />
    ) : (
      <Step key="next" courseId={courseId} lesson={next} direction="next" />
    )

  return (
    <nav className={styles.nav} aria-label="Lesson navigation">
      {phone ? [forward, back] : [back, forward]}
    </nav>
  )
}
