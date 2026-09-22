import { Badge, Icon } from '../../../design-system'
import type { CourseDetailsHeader, CourseOutline } from '../courseDetails'
import type { EnrollmentState } from '../useCourseDetails'

import styles from './CourseHero.module.css'

export interface CourseHeroProps {
  header: CourseDetailsHeader
  enrollment: EnrollmentState
  /** `null` when the outline could not be read; the counts then stay hidden. */
  outline: CourseOutline | null
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The course details hero.
 *
 * The "3 modules · 15 lessons · 11 videos" line is counted from the outline the
 * backend actually returned, not from a count field - there is none on any
 * course shape. When the outline is unavailable the line is omitted rather than
 * guessed, and nothing else on the hero is invented either: there is no
 * instructor, rating, duration, student count, difficulty or category, because
 * the backend stores none of them.
 */
export function CourseHero({ header, enrollment, outline }: CourseHeroProps) {
  const badgeState =
    enrollment.kind === 'enrolled'
      ? enrollment.completed
        ? 'completed'
        : 'in-progress'
      : 'not-enrolled'

  return (
    <header className={styles.hero}>
      <div className={styles.media}>
        {header.thumbnailUrl === null ? (
          // `thumbnail_url: null` is a real backend value, not a missing file:
          // the navy block is the design's own placeholder.
          <span className={styles.placeholder} aria-hidden="true">
            <Icon name="book" size={40} />
          </span>
        ) : (
          <img className={styles.image} src={header.thumbnailUrl} alt="" />
        )}
      </div>

      <div className={styles.body}>
        {/* Enrollment state is unknown only when the read failed; claiming
            "Not enrolled" there would be a guess, so no badge is shown. */}
        {enrollment.kind === 'unknown' ? null : (
          <Badge kind="learning-status" value={badgeState} />
        )}

        <h1 className={styles.title}>{header.title}</h1>

        <p className={styles.description}>{header.description}</p>

        {outline === null ? null : (
          <ul className={styles.facts}>
            <li className={styles.fact}>
              <Icon name="layers" size={16} />
              <span>{plural(outline.moduleCount, 'module', 'modules')}</span>
            </li>
            <li className={styles.fact}>
              <Icon name="list" size={16} />
              <span>{plural(outline.lessonCount, 'lesson', 'lessons')}</span>
            </li>
            <li className={styles.fact}>
              <Icon name="video" size={16} />
              <span>{plural(outline.videoCount, 'video', 'videos')}</span>
            </li>
          </ul>
        )}
      </div>
    </header>
  )
}
