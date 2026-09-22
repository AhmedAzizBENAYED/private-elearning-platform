import { Link } from 'react-router-dom'

import type { CourseContent, UUID } from '../../../api'
import { routes } from '../../../app/routes'
import { Icon } from '../../../design-system'

import styles from './LearningHeader.module.css'

export interface LearningHeaderProps {
  courseId: UUID
  content: CourseContent
  /** The module the selected lesson belongs to, when there is one. */
  moduleLabel: string | null
}

/**
 * The learning page's own context bar (Learning-Laptop).
 *
 * A breadcrumb back to the catalogue and the course, plus the course progress
 * chip. The figures are the backend's own aggregate from `CourseContent` -
 * `GET /courses/{id}/progress` is never called, because it computes the same
 * numbers from the same rule and a second read could only disagree.
 */
export function LearningHeader({ courseId, content, moduleLabel }: LearningHeaderProps) {
  return (
    <div className={styles.bar}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link to={routes.courses} className={styles.crumbLink}>
          Courses
        </Link>
        <Icon name="chevron-right" size={16} className={styles.separator} />
        <Link to={routes.course(courseId)} className={styles.crumbLink}>
          {content.title}
        </Link>
        {moduleLabel === null ? null : (
          <>
            <Icon name="chevron-right" size={16} className={styles.separator} />
            <span className={styles.crumbCurrent}>{moduleLabel}</span>
          </>
        )}
      </nav>

      <p className={styles.progress}>
        <strong className={styles.percent}>{`${Math.round(content.progress_percent)}%`}</strong>
        <span className={styles.videos}>
          {`${content.completed_video_lessons}/${content.total_video_lessons} videos`}
        </span>
      </p>
    </div>
  )
}
