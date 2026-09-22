import { Link } from 'react-router-dom'

import { routes } from '../../../app/routes'
import { buttonClassName, Icon, Progress } from '../../../design-system'
import type { ContinueTarget } from '../../courses/courseDetails'

import styles from './ContinueCard.module.css'

export interface ContinueCardProps {
  target: ContinueTarget
}

/**
 * The "Continue learning" card (Dashboard board).
 *
 * A caveat worth being precise about: the backend stores no "last watched"
 * lesson, so this is **not** where the member left off. It is the first video
 * they have not completed in the unfinished course they most recently enrolled
 * in - a deterministic position in the course's own order. The copy avoids
 * claiming otherwise, and the every-course lists below give the member the
 * direct route to any other course.
 *
 * The video counts here are real: they come from `/courses/{id}/content`, which
 * the card already fetches for the lesson.
 */
export function ContinueCard({ target }: ContinueCardProps) {
  const courseHref = routes.course(target.courseId)
  const lessonHref =
    target.lesson === null ? courseHref : routes.lesson(target.courseId, target.lesson.id)

  return (
    <section className={styles.card} aria-labelledby="continue-learning-title">
      <div className={styles.media}>
        {target.thumbnailUrl === null ? (
          <span className={styles.placeholder} aria-hidden="true">
            <Icon name="book" size={40} />
          </span>
        ) : (
          <img className={styles.image} src={target.thumbnailUrl} alt="" />
        )}
      </div>

      <div className={styles.body}>
        <p className={styles.overline}>Continue learning</p>
        <h2 className={styles.title} id="continue-learning-title">
          {target.courseTitle}
        </h2>

        {target.lesson === null ? (
          <p className={styles.lesson}>
            <Icon name="book" size={16} className={styles.lessonIcon} />
            <span>No video lesson left to watch in this course.</span>
          </p>
        ) : (
          <p className={styles.lesson}>
            <Icon name="play-filled" size={16} className={styles.lessonIcon} />
            <span>
              {`Module ${target.lesson.modulePosition} · `}
              <b>{target.lesson.title}</b>
            </span>
          </p>
        )}

        <div className={styles.progress}>
          {/* The board puts the percentage and the count side by side above the
              bar, rather than the caption below it, so the header is written
              here instead of bending the shared Progress layout. */}
          <div className={styles.progressHead}>
            <span className={styles.percent}>{Math.round(target.progressPercent)}% complete</span>
            <span className={styles.count}>
              {`${target.completedVideoLessons} of ${target.totalVideoLessons} videos completed`}
            </span>
          </div>
          <Progress value={target.progressPercent} label={`${target.courseTitle} progress`} />
        </div>

        <div className={styles.actions}>
          <Link
            to={lessonHref}
            className={buttonClassName({ size: 'lg' })}
            aria-label={
              target.lesson === null
                ? `Open ${target.courseTitle}`
                : `Continue ${target.courseTitle}: ${target.lesson.title}`
            }
          >
            <Icon name="play" size={20} />
            <span>{target.lesson === null ? 'Open course' : 'Continue'}</span>
          </Link>

          <Link
            to={courseHref}
            className={buttonClassName({ variant: 'tertiary', size: 'lg' })}
            aria-label={`View course: ${target.courseTitle}`}
          >
            <span>View course</span>
          </Link>
        </div>
      </div>
    </section>
  )
}
