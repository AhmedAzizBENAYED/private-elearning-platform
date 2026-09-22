import { Link } from 'react-router-dom'

import { routes } from '../../../app/routes'
import { Badge, buttonClassName, Icon, Progress } from '../../../design-system'
import type { CourseCardModel } from '../courseCard'

import styles from './CourseCard.module.css'

export interface CourseCardProps {
  course: CourseCardModel
}

/** The CTA copy the design gives each state. */
const cta = {
  'not-enrolled': { label: 'Start course', icon: 'arrow-right', variant: 'primary' },
  'in-progress': { label: 'Continue', icon: 'play', variant: 'primary' },
  // A finished course is not a call to act, so its action is tonal.
  completed: { label: 'Completed', icon: 'check-circle', variant: 'tonal' },
} as const

/** "1 module", "0 modules", "11 videos": the count, then the noun it agrees with. */
function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * One course card, shared by the dashboard and the catalogue boards.
 *
 * Every visible value comes from the backend. The "3 modules · 11 videos" line
 * and the "5 of 11 videos completed" caption (G05) are the backend's own
 * `module_count`, `total_video_lessons` and `completed_video_lessons`, drawn
 * only when the response carried them: a missing figure is left out, never
 * shown as zero, and the caption is never derived from the percentage.
 *
 * The title is the card's link and the CTA repeats the same href, as
 * Handoff-Components specifies; both carry the course title in their accessible
 * name so neither is an unlabelled "Continue".
 */
export function CourseCard({ course }: CourseCardProps) {
  const href = routes.course(course.courseId)
  const action = cta[course.state]

  return (
    <article className={styles.card}>
      <div className={styles.media}>
        {course.thumbnailUrl === null ? (
          // No thumbnail is a real backend state (`thumbnail_url: null`), not a
          // missing image: the navy block is the design's own placeholder.
          <span className={styles.placeholder} aria-hidden="true">
            <Icon name="book" size={32} />
          </span>
        ) : (
          <img className={styles.image} src={course.thumbnailUrl} alt="" loading="lazy" />
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.badgeRow}>
          <Badge kind="learning-status" value={course.state} />
        </div>

        <h3 className={styles.title}>
          <Link to={href} className={styles.titleLink}>
            {course.title}
          </Link>
        </h3>

        {course.description === null ? null : (
          <p className={styles.description}>{course.description}</p>
        )}

        {course.size === null ? null : (
          <p className={styles.size}>
            <span className={styles.sizeItem}>
              <Icon name="layers" size={16} className={styles.sizeIcon} />
              {counted(course.size.modules, 'module', 'modules')}
            </span>
            {/* Spoken as "3 modules, 11 videos" rather than run together. */}
            <span className="dsVisuallyHidden">, </span>
            <span className={styles.sizeItem}>
              <Icon name="video" size={16} className={styles.sizeIcon} />
              {counted(course.size.videos, 'video', 'videos')}
            </span>
          </p>
        )}

        {course.progressPercent === null ? null : (
          <div className={styles.progress}>
            <Progress
              value={course.progressPercent}
              label={`${course.title} progress`}
              headerLabel="Progress"
              showHeader
              caption={
                course.videoProgress === null
                  ? undefined
                  : `${course.videoProgress.completed} of ${counted(course.videoProgress.total, 'video', 'videos')} completed`
              }
            />
          </div>
        )}

        <div className={styles.action}>
          <Link
            to={href}
            className={buttonClassName({ variant: action.variant, fullWidth: true })}
            aria-label={`${action.label}: ${course.title}`}
          >
            <Icon name={action.icon} size={18} />
            <span>{action.label}</span>
          </Link>
        </div>
      </div>
    </article>
  )
}
